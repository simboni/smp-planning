-- 0005: Custom Fields, Dependencies, Relationships, Recurrence, Task Types.
--
-- Custom fields: typed definitions at the Space level (ClickUp scopes fields
-- to a location; space-level covers the M4 need), values stored per task as
-- jsonb so one table serves every field type. Validation of value-shape per
-- type happens in the API.
--
-- Dependencies: waiting_on (blocked by) edges between tasks; links are
-- symmetric-ish "related" edges stored once.
--
-- Recurrence: a rule on a task; when a recurring task is completed the API
-- clones it forward to the next occurrence.
--
-- Task types: ClickUp's custom task types (Task, Milestone, Bug, ...) —
-- a per-space catalogue; tasks get a nullable type + a milestone shortcut.

-- ---------------------------------------------------------------------------
-- Custom field definitions (per space).
-- ---------------------------------------------------------------------------
CREATE TABLE custom_fields (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  type         text NOT NULL CHECK (type IN
               ('text', 'number', 'money', 'date', 'dropdown', 'labels',
                'checkbox', 'url', 'email', 'phone', 'rating', 'progress')),
  -- type-specific config: dropdown/labels options [{id,name,color}], money
  -- currency, rating max, number precision...
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, name)
);
CREATE INDEX custom_fields_space_idx ON custom_fields (workspace_id, space_id, position);
ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_fields FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_fields_tenant ON custom_fields
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_fields TO stackup_app;

-- ---------------------------------------------------------------------------
-- Custom field values (per task, per field). jsonb `value` holds the typed
-- payload: {"text":"..."} | {"number":3} | {"optionIds":[..]} | etc. — the
-- API normalizes shapes; null value = unset (row deleted).
-- ---------------------------------------------------------------------------
CREATE TABLE custom_field_values (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  field_id     uuid NOT NULL REFERENCES custom_fields (id) ON DELETE CASCADE,
  value        jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, field_id)
);
CREATE INDEX custom_field_values_field_idx ON custom_field_values (workspace_id, field_id);
ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_values FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_field_values_tenant ON custom_field_values
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_values TO stackup_app;

-- ---------------------------------------------------------------------------
-- Dependencies: `task_id` WAITS ON `depends_on_task_id` (i.e. depends_on
-- blocks task). Same workspace enforced by RLS; cycle prevention in the API.
-- ---------------------------------------------------------------------------
CREATE TABLE task_dependencies (
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id            uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  created_by         uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);
CREATE INDEX task_dependencies_rev_idx ON task_dependencies (workspace_id, depends_on_task_id);
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY task_dependencies_tenant ON task_dependencies
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON task_dependencies TO stackup_app;

-- ---------------------------------------------------------------------------
-- Linked tasks ("relationships"): unordered related pairs, stored once with
-- task_a < task_b (API normalizes order).
-- ---------------------------------------------------------------------------
CREATE TABLE task_links (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_a       uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  task_b       uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_a, task_b),
  CHECK (task_a < task_b)
);
ALTER TABLE task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_links FORCE ROW LEVEL SECURITY;
CREATE POLICY task_links_tenant ON task_links
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON task_links TO stackup_app;

-- ---------------------------------------------------------------------------
-- Task types (per space): Task is implicit (type NULL); extras like
-- Milestone / Bug / Epic get an icon + name. `is_milestone` marks the
-- ClickUp-style diamond behaviour.
-- ---------------------------------------------------------------------------
CREATE TABLE task_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  icon         text NOT NULL DEFAULT '📌',
  is_milestone boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, name)
);
ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_types FORCE ROW LEVEL SECURITY;
CREATE POLICY task_types_tenant ON task_types
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON task_types TO stackup_app;

-- ---------------------------------------------------------------------------
-- Task columns for M4 features.
-- ---------------------------------------------------------------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type_id uuid REFERENCES task_types (id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_milestone boolean NOT NULL DEFAULT false;
-- Recurrence rule: {"freq":"daily|weekly|monthly","interval":1,"byweekday":[1,3],
-- "mode":"on_complete"|"on_schedule"} — cloned forward by the API on completion.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence jsonb;
