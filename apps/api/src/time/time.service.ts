import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { EventsService } from "../events/events.service";
import { insertNotification } from "../inbox/inbox.support";
import type { UserRef } from "../tasks/tasks.service";
import {
  parseDate,
  requireSpaceEdit,
  requireSpaceVisible,
} from "../tasks/tasks.support";
import {
  MAX_ENTRY_SECONDS,
  WEEK_CAPACITY_SECONDS,
  requireMonday,
  validBillable,
  validNote,
  weekDays,
} from "./time.support";

/** One tracked interval; endedAt/durationSeconds are null while running. */
export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  billable: boolean;
  note: string;
  createdAt: string;
}

/** A task's entry as listed on GET /tasks/:id/time-entries (user joined). */
export interface TaskTimeEntry {
  id: string;
  user: UserRef;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  billable: boolean;
  note: string;
}

/** A user's entry as listed on the timesheet (task joined). */
export interface TimesheetEntry {
  id: string;
  taskId: string;
  taskName: string;
  listId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  billable: boolean;
  note: string;
}

export interface Submission {
  id: string;
  userId: string;
  weekStart: string;
  status: "submitted" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
}

const ENTRY_COLS = `id, task_id, user_id, started_at, ended_at,
  duration_seconds, billable, note, created_at`;

const SUBMISSION_COLS = `id, user_id, week_start::text AS week_start, status,
  decided_by, decided_at`;

/** Finalize a running entry: duration = whole seconds since it started. */
const STOP_SQL = `UPDATE time_entries
  SET ended_at = now(),
      duration_seconds =
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - started_at))))::int
  WHERE user_id = $1 AND ended_at IS NULL`;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function userRef(r: Record<string, unknown>): UserRef {
  return {
    id: r.u_id as string,
    fullName: r.u_full_name as string,
    avatarUrl: (r.u_avatar_url as string | null) ?? null,
  };
}

/**
 * Module 8: Time tracking (timer + manual entries), timesheets and workload.
 *
 * Rules:
 *  - Tracking on a task requires the task's space visible AND permission >=
 *    edit (trackers are doers); reading a task's entries needs visibility.
 *  - Entries belong to their user: only the owner may edit an entry; the
 *    owner OR a workspace admin/owner may delete one.
 *  - At most ONE running timer per user — starting a new one first stops the
 *    old (finalizing its duration up to now).
 *  - Timesheet weeks are Monday-start UTC dates; submissions are decided
 *    (approved/rejected) by admin/owner, notifying the user.
 */
