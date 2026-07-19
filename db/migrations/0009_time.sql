-- 0009: Time tracking, timesheets & workload.
--
-- time_entries: one row per tracked interval. A RUNNING timer is a row with
-- ended_at IS NULL (at most one running per user, enforced in the API).
-- Manual entries insert started_at + ended_at directly. duration is derived
-- (ended_at - started_at) and denormalized in seconds for cheap summing.
--
-- timesheet_submissions: a user's week (Monday start) can be submitted and
-- then approved/rejected by an admin/owner — the light ClickUp-style
-- timesheet workflow.

CREATE TABLE time_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id          uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users (id),
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,                    -- NULL = timer running
  duration_seconds int CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  billable         boolean NOT NULL DEFAULT false,
  note             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX time_entries_task_idx ON time_entries (workspace_id, task_id);
CREATE INDEX time_entries_user_idx ON time_entries (workspace_id, user_id, started_at DESC);
-- fast "my running timer" lookup
CREATE INDEX time_entries_running_idx ON time_entries (workspace_id, user_id)
  WHERE ended_at IS NULL;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY time_entries_tenant ON time_entries
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO stackup_app;

CREATE TABLE timesheet_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  week_start   date NOT NULL,                     -- Monday
  status       text NOT NULL DEFAULT 'submitted'
               CHECK (status IN ('submitted', 'approved', 'rejected')),
  decided_by   uuid REFERENCES users (id),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, week_start)
);
ALTER TABLE timesheet_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY timesheet_submissions_tenant ON timesheet_submissions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheet_submissions TO stackup_app;
