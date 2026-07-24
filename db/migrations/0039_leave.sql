-- 0039: Leave management (HR module).
--
-- Time off as a first-class workflow: LEAVE TYPES define the workspace's
-- policy (name + days-per-year entitlement — e.g. Annual 21, Sick 14,
-- Maternity 90), LEAVE REQUESTS carry a member's dated request through
-- pending → approved/rejected (by an admin or the requester's department
-- head — the departments module supplies the approval chain) or cancelled.
-- Balances are computed, not stored: entitlement minus approved working
-- days in the request's year, so there is no drift to reconcile.

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
