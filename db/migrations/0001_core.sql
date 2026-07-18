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
