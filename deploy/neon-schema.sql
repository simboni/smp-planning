-- ============================================================
-- StackUp — one-shot schema load for Neon (or any managed Postgres).
-- Paste this whole file into the Neon SQL Editor and Run.
--
-- It (1) creates the NOBYPASSRLS runtime role the API connects as,
-- (2) applies every migration in order, and (3) seeds schema_migrations
-- so a later `pnpm tsx db/migrate.ts` only runs NEW migrations.
--
-- >>> CHANGE THE PASSWORD on the next line before running. <<<
-- ============================================================

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stackup_app') THEN
    CREATE ROLE stackup_app LOGIN PASSWORD 'CHANGE_ME_strong_password' NOBYPASSRLS;
  END IF;
END
$role$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);


-- ==================== 0001_core.sql ====================
-- 0001: StackUp core — identity, workspaces, membership, audit.
--
-- Multi-tenancy pattern (fail-closed RLS):
--   * "Workspace" is the tenant boundary (ClickUp's top-level account).
--   * every workspace-owned table carries workspace_id + FORCE ROW LEVEL SECURITY.
--   * policies key off transaction-local settings app.current_workspace /
--     app.current_user, set via set_config(..., true) (SET LOCAL semantics),
--     safe under transaction-mode connection pooling.
--   * current_setting(name, true) yields NULL when unset, so with no workspace
--     context every policy evaluates false: DENY BY DEFAULT.
--   * stackup_app never owns tables and has NOBYPASSRLS, so RLS always binds it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Workspaces (the tenant / top-level account).
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  color      text NOT NULL DEFAULT '#7B68EE',   -- StackUp signature purple
  avatar_url text,
  status     text NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_self ON workspaces
  USING (id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Users (global identity: one login may belong to many workspaces).
-- Not workspace-scoped; access is app-guarded and the app role gets no DELETE.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  avatar_url    text,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'locked', 'closed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Memberships (workspace-scoped; also readable by the member themselves so a
-- signed-in user can list their workspaces before selecting one).
--   owner  — created the workspace; full control incl. billing/deletion.
--   admin  — manage members, spaces, settings; cannot delete the workspace.
--   member — standard seat; full access to shared work.
--   guest  — external collaborator, item-scoped access only (see M2).
-- ---------------------------------------------------------------------------
CREATE TABLE memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  user_id      uuid NOT NULL REFERENCES users (id),
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'suspended')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX memberships_workspace_idx ON memberships (workspace_id, user_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_read ON memberships FOR SELECT
  USING (
    workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user', true), '')::uuid
  );

CREATE POLICY membership_write ON memberships FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

CREATE POLICY membership_update ON memberships FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

CREATE POLICY membership_delete ON memberships FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

-- A signed-in user may read the workspaces they actively belong to (workspace
-- picker, pre-selection). The memberships subquery is itself subject to
-- memberships RLS, whose user_id arm grants exactly these rows.
CREATE POLICY workspace_member_read ON workspaces FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.workspace_id = workspaces.id
        AND m.user_id = NULLIF(current_setting('app.current_user', true), '')::uuid
        AND m.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- Refresh tokens (rotation). Stores only a SHA-256 hash of the opaque token;
-- rotation revokes the prior row. Workspace-independent (tied to the user).
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id),
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Audit log: append-only, hash-chained per workspace. The app computes each
-- row's hash over (prev_hash, payload) so any tampering breaks the chain.
-- No UPDATE/DELETE grant + a blocking trigger make it immutable at the DB.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id),
  actor_user_id uuid REFERENCES users (id),
  action        text NOT NULL,
  entity        text NOT NULL,
  entity_id     text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text,
  hash          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_workspace_idx ON audit_log (workspace_id, created_at);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_read ON audit_log FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

