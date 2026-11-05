import type { PoolClient } from "pg";

/**
 * The notification kinds that are also emailed (see 0043 and
 * comms/notification-mailer.service.ts). Comments, status changes, chat and
 * the rest stay in the inbox only; they are marked 'skipped' as they are
 * written so the sender never has to look at them.
 */
export const EMAILED_KINDS = ["assigned", "mention"] as const;

/**
 * Insert one inbox notification row. Shared by comments (mention / comment /
 * assigned-comment), tasks (task assignment) and the inbox itself (due
 * reminders). Always runs on the caller's withWorkspace client so the
 * notification commits atomically with the action that caused it; callers
 * publish `notification.new` on the events bus AFTER their transaction.
 */
export async function insertNotification(
  client: PoolClient,
  n: {
    workspaceId: string;
    userId: string;
    kind:
      | "mention"
      | "assigned"
      | "comment"
      | "status"
      | "reminder"
      | "timesheet"
      | "chat";
    taskId?: string | null;
    commentId?: string | null;
    actorUserId?: string | null;
    message?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO notifications
       (workspace_id, user_id, kind, task_id, comment_id, actor_user_id, message,
        email_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      n.workspaceId,
      n.userId,
      n.kind,
      n.taskId ?? null,
      n.commentId ?? null,
      n.actorUserId ?? null,
      n.message ?? "",
      (EMAILED_KINDS as readonly string[]).includes(n.kind) ? null : "skipped",
    ],
  );
}
