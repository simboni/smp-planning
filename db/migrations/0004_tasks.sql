-- 0004: Tasks Core — the heart of StackUp.
--
-- Tasks live in Lists (0002). This migration adds custom statuses (per Space),
-- tasks (with subtasks via parent_task_id), multiple assignees, watchers,
-- space-level tags, and checklists. Priorities/dates/estimates are columns on
-- the task. Custom fields, dependencies and recurrence come in M4.
--
-- All tables carry workspace RLS (the hard boundary); intra-workspace access
-- is enforced by the API's AccessService at the owning space level.

-- ---------------------------------------------------------------------------
-- Statuses — custom workflow stages, defined per Space (ClickUp default:
-- To Do / In Progress / Complete). `type` groups them: not_started / active /
-- done. A task in a 'done' status is considered complete (completed_at set).
-- ---------------------------------------------------------------------------
CREATE TABLE statuses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#8A8F98',
  type         text NOT NULL DEFAULT 'active'
               CHECK (type IN ('not_started', 'active', 'done')),
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX statuses_space_idx ON statuses (workspace_id, space_id, position);

ALTER TABLE statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE statuses FORCE ROW LEVEL SECURITY;
CREATE POLICY statuses_tenant ON statuses
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON statuses TO stackup_app;

-- ---------------------------------------------------------------------------
-- Tasks. space_id is denormalized (from the list) so status/tag/permission
-- lookups don't need a join. parent_task_id gives subtasks (nested to any
-- depth); a subtask lives in the same list as its parent.
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  list_id        uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  space_id       uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES tasks (id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  status_id      uuid REFERENCES statuses (id),
  priority       text CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  start_date     timestamptz,
  due_date       timestamptz,
  time_estimate_minutes int CHECK (time_estimate_minutes IS NULL OR time_estimate_minutes >= 0),
  position       double precision NOT NULL DEFAULT 0,   -- fractional ordering
  archived       boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES users (id),
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_list_idx    ON tasks (workspace_id, list_id, status_id, position);
CREATE INDEX tasks_parent_idx  ON tasks (workspace_id, parent_task_id);
CREATE INDEX tasks_space_idx   ON tasks (workspace_id, space_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_tenant ON tasks
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO stackup_app;

-- ---------------------------------------------------------------------------
-- Assignees & watchers (many-to-many with users).
-- ---------------------------------------------------------------------------
CREATE TABLE task_assignees (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignees_user_idx ON task_assignees (workspace_id, user_id);
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees FORCE ROW LEVEL SECURITY;
CREATE POLICY task_assignees_tenant ON task_assignees
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON task_assignees TO stackup_app;

CREATE TABLE task_watchers (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
ALTER TABLE task_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_watchers FORCE ROW LEVEL SECURITY;
CREATE POLICY task_watchers_tenant ON task_watchers
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON task_watchers TO stackup_app;

-- ---------------------------------------------------------------------------
-- Tags — colorful labels created at the Space level, applied to tasks.
-- ---------------------------------------------------------------------------
CREATE TABLE tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#7B68EE',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, name)
);
CREATE INDEX tags_space_idx ON tags (workspace_id, space_id);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tags_tenant ON tags
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO stackup_app;

CREATE TABLE task_tags (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY task_tags_tenant ON task_tags
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON task_tags TO stackup_app;

-- ---------------------------------------------------------------------------
-- Checklists — lightweight to-do lists inside a task; items can be assigned.
-- ---------------------------------------------------------------------------
CREATE TABLE checklists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'Checklist',
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklists_task_idx ON checklists (workspace_id, task_id, position);
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY checklists_tenant ON checklists
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON checklists TO stackup_app;

CREATE TABLE checklist_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  checklist_id     uuid NOT NULL REFERENCES checklists (id) ON DELETE CASCADE,
  name             text NOT NULL,
  resolved         boolean NOT NULL DEFAULT false,
  assignee_user_id uuid REFERENCES users (id),
  position         int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklist_items_idx ON checklist_items (workspace_id, checklist_id, position);
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY checklist_items_tenant ON checklist_items
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_items TO stackup_app;
