import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { DbService } from "../db/db.service";
import { EventsService } from "../events/events.service";
import { PushService } from "../push/push.service";
import { parseDate, requireName } from "../tasks/tasks.support";
import { insertNotification } from "./inbox.support";

interface ActorRef {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface NotificationItem {
  id: string;
  kind: string;
  message: string;
  taskId: string | null;
  taskName: string | null;
  commentId: string | null;
  actor: ActorRef | null;
  readAt: string | null;
  createdAt: string;
}

export interface ReminderItem {
  id: string;
  note: string;
  remindAt: string;
  taskId: string | null;
  taskName: string | null;
  doneAt: string | null;
  createdAt: string;
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Module 6: the personal inbox — notifications (written by comments / task
 * assignment / reminders) and the caller's reminders. Everything here is
 * scoped hard to the calling user (user_id = token sub) on top of the
 * workspace RLS boundary; there is no way to read or ack another user's
 * inbox. Due reminders are surfaced lazily: listing notifications first
 * converts any ripe, un-notified reminder into a 'reminder' notification
 * (no background scheduler needed).
 */
@Injectable()
export class InboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboxService.name);
  private untap: (() => void) | null = null;

  constructor(
    private readonly db: DbService,
    private readonly events: EventsService,
    private readonly push: PushService,
  ) {}

  // --- Mobile push bridge ---------------------------------------------------

  /**
   * Producers publish `notification.new` on the event bus AFTER their
   * transaction commits (see inbox.support.ts), so tapping the bus here is
   * the one after-commit hook that covers every notification writer. The
   * dispatch is fire-and-forget and dormant until FCM is configured.
   */
  onModuleInit(): void {
    this.untap = this.events.tap((workspaceId, event) => {
      if (event.type !== "notification.new") return;
      const userId =
        typeof event.payload?.userId === "string" ? event.payload.userId : null;
      if (!userId || !this.push.enabled()) return;
      void this.pushLatestNotification(workspaceId, userId).catch((err) =>
        this.logger.warn(`push dispatch error: ${(err as Error).message}`),
      );
    });
  }
  onModuleDestroy(): void {
    this.untap?.();
  }

  /** Push the user's freshest notification (the one the event announced). */
  private async pushLatestNotification(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const row = await this.db.withWorkspaceSystem(workspaceId, async (client) => {
      const res = await client.query(
        `SELECT n.kind, n.message, n.task_id, t.name AS task_name
         FROM notifications n
         LEFT JOIN tasks t ON t.id = n.task_id
         WHERE n.user_id = $1
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT 1`,
        [userId],
      );
      return res.rows[0] as
        | { kind: string; message: string; task_id: string | null; task_name: string | null }
        | undefined;
    });
    if (!row) return;
    const titles: Record<string, string> = {
      mention: "New mention",
      assigned: "New assignment",
      comment: "New comment",
      status: "Status update",
      reminder: "Reminder",
      timesheet: "Timesheet update",
      chat: "New chat message",
    };
    const body =
      row.message || (row.task_name ? `On “${row.task_name}”` : "Open your inbox");
    await this.push.notifyUser(userId, {
      title: titles[row.kind] ?? "New notification",
      body,
      path: row.task_id ? `/list?task=${row.task_id}` : "/inbox",
    });
  }

  // --- Notifications --------------------------------------------------------

  /** Ripe reminders (remind_at <= now, not done, not yet surfaced) become
   *  notifications exactly once. */
  private async surfaceDueReminders(
    client: PoolClient,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const due = await client.query(
      `SELECT id, note, task_id FROM reminders
       WHERE user_id = $1 AND remind_at <= now()
         AND done_at IS NULL AND notified_at IS NULL
       ORDER BY remind_at`,
      [userId],
    );
    for (const r of due.rows) {
      await insertNotification(client, {
        workspaceId,
        userId,
        kind: "reminder",
        taskId: (r.task_id as string | null) ?? null,
        message: r.note as string,
      });
      await client.query(
        `UPDATE reminders SET notified_at = now() WHERE id = $1`,
        [r.id as string],
      );
    }
  }

