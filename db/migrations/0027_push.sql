-- 0027: Push notifications (FCM). Device registration tokens live at the
-- identity layer (like refresh_tokens): a device belongs to a user, not to a
-- workspace, so the table is global with NO RLS and is queried via the plain
-- DbService.query() path. Delivery itself is dormant until the
-- FCM_SERVICE_ACCOUNT env is configured at the app layer.

CREATE TABLE push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text NOT NULL DEFAULT 'android',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON push_tokens TO stackup_app;
