-- 0011: Dashboards, reporting cards & Sprints.
--
-- Dashboards hold positioned cards; each card is a kind + jsonb config
-- (scope: which space/list/goal it reads, options). Data is computed at
-- read time by the API — cards store no results.
--
-- Sprints: a sprint wraps an existing List (1:1) with a date window.
-- Tasks gain sprint_points (story points). Velocity/burndown are computed
-- from completed_at + points inside the window.

CREATE TABLE dashboards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards FORCE ROW LEVEL SECURITY;
CREATE POLICY dashboards_tenant ON dashboards
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards TO stackup_app;

CREATE TABLE dashboard_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  dashboard_id uuid NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN
               ('statusBreakdown', 'assigneeLoad', 'priorityBreakdown',
                'timeTracked', 'goalProgress', 'sprintBurndown',
                'recentActivity', 'text')),
  title        text NOT NULL DEFAULT '',
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {spaceId?,listId?,goalId?,sprintId?,days?,text?}
  position     int NOT NULL DEFAULT 0,
  width        text NOT NULL DEFAULT 'half' CHECK (width IN ('half', 'full')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dashboard_cards_dash_idx ON dashboard_cards (workspace_id, dashboard_id, position);
ALTER TABLE dashboard_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY dashboard_cards_tenant ON dashboard_cards
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_cards TO stackup_app;

CREATE TABLE sprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  list_id      uuid NOT NULL UNIQUE REFERENCES lists (id) ON DELETE CASCADE,
  name         text NOT NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX sprints_space_idx ON sprints (workspace_id, space_id, archived, start_date);
ALTER TABLE sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprints FORCE ROW LEVEL SECURITY;
CREATE POLICY sprints_tenant ON sprints
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON sprints TO stackup_app;

-- Story points for sprint math (and general estimation).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_points int
  CHECK (sprint_points IS NULL OR (sprint_points >= 0 AND sprint_points <= 999));
