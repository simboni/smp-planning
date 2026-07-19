-- 0015: Templates, ClickApps & Home.
--
-- Templates capture a serialized structure (task / list / doc / space) as a
-- jsonb payload that the API can re-instantiate into a target. ClickApps are
-- per-space feature toggles (ClickUp's pattern) stored as a jsonb map.
-- Search and Home are computed from existing tables — no storage here.

CREATE TABLE templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('task', 'list', 'doc', 'space')),
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  icon         text NOT NULL DEFAULT '📋',
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX templates_workspace_idx ON templates (workspace_id, kind, created_at DESC);
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;
CREATE POLICY templates_tenant ON templates
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON templates TO stackup_app;

-- Per-space ClickApps (feature toggles). Defaults: everything on. The UI
-- reflects these; API enforcement is best-effort for M14 (documented).
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS clickapps jsonb NOT NULL
  DEFAULT '{"timeTracking":true,"sprints":true,"customFields":true,"priorities":true,"tags":true,"dependencies":true,"milestones":true,"points":true}'::jsonb;

-- Optional per-user favorites (star spaces/lists/docs) — powers Home + sidebar.
CREATE TABLE favorites (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  entity_type  text NOT NULL CHECK (entity_type IN ('space', 'list', 'doc', 'whiteboard', 'dashboard')),
  entity_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);
CREATE INDEX favorites_user_idx ON favorites (workspace_id, user_id);
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites FORCE ROW LEVEL SECURITY;
CREATE POLICY favorites_tenant ON favorites
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON favorites TO stackup_app;
