-- ===========================================================================
-- StackUp — Neon catch-up for leave management (schema 0039)
--
-- ONLY needed if ADMIN_DB_URL is still not set on the API host. Paste into
-- the Neon SQL editor as the OWNER role and Run. Idempotent.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS leave_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL,
  days_per_year int  NOT NULL DEFAULT 21,
  color         text NOT NULL DEFAULT '#7B68EE',
  position      int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS leave_types_workspace_idx ON leave_types (workspace_id);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_types_tenant ON leave_types;
CREATE POLICY leave_types_tenant ON leave_types
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON leave_types TO stackup_app;

CREATE TABLE IF NOT EXISTS leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types (id) ON DELETE CASCADE,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  -- Working days (Mon–Fri) in the range, computed server-side at creation.
  days          int  NOT NULL,
  reason        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS leave_requests_workspace_idx
  ON leave_requests (workspace_id, status, start_date);
CREATE INDEX IF NOT EXISTS leave_requests_user_idx
  ON leave_requests (workspace_id, user_id, start_date);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_requests_tenant ON leave_requests;
CREATE POLICY leave_requests_tenant ON leave_requests
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests TO stackup_app;

INSERT INTO schema_migrations (filename) VALUES ('0039_leave.sql')
ON CONFLICT DO NOTHING;
