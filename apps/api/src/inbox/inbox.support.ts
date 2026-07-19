import type { PoolClient } from "pg";

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
    kind: "mention" | "assigned" | "comment" | "status" | "reminder" | "timesheet";
    taskId?: string | null;
    commentId?: string | null;
    actorUserId?: string | null;
    message?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO notifications
       (workspace_id, user_id, kind, task_id, comment_id, actor_user_id, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      n.workspaceId,
      n.userId,
      n.kind,
      n.taskId ?? null,
      n.commentId ?? null,
      n.actorUserId ?? null,
      n.message ?? "",
    ],
  );
}