CREATE POLICY audit_append ON audit_log FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Workspace provisioning. SECURITY DEFINER so a signed-in user (who has no
-- INSERT on workspaces) can atomically create a workspace + owner membership.
-- Runs as the function owner (stackup_migrator) which bypasses the app's
-- RLS, but the function body is the ONLY write path to workspaces.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_workspace_with_owner(
  p_name    text,
  p_slug    text,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  INSERT INTO workspaces (name, slug)
    VALUES (p_name, p_slug)
    RETURNING id INTO v_workspace_id;
  INSERT INTO memberships (workspace_id, user_id, role)
    VALUES (v_workspace_id, p_user_id, 'owner');
  RETURN v_workspace_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The runtime role gets DML only — never DDL, never table ownership.
-- ---------------------------------------------------------------------------
GRANT SELECT ON workspaces TO stackup_app;
GRANT SELECT, INSERT ON users TO stackup_app;             -- signup; no UPDATE/DELETE yet
GRANT UPDATE (password_hash, full_name, avatar_url, status) ON users TO stackup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO stackup_app;
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO stackup_app;
GRANT SELECT, INSERT ON audit_log TO stackup_app;
GRANT EXECUTE ON FUNCTION create_workspace_with_owner(text, text, uuid) TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0001_core.sql') ON CONFLICT DO NOTHING;

-- ==================== 0002_hierarchy.sql ====================
-- 0002: The Hierarchy — Spaces -> Folders -> Lists.
--
-- ClickUp's structure: a Workspace contains Spaces; a Space contains Folders
-- and/or folderless Lists; a Folder contains Lists. Tasks (M3) will live in
-- Lists. Every table follows the workspace-RLS pattern from 0001.
--
-- Ordering: each container keeps an integer sort_order for manual arrangement.
-- Deletion cascades down (delete a Space -> its Folders and Lists go too);
-- soft-hiding is done with `archived` (ClickUp's "archive") so nothing is lost
-- unless explicitly deleted.

-- ---------------------------------------------------------------------------
-- Spaces — the top division inside a workspace (department / team / client).
-- ---------------------------------------------------------------------------
CREATE TABLE spaces (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#7B68EE',
  icon         text,                              -- emoji or icon key, optional
  is_private   boolean NOT NULL DEFAULT false,    -- full permissions land in M2
  archived     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX spaces_workspace_idx ON spaces (workspace_id, archived, sort_order);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
CREATE POLICY spaces_tenant ON spaces
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON spaces TO stackup_app;

-- ---------------------------------------------------------------------------
-- Folders — optional grouping of Lists inside a Space.
-- ---------------------------------------------------------------------------
CREATE TABLE folders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  archived     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX folders_space_idx ON folders (workspace_id, space_id, archived, sort_order);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders FORCE ROW LEVEL SECURITY;
CREATE POLICY folders_tenant ON folders
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO stackup_app;

-- ---------------------------------------------------------------------------
-- Lists — the container that will hold Tasks (M3). A List belongs to a Space
-- and is EITHER inside a Folder (folder_id set) OR folderless (folder_id NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  folder_id    uuid REFERENCES folders (id) ON DELETE CASCADE,   -- NULL = folderless
  name         text NOT NULL,
  color        text,
  archived     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lists_space_idx ON lists (workspace_id, space_id, folder_id, archived, sort_order);

ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE lists FORCE ROW LEVEL SECURITY;
CREATE POLICY lists_tenant ON lists
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON lists TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0002_hierarchy.sql') ON CONFLICT DO NOTHING;

-- ==================== 0003_permissions.sql ====================
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
INSERT INTO schema_migrations (filename) VALUES ('0003_permissions.sql') ON CONFLICT DO NOTHING;

-- ==================== 0004_tasks.sql ====================
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
INSERT INTO schema_migrations (filename) VALUES ('0004_tasks.sql') ON CONFLICT DO NOTHING;

-- ==================== 0005_fields_deps.sql ====================
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
INSERT INTO schema_migrations (filename) VALUES ('0005_fields_deps.sql') ON CONFLICT DO NOTHING;

-- ==================== 0006_views.sql ====================
-- 0006: Views Engine — saved views on Lists.
--
-- A view is a named lens on a List's tasks: its kind (list/board/calendar/
-- table/gantt) plus a jsonb config carrying filters, sort, grouping and
-- per-kind options. Default views are implicit (every list always offers all
-- kinds); rows here store user-customized/saved configurations. Personal
-- views (created_by, is_shared=false) are visible only to their creator;
-- shared views to everyone who can see the list.

CREATE TABLE views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  list_id      uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('list', 'board', 'calendar', 'table', 'gantt')),
  -- {filters:{statusIds?,assigneeIds?,priorities?,tagIds?,dueFrom?,dueTo?,
  --  includeDone?}, sort:{key,dir}, groupBy:'status'|'assignee'|'priority'|'tag'|null,
  --  columns?:[...]} — API validates loosely, client owns semantics.
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared    boolean NOT NULL DEFAULT true,
  position     int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX views_list_idx ON views (workspace_id, list_id, position);

ALTER TABLE views ENABLE ROW LEVEL SECURITY;
ALTER TABLE views FORCE ROW LEVEL SECURITY;
CREATE POLICY views_tenant ON views
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON views TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0006_views.sql') ON CONFLICT DO NOTHING;

-- ==================== 0007_collab.sql ====================
-- 0007: Real-time collaboration — comments, activity, notifications, reminders.
--
-- Comments: threaded via parent_comment_id; "assigned comments" carry an
-- assignee and a resolved flag (ClickUp's action-item comments).
-- Activity: an append-only per-task event feed written by the API alongside
-- task mutations (created, status, assignee, dates, priority, ...).
-- Notifications: per-user inbox rows generated on mention / assignment /
-- comment; read_at marks them seen.
-- Reminders: personal pings with a remind_at instant.

CREATE TABLE comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id           uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES comments (id) ON DELETE CASCADE,
  author_user_id    uuid NOT NULL REFERENCES users (id),
  body              text NOT NULL,
  assignee_user_id  uuid REFERENCES users (id),     -- assigned comment
  resolved_at       timestamptz,
  edited_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_task_idx ON comments (workspace_id, task_id, created_at);
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
CREATE POLICY comments_tenant ON comments
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON comments TO stackup_app;

CREATE TABLE task_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users (id),
  kind          text NOT NULL,          -- created|status|priority|dates|assignee|name|description|archived|completed|comment|...
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {from,to,...} per kind
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_activity_task_idx ON task_activity (workspace_id, task_id, created_at DESC);
ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY task_activity_tenant ON task_activity
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT ON task_activity TO stackup_app;

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL,          -- mention|assigned|comment|status|reminder
  task_id       uuid REFERENCES tasks (id) ON DELETE CASCADE,
  comment_id    uuid REFERENCES comments (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users (id),
  message       text NOT NULL DEFAULT '',
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (workspace_id, user_id, read_at, created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant ON notifications
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO stackup_app;

CREATE TABLE reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  task_id      uuid REFERENCES tasks (id) ON DELETE CASCADE,   -- optional link
  note         text NOT NULL,
  remind_at    timestamptz NOT NULL,
  done_at      timestamptz,
  notified_at  timestamptz,             -- set when surfaced into notifications
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_user_idx ON reminders (workspace_id, user_id, remind_at);
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY reminders_tenant ON reminders
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON reminders TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0007_collab.sql') ON CONFLICT DO NOTHING;

-- ==================== 0008_docs.sql ====================
-- 0008: Docs, wikis & Notepad.
--
-- A Doc is a container of nested Pages (parent_page_id tree). Docs live in
-- the workspace and may be attached to a Space (space_id) — attached docs
-- follow the space's permissions; unattached docs are workspace-wide, or
-- private to their creator (is_private). Page content is stored as HTML
-- produced by the editor (sanitized server-side).
--
-- Notepad: personal scratch notes (per user), convertible into tasks.

CREATE TABLE docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid REFERENCES spaces (id) ON DELETE SET NULL,
  name         text NOT NULL,
  icon         text NOT NULL DEFAULT '📄',
  is_private   boolean NOT NULL DEFAULT false,   -- creator-only when unattached
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX docs_workspace_idx ON docs (workspace_id, space_id);
ALTER TABLE docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs FORCE ROW LEVEL SECURITY;
CREATE POLICY docs_tenant ON docs
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON docs TO stackup_app;

CREATE TABLE doc_pages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  doc_id         uuid NOT NULL REFERENCES docs (id) ON DELETE CASCADE,
  parent_page_id uuid REFERENCES doc_pages (id) ON DELETE CASCADE,
  title          text NOT NULL DEFAULT 'Untitled',
  content        text NOT NULL DEFAULT '',
  position       int NOT NULL DEFAULT 0,
  updated_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_pages_doc_idx ON doc_pages (workspace_id, doc_id, parent_page_id, position);
ALTER TABLE doc_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_pages_tenant ON doc_pages
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_pages TO stackup_app;

CREATE TABLE notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  content      text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_user_idx ON notes (workspace_id, user_id, updated_at DESC);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
CREATE POLICY notes_tenant ON notes
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0008_docs.sql') ON CONFLICT DO NOTHING;

-- ==================== 0009_time.sql ====================
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
INSERT INTO schema_migrations (filename) VALUES ('0009_time.sql') ON CONFLICT DO NOTHING;

-- ==================== 0010_goals.sql ====================
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
INSERT INTO schema_migrations (filename) VALUES ('0010_goals.sql') ON CONFLICT DO NOTHING;

-- ==================== 0011_dashboards_sprints.sql ====================
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
INSERT INTO schema_migrations (filename) VALUES ('0011_dashboards_sprints.sql') ON CONFLICT DO NOTHING;

-- ==================== 0012_forms_automations.sql ====================
-- 0012: Forms (public intake) & Automations.
--
-- Forms: a form targets a List; its fields live in jsonb config. A public
-- token exposes an unauthenticated fill+submit endpoint; each submission
-- creates a task in the target list.
--
-- Automations: per-space rules -- trigger (jsonb) + actions (jsonb array),
-- evaluated by the API when task events happen (and by a periodic scan for
-- due-date triggers). automation_runs is the execution log.

CREATE TABLE forms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  list_id      uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  -- [{id,label,type:'text'|'textarea'|'email'|'number'|'select'|'date'|'checkbox',
  --   required:bool, options?:[..], asTitle?:bool}]
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_token text NOT NULL UNIQUE,
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_workspace_idx ON forms (workspace_id, list_id);
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms FORCE ROW LEVEL SECURITY;
CREATE POLICY forms_tenant ON forms
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
-- The public submit path runs WITHOUT a workspace context: a dedicated
-- fail-closed policy arm grants SELECT by exact token match only.
CREATE POLICY forms_public_read ON forms FOR SELECT
  USING (public_token = NULLIF(current_setting('app.form_token', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON forms TO stackup_app;

CREATE TABLE automations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- {type:'task.created'|'status.changed'|'priority.changed'|'assignee.added'|'due.overdue',
  --  toStatusId?, toPriority?}
  trigger      jsonb NOT NULL,
  -- [{type:'set.status',statusId}|{type:'set.priority',priority}|
  --  {type:'add.assignee',userId}|{type:'add.tag',tagId}|{type:'post.comment',body}]
  actions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled      boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automations_space_idx ON automations (workspace_id, space_id, enabled);
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations FORCE ROW LEVEL SECURITY;
CREATE POLICY automations_tenant ON automations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON automations TO stackup_app;

CREATE TABLE automation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations (id) ON DELETE CASCADE,
  task_id       uuid REFERENCES tasks (id) ON DELETE SET NULL,
  ok            boolean NOT NULL,
  detail        text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_runs_auto_idx ON automation_runs (workspace_id, automation_id, created_at DESC);
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_runs_tenant ON automation_runs
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT ON automation_runs TO stackup_app;

-- Guard automations from re-firing 'due.overdue' repeatedly per task.
CREATE TABLE automation_fired (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations (id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  fired_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, task_id)
);
ALTER TABLE automation_fired ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_fired FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_fired_tenant ON automation_fired
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON automation_fired TO stackup_app;

-- Public submissions insert tasks without a workspace-scoped session; the
-- API uses a SECURITY DEFINER function so the public path can never touch
-- anything beyond creating one task in the form's target list.
CREATE OR REPLACE FUNCTION submit_form_task(
  p_token text,
  p_name  text,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_form forms%ROWTYPE;
  v_space uuid;
  v_status uuid;
  v_task uuid;
  v_pos numeric;
BEGIN
  SELECT * INTO v_form FROM forms
    WHERE public_token = p_token AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  SELECT space_id INTO v_space FROM lists WHERE id = v_form.list_id;
  -- first not-done status by position
  SELECT id INTO v_status FROM statuses
    WHERE space_id = v_space AND type <> 'done'
    ORDER BY position LIMIT 1;
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos FROM tasks
    WHERE list_id = v_form.list_id AND parent_task_id IS NULL;
  INSERT INTO tasks (workspace_id, list_id, space_id, name, description,
                     status_id, position)
    VALUES (v_form.workspace_id, v_form.list_id, v_space,
            LEFT(p_name, 500), LEFT(p_description, 10000), v_status, v_pos)
    RETURNING id INTO v_task;
  RETURN v_task;
END;
$$;
GRANT EXECUTE ON FUNCTION submit_form_task(text, text, text) TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0012_forms_automations.sql') ON CONFLICT DO NOTHING;

-- ==================== 0013_visual.sql ====================
-- 0013: Visual collaboration — files/attachments, whiteboards, mind maps,
-- proofing annotations. (Clips ride on files: a clip is a video attachment.)
--
-- Files are stored IN the database (bytea, 5MB cap enforced in the API).
-- Pragmatic for self-hosting: no external object store, RLS applies, backups
-- carry the data. Large-file offloading is a future adapter.

CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks (id) ON DELETE CASCADE,  -- attachment home (nullable for future doc/chat files)
  name         text NOT NULL,
  mime         text NOT NULL,
  size_bytes   int NOT NULL CHECK (size_bytes >= 0),
  data         bytea NOT NULL,
  is_clip      boolean NOT NULL DEFAULT false,   -- screen recording
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_task_idx ON files (workspace_id, task_id, created_at);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY files_tenant ON files
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON files TO stackup_app;

-- Whiteboards: elements live in one jsonb document
-- [{id,kind:'sticky'|'rect'|'ellipse'|'text'|'arrow',x,y,w,h,text,color,
--   points?:[{x,y}] (arrow), fontSize?}] — client-owned schema, size-capped.
CREATE TABLE whiteboards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid REFERENCES spaces (id) ON DELETE SET NULL,
  name         text NOT NULL,
  elements     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by   uuid REFERENCES users (id),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whiteboards_workspace_idx ON whiteboards (workspace_id, updated_at DESC);
ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboards FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboards_tenant ON whiteboards
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON whiteboards TO stackup_app;

-- Mind maps: a node tree in jsonb {id,text,children:[...],collapsed?}.
CREATE TABLE mindmaps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  space_id     uuid REFERENCES spaces (id) ON DELETE SET NULL,
  name         text NOT NULL,
  root         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by   uuid REFERENCES users (id),
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mindmaps_workspace_idx ON mindmaps (workspace_id, updated_at DESC);
ALTER TABLE mindmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE mindmaps FORCE ROW LEVEL SECURITY;
CREATE POLICY mindmaps_tenant ON mindmaps
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON mindmaps TO stackup_app;

-- Proofing: pinned annotations on an (image) file, each with its text.
-- x/y are 0..1 fractions of the rendered image.
CREATE TABLE proof_annotations (
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
CREATE INDEX proof_annotations_file_idx ON proof_annotations (workspace_id, file_id, created_at);
ALTER TABLE proof_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_annotations FORCE ROW LEVEL SECURITY;
CREATE POLICY proof_annotations_tenant ON proof_annotations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON proof_annotations TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0013_visual.sql') ON CONFLICT DO NOTHING;

-- ==================== 0014_chat.sql ====================
-- 0014: Chat — channels, DMs, threaded messages, reactions; SyncUp huddles;
-- task email log.
--
-- A channel is either a named public channel (is_dm=false) or a direct message
-- (is_dm=true, membership defines the participants). Messages thread via
-- parent_message_id. channel_members.last_read_at drives unread counts.

CREATE TABLE channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  is_dm        boolean NOT NULL DEFAULT false,
  -- canonical sorted member-id key for DMs, so a pair maps to one channel.
  dm_key       text UNIQUE,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channels_workspace_idx ON channels (workspace_id, is_dm);
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels FORCE ROW LEVEL SECURITY;
CREATE POLICY channels_tenant ON channels
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON channels TO stackup_app;

CREATE TABLE channel_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id   uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, user_id)
);
CREATE INDEX channel_members_user_idx ON channel_members (workspace_id, user_id);
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_members_tenant ON channel_members
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_members TO stackup_app;

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id        uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  parent_message_id uuid REFERENCES messages (id) ON DELETE CASCADE,
  author_user_id    uuid NOT NULL REFERENCES users (id),
  body              text NOT NULL,
  edited_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_channel_idx ON messages (workspace_id, channel_id, created_at);
CREATE INDEX messages_thread_idx ON messages (workspace_id, parent_message_id, created_at);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_tenant ON messages
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO stackup_app;

CREATE TABLE message_reactions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  message_id   uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  emoji        text NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions FORCE ROW LEVEL SECURITY;
CREATE POLICY message_reactions_tenant ON message_reactions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON message_reactions TO stackup_app;

-- SyncUps: a lightweight call/huddle marker per channel. Real A/V signaling is
-- future work; this records who's in the huddle and when it ran.
CREATE TABLE syncups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id   uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  started_by   uuid REFERENCES users (id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
ALTER TABLE syncups ENABLE ROW LEVEL SECURITY;
ALTER TABLE syncups FORCE ROW LEVEL SECURITY;
CREATE POLICY syncups_tenant ON syncups
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON syncups TO stackup_app;

-- Email-in-task: outbound messages composed from a task (logged; real SMTP is
-- a pluggable adapter, disabled by default) and simulated inbound replies.
CREATE TABLE task_emails (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  direction    text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_addr    text NOT NULL,
  to_addr      text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  sent_by      uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_emails_task_idx ON task_emails (workspace_id, task_id, created_at);
ALTER TABLE task_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_emails FORCE ROW LEVEL SECURITY;
CREATE POLICY task_emails_tenant ON task_emails
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON task_emails TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0014_chat.sql') ON CONFLICT DO NOTHING;

-- ==================== 0015_templates_clickapps.sql ====================
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
INSERT INTO schema_migrations (filename) VALUES ('0015_templates_clickapps.sql') ON CONFLICT DO NOTHING;

-- ==================== 0016_api_webhooks.sql ====================
-- 0016: Public API (Personal Access Tokens) & outbound Webhooks.
--
-- Module 15 ships a public REST surface authenticated by Personal Access
-- Tokens (PATs) and workspace-scoped outbound webhooks. The AI Brain is
-- stateless (no storage here) — it reads existing rows and returns text.
--
-- PATs mirror the refresh-token secrecy model: only a SHA-256 hash is stored,
-- so a DB dump never yields a usable token. Because the public-API guard must
-- resolve a token to its workspace BEFORE any tenant context exists, the RLS
-- policy carries a second arm keyed on a per-transaction `app.pat_token`
-- setting (the same trick 0011 uses for public forms via `app.form_token`).
-- That arm admits exactly the one row whose hash matches; every other policy
-- in the schema still denies, so the context can see nothing else.

CREATE TABLE personal_access_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id),
  name         text NOT NULL,
  -- SHA-256 hex of the plaintext token; the plaintext is shown once, never stored.
  token_hash   text NOT NULL UNIQUE,
  -- first 12 chars of the plaintext ("stackup_pat_ab…") for UI identification.
  token_prefix text NOT NULL DEFAULT '',
  -- 'read' → GET only; 'write' → full CRUD on the public API.
  scope        text NOT NULL DEFAULT 'write' CHECK (scope IN ('read', 'write')),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pat_workspace_idx ON personal_access_tokens (workspace_id, created_at DESC);
ALTER TABLE personal_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_access_tokens FORCE ROW LEVEL SECURITY;
-- Read arm: the owning workspace, OR the auth path that presents a matching
-- token hash via app.pat_token. Writes (create/revoke) require workspace context.
CREATE POLICY pat_tenant ON personal_access_tokens
  USING (
    workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid
    OR token_hash = NULLIF(current_setting('app.pat_token', true), '')
  )
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON personal_access_tokens TO stackup_app;

-- Outbound webhooks. `events` is the set of event types the endpoint wants
-- (e.g. 'task.changed', 'comment.changed'); '*' matches all. `secret` signs
-- each delivery (HMAC-SHA256 → X-StackUp-Signature header).
CREATE TABLE webhooks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  url          text NOT NULL,
  secret       text NOT NULL,
  events       text[] NOT NULL DEFAULT ARRAY['*']::text[],
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_workspace_idx ON webhooks (workspace_id, active);
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;
CREATE POLICY webhooks_tenant ON webhooks
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks TO stackup_app;

-- Delivery log: one row per dispatch attempt, newest first per webhook.
CREATE TABLE webhook_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  webhook_id   uuid NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  event        text NOT NULL,
  status_code  int,
  ok           boolean NOT NULL DEFAULT false,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_idx ON webhook_deliveries (workspace_id, webhook_id, created_at DESC);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant ON webhook_deliveries
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON webhook_deliveries TO stackup_app;
INSERT INTO schema_migrations (filename) VALUES ('0016_api_webhooks.sql') ON CONFLICT DO NOTHING;

-- ==================== 0017_provision_without_bypassrls.sql ====================
-- 0017: Make workspace provisioning work on managed Postgres (no BYPASSRLS).
--
-- create_workspace_with_owner (0001) is SECURITY DEFINER and, as written,
-- relied on its owner role (stackup_migrator) having BYPASSRLS to insert the
-- first workspace + owner-membership rows before any tenant context exists.
-- Managed providers (Neon, Supabase, RDS) do not grant BYPASSRLS, so that
-- path would be denied by FORCE ROW LEVEL SECURITY.
--
-- Fix: the function pre-generates the workspace id, sets the transaction-local
-- tenant context to it, and inserts with that explicit id — so the workspaces
-- `workspace_self` policy (id = app.current_workspace, which also gates INSERT)
-- and the memberships `membership_write` WITH CHECK both pass under RLS, with
-- no bypass required. Prior context is captured and restored so a caller that
-- wraps this in a larger transaction is unaffected. This is equally correct
-- when the owner DOES have BYPASSRLS (self-hosted), so it supersedes the 0001
-- definition on every deployment.

CREATE OR REPLACE FUNCTION create_workspace_with_owner(
  p_name    text,
  p_slug    text,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_workspace_id uuid := gen_random_uuid();
  v_prev_ws      text := current_setting('app.current_workspace', true);
  v_prev_user    text := current_setting('app.current_user', true);
BEGIN
  -- Bind context to the workspace-to-be so both inserts satisfy their RLS
  -- WITH CHECK arms without needing BYPASSRLS.
  PERFORM set_config('app.current_workspace', v_workspace_id::text, true);
  PERFORM set_config('app.current_user', p_user_id::text, true);

  INSERT INTO workspaces (id, name, slug)
    VALUES (v_workspace_id, p_name, p_slug);
  INSERT INTO memberships (workspace_id, user_id, role)
    VALUES (v_workspace_id, p_user_id, 'owner');

  -- Restore whatever context the caller had (empty when invoked via the
  -- non-transactional pool path, as workspaces.service.ts does today).
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  PERFORM set_config('app.current_user', coalesce(v_prev_user, ''), true);

  RETURN v_workspace_id;
END;
$$;

-- submit_form_task (0012) had the same BYPASSRLS dependency: the public
-- submit path runs under app.form_token only, so once the function's owner
-- can't bypass RLS, its reads of lists/statuses and its INSERT into tasks are
-- denied (those policies key on app.current_workspace, which is unset on the
-- public path). Fix: after admitting the form via the form_token policy, bind
-- the tenant context to that form's own workspace for the rest of the body,
-- then restore. The public caller still can't reach anything but this one
-- form's target list, exactly as before.
CREATE OR REPLACE FUNCTION submit_form_task(
  p_token text,
  p_name  text,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_form forms%ROWTYPE;
  v_space uuid;
  v_status uuid;
  v_task uuid;
  v_pos numeric;
  v_prev_ws text := current_setting('app.current_workspace', true);
BEGIN
  SELECT * INTO v_form FROM forms
    WHERE public_token = p_token AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'form not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  -- Bind to the form's workspace so the remaining reads/writes pass RLS
  -- without BYPASSRLS.
  PERFORM set_config('app.current_workspace', v_form.workspace_id::text, true);
  SELECT space_id INTO v_space FROM lists WHERE id = v_form.list_id;
  SELECT id INTO v_status FROM statuses
    WHERE space_id = v_space AND type <> 'done'
    ORDER BY position LIMIT 1;
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos FROM tasks
    WHERE list_id = v_form.list_id AND parent_task_id IS NULL;
  INSERT INTO tasks (workspace_id, list_id, space_id, name, description,
                     status_id, position)
    VALUES (v_form.workspace_id, v_form.list_id, v_space,
            LEFT(p_name, 500), LEFT(p_description, 10000), v_status, v_pos)
    RETURNING id INTO v_task;
  PERFORM set_config('app.current_workspace', coalesce(v_prev_ws, ''), true);
  RETURN v_task;
END;
$$;
INSERT INTO schema_migrations (filename) VALUES ('0017_provision_without_bypassrls.sql') ON CONFLICT DO NOTHING;