@Injectable()
export class TimeService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  // --- helpers --------------------------------------------------------------

  private toEntry(r: Record<string, unknown>): TimeEntry {
    return {
      id: r.id as string,
      taskId: r.task_id as string,
      userId: r.user_id as string,
      startedAt: iso(r.started_at)!,
      endedAt: iso(r.ended_at),
      durationSeconds: (r.duration_seconds as number | null) ?? null,
      billable: r.billable as boolean,
      note: r.note as string,
      createdAt: iso(r.created_at)!,
    };
  }

  private toSubmission(r: Record<string, unknown>): Submission {
    return {
      id: r.id as string,
      userId: r.user_id as string,
      weekStart: r.week_start as string,
      status: r.status as Submission["status"],
      decidedBy: (r.decided_by as string | null) ?? null,
      decidedAt: iso(r.decided_at),
    };
  }

  /** Load a task's space/list (404 when missing) for permission checks. */
  private async taskCtx(
    client: PoolClient,
    taskId: string,
  ): Promise<{ spaceId: string; listId: string }> {
    const res = await client.query(
      `SELECT space_id, list_id FROM tasks WHERE id = $1`,
      [taskId],
    );
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    return {
      spaceId: res.rows[0].space_id as string,
      listId: res.rows[0].list_id as string,
    };
  }

  /** Realtime hint that a task's tracked time changed. */
  private publishTimeChanged(workspaceId: string, taskId: string): void {
    this.events.publish(workspaceId, {
      type: "time.changed",
      payload: { taskId },
    });
  }

  /** Required ISO timestamp for manual entries; 400 when missing/invalid. */
  private requireIso(v: unknown, field: string): string {
    const parsed = parseDate(v, field);
    if (parsed === null) throw new BadRequestException(`${field} is required`);
    return parsed;
  }

  /** Validate a finished interval: end after start, at most 24h. Returns seconds. */
  private intervalSeconds(startedAt: string, endedAt: string): number {
    const start = Date.parse(startedAt);
    const end = Date.parse(endedAt);
    if (end <= start) {
      throw new BadRequestException("endedAt must be after startedAt");
    }
    const seconds = Math.floor((end - start) / 1000);
    if (seconds > MAX_ENTRY_SECONDS) {
      throw new BadRequestException("a time entry cannot exceed 24 hours");
    }
    return seconds;
  }

  // --- Timer ----------------------------------------------------------------

  /** Start a timer on a task, auto-stopping any running entry first. */
  async startTimer(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    body: { note?: string; billable?: boolean },
  ): Promise<TimeEntry> {
    const note = validNote(body?.note);
    const billable = validBillable(body?.billable);
    const { entry, stoppedTaskId } = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const { spaceId } = await this.taskCtx(client, taskId);
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
        // One running timer per user: finalize the old one (if any) first.
        const stopped = await client.query(`${STOP_SQL} RETURNING task_id`, [
          userId,
        ]);
        const ins = await client.query(
          `INSERT INTO time_entries
             (workspace_id, task_id, user_id, started_at, billable, note)
           VALUES ($1, $2, $3, now(), $4, $5)
           RETURNING ${ENTRY_COLS}`,
          [workspaceId, taskId, userId, billable, note],
        );
        return {
          entry: this.toEntry(ins.rows[0]),
          stoppedTaskId: (stopped.rows[0]?.task_id as string | undefined) ?? null,
        };
      },
    );
    this.publishTimeChanged(workspaceId, taskId);
    if (stoppedTaskId && stoppedTaskId !== taskId) {
      this.publishTimeChanged(workspaceId, stoppedTaskId);
    }
    return entry;
  }

  /** Stop the caller's running entry (404 when none is running). */
  async stopTimer(workspaceId: string, userId: string): Promise<TimeEntry> {
    const entry = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const res = await client.query(`${STOP_SQL} RETURNING ${ENTRY_COLS}`, [
          userId,
        ]);
        if (!res.rows[0]) throw new NotFoundException("No running timer");
        return this.toEntry(res.rows[0]);
      },
    );
    this.publishTimeChanged(workspaceId, entry.taskId);
    return entry;
  }

  /** The caller's running timer (elapsed seconds included), or null. */
  async getRunning(
    workspaceId: string,
    userId: string,
  ): Promise<{
    entry: TimeEntry;
    task: { id: string; name: string; listId: string };
  } | null> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT e.id, e.task_id, e.user_id, e.started_at, e.ended_at,
                e.duration_seconds, e.billable, e.note, e.created_at,
                t.name AS task_name, t.list_id,
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - e.started_at))))::int
                  AS elapsed
         FROM time_entries e JOIN tasks t ON t.id = e.task_id
         WHERE e.user_id = $1 AND e.ended_at IS NULL`,
        [userId],
      );
      const r = res.rows[0];
      if (!r) return null;
      return {
        // Surface the live elapsed time on the (still running) entry.
        entry: { ...this.toEntry(r), durationSeconds: r.elapsed as number },
        task: {
          id: r.task_id as string,
          name: r.task_name as string,
          listId: r.list_id as string,
        },
      };
    });
  }

  // --- Manual entries -------------------------------------------------------

  async createEntry(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    body: { startedAt?: string; endedAt?: string; billable?: boolean; note?: string },
  ): Promise<TimeEntry> {
    const startedAt = this.requireIso(body?.startedAt, "startedAt");
    const endedAt = this.requireIso(body?.endedAt, "endedAt");
    const duration = this.intervalSeconds(startedAt, endedAt);
    const note = validNote(body?.note);
    const billable = validBillable(body?.billable);

    const entry = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const { spaceId } = await this.taskCtx(client, taskId);
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
        const ins = await client.query(
          `INSERT INTO time_entries
             (workspace_id, task_id, user_id, started_at, ended_at,
              duration_seconds, billable, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${ENTRY_COLS}`,
          [workspaceId, taskId, userId, startedAt, endedAt, duration, billable, note],
        );
        return this.toEntry(ins.rows[0]);
      },
    );
    this.publishTimeChanged(workspaceId, taskId);
    return entry;
  }

  /** Edit an entry — strictly the owner's own; bounds keep full validation. */
  async updateEntry(
    workspaceId: string,
    userId: string,
    entryId: string,
    body: { startedAt?: string; endedAt?: string; billable?: boolean; note?: string },
  ): Promise<TimeEntry> {
    const entry = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const res = await client.query(
          `SELECT ${ENTRY_COLS} FROM time_entries WHERE id = $1`,
          [entryId],
        );
        if (!res.rows[0]) throw new NotFoundException("Time entry not found");
        const existing = this.toEntry(res.rows[0]);
        if (existing.userId !== userId) {
          throw new ForbiddenException("You can only edit your own time entries");
        }

        const startedAt =
          body?.startedAt !== undefined
            ? this.requireIso(body.startedAt, "startedAt")
            : existing.startedAt;
        const endedAt =
          body?.endedAt !== undefined
            ? this.requireIso(body.endedAt, "endedAt")
            : existing.endedAt;
        // A still-running entry keeps duration NULL; setting endedAt (or
        // moving the bounds of a finished one) re-validates and recomputes.
        const duration =
          endedAt === null ? null : this.intervalSeconds(startedAt, endedAt);

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (body?.startedAt !== undefined || body?.endedAt !== undefined) {
          sets.push(
            `started_at = $${i++}`,
            `ended_at = $${i++}`,
            `duration_seconds = $${i++}`,
          );
          params.push(startedAt, endedAt, duration);
        }
        if (body?.note !== undefined) {
          sets.push(`note = $${i++}`);
          params.push(validNote(body.note));
        }
        if (body?.billable !== undefined) {
          sets.push(`billable = $${i++}`);
          params.push(validBillable(body.billable));
        }
        if (sets.length === 0) return existing;
        params.push(entryId);
        const upd = await client.query(
          `UPDATE time_entries SET ${sets.join(", ")}
           WHERE id = $${i} RETURNING ${ENTRY_COLS}`,
          params,
        );
        return this.toEntry(upd.rows[0]);
      },
    );
    this.publishTimeChanged(workspaceId, entry.taskId);
    return entry;
  }

  /** Delete an entry: its owner, or a workspace admin/owner (any entry). */
  async deleteEntry(
    workspaceId: string,
    userId: string,
    role: Role,
    entryId: string,
  ): Promise<void> {
    const taskId = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const res = await client.query(
          `SELECT task_id, user_id FROM time_entries WHERE id = $1`,
          [entryId],
        );
        if (!res.rows[0]) throw new NotFoundException("Time entry not found");
        const isAdmin = role === "owner" || role === "admin";
        if ((res.rows[0].user_id as string) !== userId && !isAdmin) {
          throw new ForbiddenException(
            "You can only delete your own time entries",
          );
        }
        await client.query(`DELETE FROM time_entries WHERE id = $1`, [entryId]);
        return res.rows[0].task_id as string;
      },
    );
    this.publishTimeChanged(workspaceId, taskId);
  }

  /** A task's entries (newest first) + finished/billable totals. */
  async listTaskEntries(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
  ): Promise<{
    entries: TaskTimeEntry[];
    totalSeconds: number;
    billableSeconds: number;
  }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { spaceId } = await this.taskCtx(client, taskId);
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT e.id, e.started_at, e.ended_at, e.duration_seconds,
                e.billable, e.note,
                u.id AS u_id, u.full_name AS u_full_name,
                u.avatar_url AS u_avatar_url
         FROM time_entries e JOIN users u ON u.id = e.user_id
         WHERE e.task_id = $1
         ORDER BY e.started_at DESC, e.created_at DESC`,
        [taskId],
      );
      let totalSeconds = 0;
      let billableSeconds = 0;
      const entries = res.rows.map((r) => {
        const seconds = (r.duration_seconds as number | null) ?? null;
        if (seconds !== null) {
          totalSeconds += seconds;
          if (r.billable as boolean) billableSeconds += seconds;
        }
        return {
          id: r.id as string,
          user: userRef(r),
          startedAt: iso(r.started_at)!,
          endedAt: iso(r.ended_at),
          durationSeconds: seconds,
          billable: r.billable as boolean,
          note: r.note as string,
        };
      });
      return { entries, totalSeconds, billableSeconds };
    });
  }

  // --- Timesheets -----------------------------------------------------------

  /** The caller's own week: 7 day buckets + totals + submission state. */
  async myTimesheet(
    workspaceId: string,
    userId: string,
    weekStartRaw: unknown,
  ): Promise<{
    weekStart: string;
    days: {
      date: string;
      totalSeconds: number;
      billableSeconds: number;
      entries: TimesheetEntry[];
    }[];
    totalSeconds: number;
    submission: Submission | null;
  }> {
    const weekStart = requireMonday(weekStartRaw);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT e.id, e.task_id, e.started_at, e.ended_at, e.duration_seconds,
                e.billable, e.note,
                t.name AS task_name, t.list_id,
                (e.started_at AT TIME ZONE 'UTC')::date::text AS day
         FROM time_entries e JOIN tasks t ON t.id = e.task_id
         WHERE e.user_id = $1 AND e.ended_at IS NOT NULL
           AND (e.started_at AT TIME ZONE 'UTC')::date >= $2::date
           AND (e.started_at AT TIME ZONE 'UTC')::date < $2::date + 7
         ORDER BY e.started_at DESC, e.created_at DESC`,
        [userId, weekStart],
      );
      const days = weekDays(weekStart).map((date) => ({
        date,
        totalSeconds: 0,
        billableSeconds: 0,
        entries: [] as TimesheetEntry[],
      }));
      const byDate = new Map(days.map((d) => [d.date, d]));
      let totalSeconds = 0;
      for (const r of res.rows) {
        const day = byDate.get(r.day as string);
        if (!day) continue;
        const seconds = (r.duration_seconds as number | null) ?? 0;
        day.totalSeconds += seconds;
        if (r.billable as boolean) day.billableSeconds += seconds;
        totalSeconds += seconds;
        day.entries.push({
          id: r.id as string,
          taskId: r.task_id as string,
          taskName: r.task_name as string,
          listId: r.list_id as string,
          startedAt: iso(r.started_at)!,
          endedAt: iso(r.ended_at),
          durationSeconds: seconds,
          billable: r.billable as boolean,
          note: r.note as string,
        });
      }
      const sub = await client.query(
        `SELECT ${SUBMISSION_COLS} FROM timesheet_submissions
         WHERE user_id = $1 AND week_start = $2`,
        [userId, weekStart],
      );
      return {
        weekStart,
        days,
        totalSeconds,
        submission: sub.rows[0] ? this.toSubmission(sub.rows[0]) : null,
      };
    });
  }

  /** Submit (or re-submit) the caller's week; resets any prior decision. */
  async submitTimesheet(
    workspaceId: string,
    userId: string,
    weekStartRaw: unknown,
  ): Promise<Submission> {
    const weekStart = requireMonday(weekStartRaw);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `INSERT INTO timesheet_submissions (workspace_id, user_id, week_start)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id, week_start)
         DO UPDATE SET status = 'submitted', decided_by = NULL, decided_at = NULL
         RETURNING ${SUBMISSION_COLS}`,
        [workspaceId, userId, weekStart],
      );
      const submission = this.toSubmission(res.rows[0]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "timesheet.submitted",
        entity: "timesheet",
        entityId: submission.id,
        data: { weekStart },
      });
      return submission;
    });
  }

  /** Admin view: every member with tracked time OR a submission that week. */
  async listTimesheets(
    workspaceId: string,
    userId: string,
    weekStartRaw: unknown,
  ): Promise<{
    weekStart: string;
    rows: {
      user: UserRef;
      totalSeconds: number;
      billableSeconds: number;
      submission: Submission | null;
    }[];
  }> {
    const weekStart = requireMonday(weekStartRaw);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const totals = await client.query(
        `SELECT e.user_id,
                COALESCE(SUM(e.duration_seconds), 0)::int AS total,
                COALESCE(SUM(e.duration_seconds) FILTER (WHERE e.billable), 0)::int
                  AS billable
         FROM time_entries e
         WHERE e.ended_at IS NOT NULL
           AND (e.started_at AT TIME ZONE 'UTC')::date >= $1::date
           AND (e.started_at AT TIME ZONE 'UTC')::date < $1::date + 7
         GROUP BY e.user_id`,
        [weekStart],
      );
      const subs = await client.query(
        `SELECT ${SUBMISSION_COLS} FROM timesheet_submissions
         WHERE week_start = $1`,
        [weekStart],
      );
      const totalByUser = new Map(
        totals.rows.map((r) => [
          r.user_id as string,
          { total: r.total as number, billable: r.billable as number },
        ]),
      );
      const subByUser = new Map(
        subs.rows.map((r) => [r.user_id as string, this.toSubmission(r)]),
      );
      const userIds = [
        ...new Set([...totalByUser.keys(), ...subByUser.keys()]),
      ];
      if (userIds.length === 0) return { weekStart, rows: [] };
      const users = await client.query(
        `SELECT id, full_name, avatar_url FROM users
         WHERE id = ANY($1) ORDER BY full_name, id`,
        [userIds],
      );
      return {
        weekStart,
        rows: users.rows.map((u) => {
          const uid = u.id as string;
          const t = totalByUser.get(uid);
          return {
            user: {
              id: uid,
              fullName: u.full_name as string,
              avatarUrl: (u.avatar_url as string | null) ?? null,
            },
            totalSeconds: t?.total ?? 0,
            billableSeconds: t?.billable ?? 0,
            submission: subByUser.get(uid) ?? null,
          };
        }),
      };
    });
  }

  /** Approve/reject a member's submitted week; notifies the member. */
  async decideTimesheet(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    body: { weekStart?: string; decision?: string },
  ): Promise<Submission> {
    const weekStart = requireMonday(body?.weekStart);
    const decision = body?.decision;
    if (decision !== "approved" && decision !== "rejected") {
      throw new BadRequestException(
        "decision must be 'approved' or 'rejected'",
      );
    }
    const submission = await this.db.withWorkspace(
      workspaceId,
      actorUserId,
      async (client) => {
        const res = await client.query(
          `UPDATE timesheet_submissions
           SET status = $1, decided_by = $2, decided_at = now()
           WHERE user_id = $3 AND week_start = $4
           RETURNING ${SUBMISSION_COLS}`,
          [decision, actorUserId, targetUserId, weekStart],
        );
        if (!res.rows[0]) {
          throw new NotFoundException("No submission for this user and week");
        }
        // Tell the member their week was decided (self-decide stays silent).
        if (targetUserId !== actorUserId) {
          await insertNotification(client, {
            workspaceId,
            userId: targetUserId,
            kind: "timesheet",
            actorUserId,
            message: `${decision} your timesheet for the week of ${weekStart}`,
          });
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId,
          action: "timesheet.decided",
          entity: "timesheet",
          entityId: res.rows[0].id as string,
          data: { userId: targetUserId, weekStart, decision },
        });
        return this.toSubmission(res.rows[0]);
      },
    );
    if (targetUserId !== actorUserId) {
      this.events.publish(workspaceId, {
        type: "notification.new",
        payload: { userId: targetUserId },
      });
    }
    return submission;
  }

  // --- Workload -------------------------------------------------------------

  /**
   * Per-member week view: fixed capacity, estimate-based assigned load
   * (estimates split evenly across a task's assignees) and tracked time.
   * Only tasks/time in spaces VISIBLE TO THE CALLER are counted, so private
   * -space work never leaks through the aggregate.
   */
  async workload(
    workspaceId: string,
    userId: string,
    role: Role,
    weekStartRaw: unknown,
  ): Promise<{
    weekStart: string;
    days: string[];
    members: {
      user: UserRef;
      capacitySeconds: number;
      assignedSeconds: number;
      trackedSeconds: number;
      tasks: {
        id: string;
        name: string;
        listId: string;
        dueDate: string;
        estimateSeconds: number;
      }[];
    }[];
  }> {
    const weekStart = requireMonday(weekStartRaw);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = await this.access.visibleSpaceIds(client, userId, role);
      const spaceIds = [...visible];

      const membersRes = await client.query(
        `SELECT u.id, u.full_name, u.avatar_url
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.status = 'active'
         ORDER BY u.full_name, u.id`,
      );
      const members = membersRes.rows.map((u) => ({
        user: {
          id: u.id as string,
          fullName: u.full_name as string,
          avatarUrl: (u.avatar_url as string | null) ?? null,
        },
        capacitySeconds: WEEK_CAPACITY_SECONDS,
        assignedSeconds: 0,
        trackedSeconds: 0,
        tasks: [] as {
          id: string;
          name: string;
          listId: string;
          dueDate: string;
          estimateSeconds: number;
        }[],
      }));
      const byUser = new Map(members.map((m) => [m.user.id, m]));

      // Assigned, non-archived tasks due inside the week, in visible spaces.
      // The window count over the assignee join gives each task's assignee
      // total so estimates can be split evenly — still one batched query.
      const tasksRes = await client.query(
        `SELECT ta.user_id, t.id, t.name, t.list_id, t.due_date,
                t.time_estimate_minutes,
                COUNT(*) OVER (PARTITION BY t.id)::int AS assignee_count
         FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id
         WHERE t.archived = false
           AND t.due_date IS NOT NULL
           AND (t.due_date AT TIME ZONE 'UTC')::date >= $1::date
           AND (t.due_date AT TIME ZONE 'UTC')::date < $1::date + 7
           AND t.space_id = ANY($2::uuid[])
         ORDER BY t.due_date, t.created_at`,
        [weekStart, spaceIds],
      );
      for (const r of tasksRes.rows) {
        const m = byUser.get(r.user_id as string);
        if (!m) continue;
        const estimateMinutes = (r.time_estimate_minutes as number | null) ?? 0;
        const share = Math.floor(
          (estimateMinutes * 60) / (r.assignee_count as number),
        );
        m.assignedSeconds += share;
        m.tasks.push({
          id: r.id as string,
          name: r.name as string,
          listId: r.list_id as string,
          dueDate: iso(r.due_date)!,
          estimateSeconds: share,
        });
      }

      // Finished time tracked inside the week, visible spaces only.
      const trackedRes = await client.query(
        `SELECT e.user_id, COALESCE(SUM(e.duration_seconds), 0)::int AS n
         FROM time_entries e JOIN tasks t ON t.id = e.task_id
         WHERE e.ended_at IS NOT NULL
           AND (e.started_at AT TIME ZONE 'UTC')::date >= $1::date
           AND (e.started_at AT TIME ZONE 'UTC')::date < $1::date + 7
           AND t.space_id = ANY($2::uuid[])
         GROUP BY e.user_id`,
        [weekStart, spaceIds],
      );
      for (const r of trackedRes.rows) {
        const m = byUser.get(r.user_id as string);
        if (m) m.trackedSeconds = r.n as number;
      }

      return { weekStart, days: weekDays(weekStart), members };
    });
  }
}
