-- 0003: Teams, Guests & Permissions.
--
-- Two new capabilities layered on the hierarchy:
--   1. Teams — named groups of workspace users, used to share with and
--      @mention many people at once.
--   2. Object sharing / ACL — a `shares` table granting a user OR a team a
--      permission level (view/comment/edit/full) on a Space (and, model-wise,
--      Folders/Lists too). Combined with spaces.is_private (added in 0002),
--      this drives intra-workspace visibility:
--        * public space (is_private = false) -> every non-guest member sees it
--        * private space -> only owner/admin + explicitly shared users/teams
--        * guests -> see nothing except objects shared with them
--
-- Enforcement of these intra-workspace rules lives in the API service layer
-- (AccessService), which is explicit and unit-tested. RLS remains the hard
-- WORKSPACE boundary (the security-critical isolation); sharing is a product
-- ACL on top of it. Every table below still carries workspace RLS.

-- ---------------------------------------------------------------------------
-- Teams (user groups)
-- ---------------------------------------------------------------------------
CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#7B68EE',
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX teams_workspace_idx ON teams (workspace_id);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
CREATE POLICY teams_tenant ON teams
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON teams TO stackup_app;

-- ---------------------------------------------------------------------------
-- Team membership
-- ---------------------------------------------------------------------------
CREATE TABLE team_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX team_members_team_idx ON team_members (workspace_id, team_id);
CREATE INDEX team_members_user_idx ON team_members (workspace_id, user_id);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;
CREATE POLICY team_members_tenant ON team_members
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON team_members TO stackup_app;

-- ---------------------------------------------------------------------------
-- Shares — object-level ACL. principal is a user or a team; permission is
-- ordered view < comment < edit < full. object_type is space/folder/list so
-- the same table serves the whole hierarchy (M2 enforces at the space level;
-- folder/list grants are stored and honored where present).
-- ---------------------------------------------------------------------------
CREATE TABLE shares (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  object_type    text NOT NULL CHECK (object_type IN ('space', 'folder', 'list')),
  object_id      uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'team')),
  principal_id   uuid NOT NULL,
  permission     text NOT NULL CHECK (permission IN ('view', 'comment', 'edit', 'full')),
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, principal_type, principal_id)
);

CREATE INDEX shares_object_idx ON shares (workspace_id, object_type, object_id);
CREATE INDEX shares_principal_idx ON shares (workspace_id, principal_type, principal_id);

ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares FORCE ROW LEVEL SECURITY;
CREATE POLICY shares_tenant ON shares
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON shares TO stackup_app;
