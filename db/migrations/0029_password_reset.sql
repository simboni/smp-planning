-- Module 27: password reset.
--
-- Short-lived, single-use reset tokens. Only the SHA-256 hash of the token is
-- stored (the plaintext is emailed once and never persisted), mirroring the
-- refresh_tokens design. Global identity-layer table — no RLS, like users and
-- refresh_tokens.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO stackup_app;
