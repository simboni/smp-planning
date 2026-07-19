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
