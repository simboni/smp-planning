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
