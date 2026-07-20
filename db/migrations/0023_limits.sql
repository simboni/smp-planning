-- 0023: Limits & metering (M20). Per-workspace resource caps: total attachment
-- storage and automation runs per calendar month. Usage is derived live from
-- existing rows (files.size_bytes, automation_runs.created_at) — this table
-- only holds optional per-workspace OVERRIDES of the code defaults, so a future
-- billing/plan layer can raise or lower a workspace's caps without a schema
-- change. No row => the app's generous defaults apply.

CREATE TABLE workspace_limits (
  workspace_id             uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  storage_limit_bytes      bigint,
  automations_monthly_limit int,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_limits_tenant ON workspace_limits
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

-- The app reads overrides; writing them is a billing/admin concern handled
-- out-of-band (migrator-owned), so the runtime role gets SELECT only.
GRANT SELECT ON workspace_limits TO stackup_app;
