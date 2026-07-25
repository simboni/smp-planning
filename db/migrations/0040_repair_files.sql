-- 0040: Repair the file/attachment subsystem on drifted databases.
--
-- Task file uploads 500 on a live database where part of the upload path's
-- schema (files, proof_annotations, task_activity, workspace_limits) was
-- recorded as applied but never landed — the same ledger-drift syndrome
-- previously repaired for public_shares (0033), whiteboard links (0034) and
-- the HR module (0036). This re-asserts every object the upload path touches,
-- idempotently; a healthy database is untouched.

CREATE TABLE IF NOT EXISTS files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks (id) ON DELETE CASCADE,
  name         text NOT NULL,
  mime         text NOT NULL,
  size_bytes   int NOT NULL CHECK (size_bytes >= 0),
  data         bytea NOT NULL,
  is_clip      boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_task_idx ON files (workspace_id, task_id, created_at);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS files_tenant ON files;
CREATE POLICY files_tenant ON files
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON files TO stackup_app;

CREATE TABLE IF NOT EXISTS proof_annotations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users (id),
  x            numeric(6,5) NOT NULL CHECK (x >= 0 AND x <= 1),
  y            numeric(6,5) NOT NULL CHECK (y >= 0 AND y <= 1),
  body         text NOT NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proof_annotations_file_idx
  ON proof_annotations (workspace_id, file_id, created_at);
ALTER TABLE proof_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_annotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proof_annotations_tenant ON proof_annotations;
CREATE POLICY proof_annotations_tenant ON proof_annotations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON proof_annotations TO stackup_app;

CREATE TABLE IF NOT EXISTS task_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users (id),
  kind          text NOT NULL,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_activity_task_idx
  ON task_activity (workspace_id, task_id, created_at DESC);
ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_activity_tenant ON task_activity;
CREATE POLICY task_activity_tenant ON task_activity
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT ON task_activity TO stackup_app;

CREATE TABLE IF NOT EXISTS workspace_limits (
  workspace_id             uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  storage_limit_bytes      bigint,
  automations_monthly_limit int,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspace_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_limits_tenant ON workspace_limits;
CREATE POLICY workspace_limits_tenant ON workspace_limits
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT ON workspace_limits TO stackup_app;
