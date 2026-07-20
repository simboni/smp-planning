-- ===========================================================================
-- StackUp — Neon catch-up migration (schema 0018 → 0025)
--
-- Paste this whole file into the Neon SQL editor and Run. It brings a database
-- that was bootstrapped by hand (schema through 0017) up to the current code,
-- which is what fixes the "internal server error" on login (the code reads
-- users.totp_enabled, added in 0018).
--
-- Every statement is idempotent — running it twice is harmless. It records the
-- files in schema_migrations so the app's new auto-migrator treats them as
-- applied afterwards.
-- ===========================================================================

BEGIN;

-- Ensure the migration ledger exists (the app uses it going forward).
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ---- 0018: Account security (2FA + session metadata) ----------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
GRANT UPDATE (totp_secret, totp_enabled) ON users TO stackup_app;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent   text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- ---- 0019: Governance (custom roles) --------------------------------------
CREATE TABLE IF NOT EXISTS custom_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  base_role    text NOT NULL CHECK (base_role IN ('member', 'guest')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS custom_roles_workspace_idx ON custom_roles (workspace_id);
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custom_roles_tenant ON custom_roles;
CREATE POLICY custom_roles_tenant ON custom_roles
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles TO stackup_app;
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES custom_roles (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS memberships_custom_role_idx
  ON memberships (workspace_id, custom_role_id);

-- ---- 0020: SSO (Google OAuth link) ----------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_subject  text;
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_identity_key
  ON users (oauth_provider, oauth_subject)
  WHERE oauth_provider IS NOT NULL;
GRANT UPDATE (oauth_provider, oauth_subject) ON users TO stackup_app;

-- ---- 0021: Branding (editable workspace name/color/logo) -------------------
GRANT UPDATE (name, color, avatar_url) ON workspaces TO stackup_app;

-- ---- 0022: Timeline view kind ---------------------------------------------
ALTER TABLE views DROP CONSTRAINT IF EXISTS views_kind_check;
ALTER TABLE views
  ADD CONSTRAINT views_kind_check
  CHECK (kind IN ('list', 'board', 'calendar', 'table', 'gantt', 'timeline'));

-- ---- 0023: Limits & metering (per-workspace overrides) --------------------
CREATE TABLE IF NOT EXISTS workspace_limits (
  workspace_id             uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  storage_limit_bytes      bigint,
  automations_monthly_limit int,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspace_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_limits_tenant ON workspace_limits;
CREATE POLICY workspace_limits_tenant ON workspace_limits
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT ON workspace_limits TO stackup_app;

-- ---- 0024: Advanced dashboard card kinds ----------------------------------
ALTER TABLE dashboard_cards DROP CONSTRAINT IF EXISTS dashboard_cards_kind_check;
ALTER TABLE dashboard_cards
  ADD CONSTRAINT dashboard_cards_kind_check
  CHECK (kind IN (
    'statusBreakdown', 'assigneeLoad', 'priorityBreakdown',
    'timeTracked', 'goalProgress', 'sprintBurndown',
    'recentActivity', 'text',
    'completionTrend', 'overdueByAssignee'
  ));

-- ---- 0025: Comms (Slack integration) --------------------------------------
CREATE TABLE IF NOT EXISTS slack_integrations (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  webhook_url  text NOT NULL,
  events       jsonb NOT NULL DEFAULT '["*"]'::jsonb,
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users (id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_integrations_tenant ON slack_integrations;
CREATE POLICY slack_integrations_tenant ON slack_integrations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON slack_integrations TO stackup_app;

-- Record all of the above as applied so the app's auto-migrator skips them.
INSERT INTO schema_migrations (filename) VALUES
  ('0018_security.sql'),
  ('0019_governance.sql'),
  ('0020_sso.sql'),
  ('0021_branding.sql'),
  ('0022_timeline_view.sql'),
  ('0023_limits.sql'),
  ('0024_advanced_cards.sql'),
  ('0025_comms.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
