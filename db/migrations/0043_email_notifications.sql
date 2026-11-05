-- 0043: Email notifications — assignments, @mentions and reminders by email,
-- under a daily cap.
--
-- Until now StackUp emailed only password resets. Notifications lived in the
-- in-app inbox, and reminders surfaced only when someone opened it. This adds
-- what a background sender (apps/api/src/comms/notification-mailer.service.ts)
-- needs to email them:
--
--   users.email_notify   each person's choice:
--                          instant  every assignment / mention as it happens
--                          digest   one summary a day instead
--                          off      no notification email (invites and
--                                   password resets still arrive)
--   notifications.email_state
--                          NULL      not looked at yet
--                          sent      emailed on its own (or in a small batch)
--                          digest    waiting for tomorrow's summary
--                          digested  went out in a summary
--                          skipped   never to be emailed (kind not emailed,
--                                    person said off, or too old)
--   reminders.emailed_at   set once the reminder's email has gone
--   email_sends            one row per email sent, for the daily cap. The
--                          relay's free plan is a hard daily limit shared with
--                          other apps, so the sender stops before it.
--
-- The history is marked done so turning this on does not email anyone about
-- last month's assignments.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_notify text NOT NULL DEFAULT 'instant'
  CHECK (email_notify IN ('instant', 'digest', 'off'));
GRANT UPDATE (email_notify) ON users TO stackup_app;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_state text
    CHECK (email_state IN ('sent', 'digest', 'digested', 'skipped')),
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
UPDATE notifications SET email_state = 'skipped' WHERE email_state IS NULL;

CREATE INDEX IF NOT EXISTS notifications_email_pending_idx
  ON notifications (workspace_id, created_at)
  WHERE email_state IS NULL OR email_state = 'digest';

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
-- Already due (or already shown in the inbox): not news any more.
UPDATE reminders SET emailed_at = now()
  WHERE emailed_at IS NULL AND (remind_at <= now() OR done_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS reminders_email_due_idx
  ON reminders (remind_at)
  WHERE emailed_at IS NULL AND done_at IS NULL;

-- Global, like password_reset_tokens: counting sends is not tenant data.
CREATE TABLE IF NOT EXISTS email_sends (
  id      bigserial PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now(),
  kind    text NOT NULL,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS email_sends_sent_at_idx ON email_sends (sent_at);
GRANT SELECT, INSERT, DELETE ON email_sends TO stackup_app;
GRANT USAGE ON SEQUENCE email_sends_id_seq TO stackup_app;

-- Which workspaces have email work waiting. The sender runs with no request
-- and no user, and stackup_app cannot see across tenants (that is the whole
-- isolation model), so this one question is answered by a SECURITY DEFINER
-- function — the pattern create_workspace_with_owner and delete_workspace
-- already use. It returns workspace ids only; the sender then reads each
-- workspace's rows under that workspace's own RLS context.
CREATE OR REPLACE FUNCTION email_pending_workspaces()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM notifications
   WHERE email_state IS NULL OR email_state = 'digest'
  UNION
  SELECT workspace_id FROM reminders
   WHERE emailed_at IS NULL AND done_at IS NULL AND remind_at <= now()
$$;
REVOKE ALL ON FUNCTION email_pending_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_pending_workspaces() TO stackup_app;
