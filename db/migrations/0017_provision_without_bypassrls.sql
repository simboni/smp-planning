-- 0017: Make workspace provisioning work on managed Postgres (no BYPASSRLS).
--
-- create_workspace_with_owner (0001) is SECURITY DEFINER and, as written,
-- relied on its owner role (stackup_migrator) having BYPASSRLS to insert the
-- first workspace + owner-membership rows before any tenant context exists.
-- Managed providers (Neon, Supabase, RDS) do not grant BYPASSRLS, so that
-- path would be denied by FORCE ROW LEVEL SECURITY.
--
-- Fix: the function pre-generates the workspace id, sets the transaction-local
-- tenant context to it, and inserts with that explicit id — so the workspaces
-- `workspace_self` policy (id = app.current_workspace, which also gates INSERT)
-- and the memberships `membership_write` WITH CHECK both pass under RLS, with
-- no bypass required. Prior context is captured and restored so a caller that
-- wraps this in a larger transaction is unaffected. This is equally correct
-- when the owner DOES have BYPASSRLS (self-hosted), so it supersedes the 0001
-- definition on every deployment.

CREATE OR REPLACE FUNCTION create_workspace_with_owner(
  p_name    text,
  p_slug    text,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_workspace_id uuid := gen_random_uuid();
  v_prev_ws      text := current_setting('app.current_workspace', true);
  v_prev_user    text := current_setting('app.current_user', true);
BEGIN
  -- Bind context to the workspace-to-be so both inserts satisfy their RLS
  -- WITH CHECK arms without needing BYPASSRLS.
  PERFORM set_config('app.current_workspace', v_workspace_id::text, true);
  PERFORM set_config('app.current_user', p_user_id::text, true);

  INSERT INTO workspaces (id, name, slug)
    VALUES (v_workspace_id, p_name, p_slug);
  INSERT INTO memberships (workspace_id, user_id, role)
    VALUES (v_workspace_id, p_user_id, 'owner');

  -- Restore whatever context the caller had (empty when invoked via the
  -- non-transactional pool path, as workspaces.service.ts does today).
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  PERFORM set_config('app.current_user', coalesce(v_prev_user, ''), true);

  RETURN v_workspace_id;
END;
$$;

-- submit_form_task (0012) had the same BYPASSRLS dependency: the public
-- submit path runs under app.form_token only, so once the function's owner
-- can't bypass RLS, its reads of lists/statuses and its INSERT into tasks are
-- denied (those policies key on app.current_workspace, which is unset on the
-- public path). Fix: after admitting the form via the form_token policy, bind
-- the tenant context to that form's own workspace for the rest of the body,
-- then restore. The public caller still can't reach anything but this one
-- form's target list, exactly as before.
CREATE OR REPLACE FUNCTION submit_form_task(
  p_token text,
  p_name  text,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_form forms%ROWTYPE;
  v_space uuid;
  v_status uuid;
  v_task uuid;
  v_pos numeric;
  v_prev_ws text := current_setting('app.current_workspace', true);
BEGIN
  SELECT * INTO v_form FROM forms
    WHERE public_token = p_token AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  -- Bind to the form's workspace so the remaining reads/writes pass RLS
  -- without BYPASSRLS.
  PERFORM set_config('app.current_workspace', v_form.workspace_id::text, true);
  SELECT space_id INTO v_space FROM lists WHERE id = v_form.list_id;
  SELECT id INTO v_status FROM statuses
    WHERE space_id = v_space AND type <> 'done'
    ORDER BY position LIMIT 1;
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos FROM tasks
    WHERE list_id = v_form.list_id AND parent_task_id IS NULL;
  INSERT INTO tasks (workspace_id, list_id, space_id, name, description,
                     status_id, position)
    VALUES (v_form.workspace_id, v_form.list_id, v_space,
            LEFT(p_name, 500), LEFT(p_description, 10000), v_status, v_pos)
    RETURNING id INTO v_task;
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  RETURN v_task;
END;
$$;
