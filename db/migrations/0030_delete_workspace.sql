-- 0030: Allow a workspace owner to delete their workspace.
--
-- The app role (stackup_app) has only GRANT SELECT / narrow UPDATE on
-- `workspaces` (0001, 0021, 0026) — it can never DELETE directly. Deletion
-- goes through a SECURITY DEFINER function, mirroring create_workspace_with_owner
-- (0001/0017): the function runs as its owner (stackup_migrator), verifies the
-- caller is the workspace OWNER, binds the tenant context to the target so the
-- workspaces `workspace_self` policy admits the DELETE without BYPASSRLS, then
-- restores prior context.
--
-- Almost every workspace-owned table declares workspace_id ... ON DELETE
-- CASCADE, and PostgreSQL runs referential-integrity cascades with row security
-- bypassed, so a single top-level DELETE tears down the whole tenant. Two
-- tables were the exception — `memberships` and `audit_log` were created NO
-- ACTION (0001), which would abort the workspace delete. We switch both to
-- CASCADE here so the tenant tears down cleanly; deleting a workspace should of
-- course remove its memberships and its audit trail with it.

-- memberships.workspace_id -> workspaces(id): NO ACTION -> CASCADE.
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_workspace_id_fkey;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- audit_log.workspace_id -> workspaces(id): NO ACTION -> CASCADE.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_workspace_id_fkey;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION delete_workspace(
  p_workspace_id uuid,
  p_user_id      uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role    text;
  v_prev_ws   text := current_setting('app.current_workspace', true);
  v_prev_user text := current_setting('app.current_user', true);
BEGIN
  -- Only the owner may delete the workspace.
  SELECT role INTO v_role
    FROM memberships
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND status = 'active';
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only the workspace owner can delete the workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Bind context to the target so the workspace_self policy admits the DELETE.
  PERFORM set_config('app.current_workspace', p_workspace_id::text, true);
  PERFORM set_config('app.current_user', p_user_id::text, true);

  DELETE FROM workspaces WHERE id = p_workspace_id;

  -- Restore whatever context the caller had (empty on the pool path).
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  PERFORM set_config('app.current_user', coalesce(v_prev_user, ''), true);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_workspace(uuid, uuid) TO stackup_app;
