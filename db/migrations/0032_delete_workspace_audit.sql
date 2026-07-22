-- 0032: Let a full workspace deletion cascade through the append-only audit log.
--
-- audit_log carries a BEFORE UPDATE OR DELETE trigger (audit_log_immutable,
-- 0001) that hard-blocks every DELETE to keep the hash chain tamper-evident.
-- 0030 switched audit_log's workspace FK to ON DELETE CASCADE so deleting a
-- workspace tears down its trail — but the cascade DELETE trips that trigger
-- ('audit_log is append-only'), so delete_workspace() 500s for any workspace
-- that has ANY audit entry (i.e. every real one).
--
-- Fix: the trigger now permits a DELETE only while a full workspace purge is in
-- progress, signalled by the transaction-local flag app.purging_workspace='1',
-- which ONLY delete_workspace() sets (right before it removes the workspace
-- row) and which it clears afterwards. Normal callers can never delete or
-- update audit rows: stackup_app has SELECT/INSERT only (0001), and the flag is
-- unset outside the owner-gated purge, so the append-only guarantee is intact.

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.purging_workspace', true) = '1' THEN
    -- The whole workspace is being deleted; let the cascade proceed.
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

-- Redefine delete_workspace to raise the purge flag across the cascade.
CREATE OR REPLACE FUNCTION delete_workspace(
  p_workspace_id uuid,
  p_user_id      uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role      text;
  v_prev_ws   text := current_setting('app.current_workspace', true);
  v_prev_user text := current_setting('app.current_user', true);
BEGIN
  SELECT role INTO v_role
    FROM memberships
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id
      AND status = 'active';
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only the workspace owner can delete the workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('app.current_workspace', p_workspace_id::text, true);
  PERFORM set_config('app.current_user', p_user_id::text, true);
  -- Allow the audit_log cascade for the duration of this transaction only.
  PERFORM set_config('app.purging_workspace', '1', true);

  DELETE FROM workspaces WHERE id = p_workspace_id;

  PERFORM set_config('app.purging_workspace', '', true);
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  PERFORM set_config('app.current_user', coalesce(v_prev_user, ''), true);

  RETURN true;
END;
$$;
