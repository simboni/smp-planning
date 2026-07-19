-- 0010: Goals (OKRs) & Portfolios.
--
-- Goals live in optional goal_folders. Each goal owns Targets (key results):
--   number   — progress from current vs start..target numbers
--   currency — same math, rendered as money
--   boolean  — done / not done
--   tasks    — completion ratio of the tasks linked via target_tasks
-- Goal progress = mean of its targets' progress (API-computed).
--
-- Portfolios group Lists into a roll-up card (per-list task/status counts).

CREATE TABLE goal_folders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#7B68EE',
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE goal_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_folders FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_folders_tenant ON goal_folders
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON goal_folders TO stackup_app;

CREATE TABLE goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  folder_id     uuid REFERENCES goal_folders (id) ON DELETE SET NULL,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  owner_user_id uuid REFERENCES users (id),
  due_date      date,
  archived      boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_workspace_idx ON goals (workspace_id, folder_id, archived);
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
CREATE POLICY goals_tenant ON goals
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON goals TO stackup_app;

CREATE TABLE targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  goal_id       uuid NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('number', 'currency', 'boolean', 'tasks')),
  start_value   numeric(18,2) NOT NULL DEFAULT 0,
  target_value  numeric(18,2) NOT NULL DEFAULT 100,
  current_value numeric(18,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'USD',
  done          boolean NOT NULL DEFAULT false,     -- boolean targets
  position      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX targets_goal_idx ON targets (workspace_id, goal_id, position);
ALTER TABLE targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE targets FORCE ROW LEVEL SECURITY;
CREATE POLICY targets_tenant ON targets
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON targets TO stackup_app;

-- Tasks linked to a 'tasks'-type target; progress = done tasks / all tasks.
CREATE TABLE target_tasks (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES targets (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  PRIMARY KEY (target_id, task_id)
);
ALTER TABLE target_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE target_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY target_tasks_tenant ON target_tasks
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON target_tasks TO stackup_app;

CREATE TABLE portfolios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#7B68EE',
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios FORCE ROW LEVEL SECURITY;
CREATE POLICY portfolios_tenant ON portfolios
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolios TO stackup_app;

CREATE TABLE portfolio_items (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  portfolio_id uuid NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
  list_id      uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  position     int NOT NULL DEFAULT 0,
  PRIMARY KEY (portfolio_id, list_id)
);
ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_items FORCE ROW LEVEL SECURITY;
CREATE POLICY portfolio_items_tenant ON portfolio_items
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_items TO stackup_app;