  async listNotifications(
    workspaceId: string,
    userId: string,
    unreadOnly: boolean,
  ): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.surfaceDueReminders(client, workspaceId, userId);
      const res = await client.query(
        `SELECT n.id, n.kind, n.message, n.task_id, n.comment_id,
                n.read_at, n.created_at,
                t.name AS task_name,
                u.id AS u_id, u.full_name AS u_full_name, u.avatar_url AS u_avatar_url
         FROM notifications n
         LEFT JOIN tasks t ON t.id = n.task_id
         LEFT JOIN users u ON u.id = n.actor_user_id
         WHERE n.user_id = $1 ${unreadOnly ? "AND n.read_at IS NULL" : ""}
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT 100`,
        [userId],
      );
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS n FROM notifications
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return {
        notifications: res.rows.map((r) => ({
          id: r.id as string,
          kind: r.kind as string,
          message: r.message as string,
          taskId: (r.task_id as string | null) ?? null,
          taskName: (r.task_name as string | null) ?? null,
          commentId: (r.comment_id as string | null) ?? null,
          actor: r.u_id
            ? {
                id: r.u_id as string,
                fullName: r.u_full_name as string,
                avatarUrl: (r.u_avatar_url as string | null) ?? null,
              }
            : null,
          readAt: iso(r.read_at),
          createdAt: iso(r.created_at)!,
        })),
        unreadCount: countRes.rows[0].n as number,
      };
    });
  }

  async markRead(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, now())
         WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
      );
      if (!res.rows[0]) throw new NotFoundException("Notification not found");
    });
  }

  async markAllRead(workspaceId: string, userId: string): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await client.query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
    });
  }

  // --- Reminders ------------------------------------------------------------

  private async reminderOut(
    client: PoolClient,
    id: string,
    userId: string,
  ): Promise<ReminderItem> {
    const res = await client.query(
      `SELECT r.id, r.note, r.remind_at, r.task_id, r.done_at, r.created_at,
              t.name AS task_name
       FROM reminders r LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.id = $1 AND r.user_id = $2`,
      [id, userId],
    );
    const r = res.rows[0];
    if (!r) throw new NotFoundException("Reminder not found");
    return {
      id: r.id as string,
      note: r.note as string,
      remindAt: iso(r.remind_at)!,
      taskId: (r.task_id as string | null) ?? null,
      taskName: (r.task_name as string | null) ?? null,
      doneAt: iso(r.done_at),
      createdAt: iso(r.created_at)!,
    };
  }

  async listReminders(
    workspaceId: string,
    userId: string,
  ): Promise<ReminderItem[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT r.id FROM reminders r
         WHERE r.user_id = $1
         ORDER BY r.done_at IS NOT NULL, r.remind_at, r.created_at`,
        [userId],
      );
      const out: ReminderItem[] = [];
      for (const row of res.rows) {
        out.push(await this.reminderOut(client, row.id as string, userId));
      }
      return out;
    });
  }

  async createReminder(
    workspaceId: string,
    userId: string,
    body: { note?: string; remindAt?: string; taskId?: string | null },
  ): Promise<ReminderItem> {
    const note = requireName(body?.note, "note");
    const remindAt = parseDate(body?.remindAt, "remindAt");
    if (!remindAt) throw new BadRequestException("remindAt is required");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      let taskId: string | null = null;
      if (body?.taskId) {
        const t = await client.query(`SELECT id FROM tasks WHERE id = $1`, [
          body.taskId,
        ]);
        if (!t.rows[0]) {
          throw new BadRequestException("taskId must reference a task");
        }
        taskId = body.taskId;
      }
      const ins = await client.query(
        `INSERT INTO reminders (workspace_id, user_id, task_id, note, remind_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [workspaceId, userId, taskId, note, remindAt],
      );
      return this.reminderOut(client, ins.rows[0].id as string, userId);
    });
  }

  async updateReminder(
    workspaceId: string,
    userId: string,
    id: string,
    body: { note?: string; remindAt?: string; done?: boolean },
  ): Promise<ReminderItem> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await client.query(
        `SELECT id FROM reminders WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (!existing.rows[0]) throw new NotFoundException("Reminder not found");

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (body?.note !== undefined) {
        sets.push(`note = $${i++}`);
        params.push(requireName(body.note, "note"));
      }
      if (body?.remindAt !== undefined) {
        const remindAt = parseDate(body.remindAt, "remindAt");
        if (!remindAt) throw new BadRequestException("remindAt is required");
        // Re-arming a reminder lets it fire (and notify) again.
        sets.push(`remind_at = $${i++}`, `notified_at = NULL`);
        params.push(remindAt);
      }
      if (body?.done !== undefined) {
        if (typeof body.done !== "boolean") {
          throw new BadRequestException("done must be a boolean");
        }
        sets.push(`done_at = ${body.done ? "now()" : "NULL"}`);
      }
      if (sets.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE reminders SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      return this.reminderOut(client, id, userId);
    });
  }

  async deleteReminder(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
      );
      if (!res.rows[0]) throw new NotFoundException("Reminder not found");
    });
  }
}
