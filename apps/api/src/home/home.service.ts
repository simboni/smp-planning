import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { DbService } from "../db/db.service";
import {
  TASK_COLS,
  TASK_FROM,
  TaskCard,
  TasksService,
} from "../tasks/tasks.service";

export interface HomeReminder {
  id: string;
  note: string;
  remindAt: string;
  taskId: string | null;
  taskName: string | null;
}

export interface HomeRecent {
  taskId: string;
  taskName: string;
  listId: string;
  kind: string;
  createdAt: string;
}

export interface HomeSummary {
  assignedOpen: number;
  overdue: TaskCard[];
  dueToday: TaskCard[];
  upcoming: TaskCard[];
  unscheduled: TaskCard[];
  reminders: HomeReminder[];
  recent: HomeRecent[];
}

/** At-a-glance counts for the Home stat tiles, scoped to what the caller sees. */
export interface HomeOverview {
  spaces: number;
  tasks: number;
  docs: number;
  goals: number;
  dashboards: number;
  members: number;
}

/** Per-bucket cap so a busy user's Home stays a fixed-size payload. */
const BUCKET_CAP = 25;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Module 14: Home / My Work.
 *
 * A personal dashboard for the caller (token sub), computed across the spaces
 * they can see. "Open" = assigned to the caller, not archived, and not in a
 * done-type status. Those open tasks are bucketed by due date relative to the
 * current UTC day: overdue (< today), dueToday (today), upcoming (the next 7
 * days) and unscheduled (no due date). Cards use the exact TaskCard shape from
 * TasksService (assembled once, no N+1). Also returns the caller's open
 * reminders and their most recent task activity.
 *
 * Members-only: guests are refused (403), like universal search.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly tasks: TasksService,
  ) {}

  async home(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<HomeSummary> {
    if (role === "guest") {
      throw new ForbiddenException("Home is available to members only");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = [
        ...(await this.access.visibleSpaceIds(client, userId, role)),
      ];

      // All open tasks assigned to the caller in a visible space. One query,
      // then TasksService assembles the cards (batched enrichment).
      const rowsRes = await client.query(
        `SELECT ${TASK_COLS} ${TASK_FROM}
          WHERE t.archived = false
            AND t.space_id = ANY($1::uuid[])
            AND (s.type IS DISTINCT FROM 'done')
            AND EXISTS (
              SELECT 1 FROM task_assignees ta
               WHERE ta.task_id = t.id AND ta.user_id = $2)
          ORDER BY t.due_date NULLS LAST, t.created_at
          LIMIT 500`,
        [visible, userId],
      );
      const cards = await this.tasks.assembleCards(client, rowsRes.rows);

      // Day boundaries in UTC.
      const now = new Date();
      const todayStart = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      );
      const tomorrowStart = todayStart + 86_400_000;
      const in7 = todayStart + 7 * 86_400_000;

      const overdue: TaskCard[] = [];
      const dueToday: TaskCard[] = [];
      const upcoming: TaskCard[] = [];
      const unscheduled: TaskCard[] = [];
      for (const card of cards) {
        if (card.dueDate === null) {
          if (unscheduled.length < BUCKET_CAP) unscheduled.push(card);
          continue;
        }
        const due = Date.parse(card.dueDate);
        if (due < todayStart) {
          if (overdue.length < BUCKET_CAP) overdue.push(card);
        } else if (due < tomorrowStart) {
          if (dueToday.length < BUCKET_CAP) dueToday.push(card);
        } else if (due <= in7) {
          if (upcoming.length < BUCKET_CAP) upcoming.push(card);
        }
      }

      const remRes = await client.query(
        `SELECT r.id, r.note, r.remind_at, r.task_id, t.name AS task_name
           FROM reminders r LEFT JOIN tasks t ON t.id = r.task_id
          WHERE r.user_id = $1 AND r.done_at IS NULL
          ORDER BY r.remind_at, r.created_at
          LIMIT 50`,
        [userId],
      );
      const reminders: HomeReminder[] = remRes.rows.map((r) => ({
        id: r.id as string,
        note: r.note as string,
        remindAt: iso(r.remind_at)!,
        taskId: (r.task_id as string | null) ?? null,
        taskName: (r.task_name as string | null) ?? null,
      }));

      const recRes = await client.query(
        `SELECT a.task_id, t.name AS task_name, t.list_id, a.kind, a.created_at
           FROM task_activity a JOIN tasks t ON t.id = a.task_id
          WHERE a.actor_user_id = $1 AND t.space_id = ANY($2::uuid[])
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 8`,
        [userId, visible],
      );
      const recent: HomeRecent[] = recRes.rows.map((r) => ({
        taskId: r.task_id as string,
        taskName: r.task_name as string,
        listId: r.list_id as string,
        kind: r.kind as string,
        createdAt: iso(r.created_at)!,
      }));

      return {
        assignedOpen: cards.length,
        overdue,
        dueToday,
        upcoming,
        unscheduled,
        reminders,
        recent,
      };
    });
  }

  /**
   * Counts for the Home stat tiles. Everything is scoped to what the caller
   * can actually see: tasks and docs are limited to their visible spaces (so a
   * private space they aren't in doesn't inflate the numbers); goals,
   * dashboards and members are workspace-level. Members-only, like home().
   */
  async overview(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<HomeOverview> {
    if (role === "guest") {
      throw new ForbiddenException("Home is available to members only");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = [
        ...(await this.access.visibleSpaceIds(client, userId, role)),
      ];
      const res = await client.query(
        `SELECT
           (SELECT count(*) FROM tasks
              WHERE archived = false AND space_id = ANY($1::uuid[]))::int AS tasks,
           (SELECT count(*) FROM docs
              WHERE space_id = ANY($1::uuid[])
                 OR (space_id IS NULL AND created_by = $2))::int AS docs,
           (SELECT count(*) FROM goals WHERE archived = false)::int AS goals,
           (SELECT count(*) FROM dashboards)::int AS dashboards,
           (SELECT count(*) FROM memberships)::int AS members`,
        [visible, userId],
      );
      const row = res.rows[0];
      return {
        spaces: visible.length,
        tasks: row.tasks as number,
        docs: row.docs as number,
        goals: row.goals as number,
        dashboards: row.dashboards as number,
        members: row.members as number,
      };
    });
  }
}
