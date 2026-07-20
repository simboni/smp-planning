-- 0020: SSO — link a user identity to an external OAuth provider (Google).
--
-- An OAuth user is still a normal `users` row (so memberships, tokens and RLS
-- all work unchanged); it simply carries the provider + provider-subject it was
-- authenticated by. password_hash stays NOT NULL: OAuth-only accounts get an
-- unusable random hash (they never sign in with a password), exactly like the
-- shell users created by member invites. A user can hold both a password and a
-- linked provider — signing in either way lands on the same account.

ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_subject  text;

-- One external identity maps to at most one user. Partial: only enforced for
-- rows that actually carry a provider link.
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_identity_key
  ON users (oauth_provider, oauth_subject)
  WHERE oauth_provider IS NOT NULL;

-- Let the runtime role link/unlink a provider on the user's own row.
GRANT UPDATE (oauth_provider, oauth_subject) ON users TO stackup_app;
