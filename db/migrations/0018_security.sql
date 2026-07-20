-- 0018: Account security — TOTP two-factor auth & session metadata.
--
-- users gains an optional TOTP secret (base32) and an enabled flag. The secret
-- is stored so the server can verify 6-digit codes; it is only ever returned to
-- the client once, during enrollment (as a QR/otpauth URI), never afterward.
-- refresh_tokens gain device metadata so the account's active sessions can be
-- listed and revoked individually (session management). Both tables are global
-- (no RLS) — the same as the rest of the identity layer.

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;

-- Let the runtime role toggle 2FA on the caller's own row (0001 granted only
-- password_hash/full_name/avatar_url/status).
GRANT UPDATE (totp_secret, totp_enabled) ON users TO stackup_app;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent   text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
