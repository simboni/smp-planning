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
