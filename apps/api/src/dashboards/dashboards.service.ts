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
import { GoalsService } from "../goals/goals.service";
import {
  completedPointsByDay,
  computeBurndown,
  sprintPointsForLists,
  utcToday,
} from "../sprints/sprints.support";
import type { UserRef } from "../tasks/tasks.service";
import { optionalName, requireName, requireUuid } from "../tasks/tasks.support";

// --- Shapes -----------------------------------------------------------------

export const CARD_KINDS = [
  "statusBreakdown",
  "assigneeLoad",
  "priorityBreakdown",
  "timeTracked",
  "goalProgress",
  "sprintBurndown",
  "recentActivity",
  "text",
  // M21 — advanced analytics cards.
  "completionTrend",
  "overdueByAssignee",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export interface DashboardSummary {
  id: string;
  name: string;
  cardCount: number;
  updatedAt: string;
}

export interface Dashboard {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardCard {
  id: string;
  dashboardId: string;
  kind: CardKind;
  title: string;
  config: Record<string, unknown>;
  position: number;
  width: "half" | "full";
}

/** Fixed slice colors for the priorityBreakdown card. */
const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#EF4444",
  high: "#F59E0B",
  normal: "#3B82F6",
  low: "#9CA3AF",
  none: "#D1D5DB",
};

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toDashboard(r: Record<string, unknown>): Dashboard {
  return {
    id: r.id as string,
    name: r.name as string,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toCard(r: Record<string, unknown>): DashboardCard {
  return {
    id: r.id as string,
    dashboardId: r.dashboard_id as string,
    kind: r.kind as CardKind,
    title: r.title as string,
    config: (r.config as Record<string, unknown>) ?? {},
    position: r.position as number,
    width: r.width as "half" | "full",
  };
}

function validKind(v: unknown): CardKind {
  if (!CARD_KINDS.includes(v as CardKind)) {
    throw new BadRequestException(
      `kind must be one of ${CARD_KINDS.join(", ")}`,
    );
  }
  return v as CardKind;
}

function validWidth(v: unknown): "half" | "full" {
  if (v !== "half" && v !== "full") {
    throw new BadRequestException("width must be 'half' or 'full'");
  }
  return v;
}

function validConfig(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new BadRequestException("config must be an object");
  }
  return v as Record<string, unknown>;
}

/**
 * Module 10: Dashboards & reporting cards. Dashboards are WORKSPACE-WIDE for
 * members (guests 403 at the controller): any member creates; editing or
 * deleting a dashboard (and its cards) is allowed for its creator or a
 * workspace admin/owner. Cards store a kind + jsonb config only — every
 * number is computed AT READ TIME against the CALLER's visible spaces
 * (AccessService.visibleSpaceIds), so a card configured over a private space
 * renders empty for anyone who cannot see that space: private-space counts
 * never leak through shared dashboards.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly goals: GoalsService,
  ) {}

  private publishDashboardChanged(
    workspaceId: string,
    dashboardId: string,
  ): void {
    this.events.publish(workspaceId, {
      type: "dashboard.changed",
      payload: { dashboardId },
    });
  }

  /** Load a dashboard row (404 when missing). */
  private async dashboardRow(
    client: PoolClient,
    dashboardId: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(
      `SELECT id, name, created_by, created_at, updated_at
       FROM dashboards WHERE id = $1`,
      [dashboardId],
    );
    if (!res.rows[0]) throw new NotFoundException("Dashboard not found");
    return res.rows[0];
  }

  /** Light edit rule: the dashboard's creator or a workspace admin/owner. */
  private requireDashboardEdit(
    row: Record<string, unknown>,
    userId: string,
    role: Role,
  ): void {
    const allowed =
      role === "owner" || role === "admin" || row.created_by === userId;
    if (!allowed) {
      throw new ForbiddenException(
        "Only the dashboard's creator or an admin can change it",
      );
    }
  }

  /** Load a card + its dashboard row (404 when missing). */
  private async cardWithDashboard(
    client: PoolClient,
    cardId: string,
  ): Promise<{ card: DashboardCard; dashboard: Record<string, unknown> }> {
    const res = await client.query(
      `SELECT id, dashboard_id, kind, title, config, position, width
       FROM dashboard_cards WHERE id = $1`,
      [cardId],
    );
    if (!res.rows[0]) throw new NotFoundException("Card not found");
    const card = toCard(res.rows[0]);
    return { card, dashboard: await this.dashboardRow(client, card.dashboardId) };
  }

  // --- Dashboards -----------------------------------------------------------

  async listDashboards(
    workspaceId: string,
    userId: string,
  ): Promise<DashboardSummary[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT d.id, d.name, d.updated_at,
                (SELECT COUNT(*)::int FROM dashboard_cards c
                  WHERE c.dashboard_id = d.id) AS card_count
         FROM dashboards d ORDER BY d.created_at, d.id`,
      );
      return res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        cardCount: r.card_count as number,
        updatedAt: iso(r.updated_at),
      }));
    });
  }

  async createDashboard(
    workspaceId: string,
    userId: string,
    body: { name?: string },
  ): Promise<Dashboard> {
    const name = requireName(body?.name);
    const dashboard = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const res = await client.query(
          `INSERT INTO dashboards (workspace_id, name, created_by)
           VALUES ($1, $2, $3)
           RETURNING id, name, created_by, created_at, updated_at`,
          [workspaceId, name, userId],
        );
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "dashboard.created",
          entity: "dashboard",
          entityId: res.rows[0].id as string,
          data: { name },
        });
        return toDashboard(res.rows[0]);
      },
    );
    this.publishDashboardChanged(workspaceId, dashboard.id);
    return dashboard;
  }

  async getDashboard(
    workspaceId: string,
    userId: string,
    dashboardId: string,
  ): Promise<{ dashboard: Dashboard; cards: DashboardCard[] }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.dashboardRow(client, dashboardId);
      const cards = await client.query(
        `SELECT id, dashboard_id, kind, title, config, position, width
         FROM dashboard_cards WHERE dashboard_id = $1
         ORDER BY position, created_at, id`,
        [dashboardId],
      );
      return { dashboard: toDashboard(row), cards: cards.rows.map(toCard) };
    });
  }

  async updateDashboard(
    workspaceId: string,
    userId: string,
    role: Role,
    dashboardId: string,
    body: { name?: string },
  ): Promise<Dashboard> {
    const name = optionalName(body?.name);
    const dashboard = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const row = await this.dashboardRow(client, dashboardId);
        this.requireDashboardEdit(row, userId, role);
        if (name !== undefined) {
          await client.query(
            `UPDATE dashboards SET name = $1, updated_at = now() WHERE id = $2`,
            [name, dashboardId],
          );
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "dashboard.updated",
          entity: "dashboard",
          entityId: dashboardId,
        });
        return toDashboard(await this.dashboardRow(client, dashboardId));
      },
    );
    this.publishDashboardChanged(workspaceId, dashboardId);
    return dashboard;
  }

  async deleteDashboard(
    workspaceId: string,
    userId: string,
    role: Role,
    dashboardId: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.dashboardRow(client, dashboardId);
      this.requireDashboardEdit(row, userId, role);
      await client.query(`DELETE FROM dashboards WHERE id = $1`, [dashboardId]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "dashboard.deleted",
        entity: "dashboard",
        entityId: dashboardId,
      });
    });
    this.publishDashboardChanged(workspaceId, dashboardId);
  }

  // --- Cards ----------------------------------------------------------------

  async createCard(
    workspaceId: string,
    userId: string,
    role: Role,
    dashboardId: string,
    body: {
      kind?: string;
      title?: string;
      config?: Record<string, unknown>;
      width?: string;
    },
  ): Promise<DashboardCard> {
    const kind = validKind(body?.kind);
    const title = body?.title !== undefined ? String(body.title) : "";
    const config = body?.config !== undefined ? validConfig(body.config) : {};
    const width = body?.width !== undefined ? validWidth(body.width) : "half";
    const card = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const row = await this.dashboardRow(client, dashboardId);
        this.requireDashboardEdit(row, userId, role);
        const pos = await client.query(
          `SELECT COALESCE(MAX(position) + 1, 0)::int AS n
           FROM dashboard_cards WHERE dashboard_id = $1`,
          [dashboardId],
        );
        const res = await client.query(
          `INSERT INTO dashboard_cards
             (workspace_id, dashboard_id, kind, title, config, position, width)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, dashboard_id, kind, title, config, position, width`,
          [
            workspaceId,
            dashboardId,
            kind,
            title,
            JSON.stringify(config),
            pos.rows[0].n as number,
            width,
          ],
        );
        await client.query(
          `UPDATE dashboards SET updated_at = now() WHERE id = $1`,
          [dashboardId],
        );
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "dashboard_card.created",
          entity: "dashboard_card",
          entityId: res.rows[0].id as string,
          data: { dashboardId, kind },
        });
        return toCard(res.rows[0]);
      },
    );
    this.publishDashboardChanged(workspaceId, dashboardId);
    return card;
  }

  async updateCard(
    workspaceId: string,
    userId: string,
    role: Role,
    cardId: string,
    body: {
      title?: string;
      config?: Record<string, unknown>;
      width?: string;
      position?: number;
    },
  ): Promise<DashboardCard> {
    const card = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const { card, dashboard } = await this.cardWithDashboard(client, cardId);
        this.requireDashboardEdit(dashboard, userId, role);

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (body?.title !== undefined) {
          sets.push(`title = $${i++}`);
          params.push(String(body.title));
        }
        if (body?.config !== undefined) {
          sets.push(`config = $${i++}`);
          params.push(JSON.stringify(validConfig(body.config)));
        }
        if (body?.width !== undefined) {
          sets.push(`width = $${i++}`);
          params.push(validWidth(body.width));
        }
        if (body?.position !== undefined) {
          if (
            typeof body.position !== "number" ||
            !Number.isInteger(body.position) ||
            body.position < 0
          ) {
            throw new BadRequestException(
              "position must be a non-negative integer",
            );
          }
          sets.push(`position = $${i++}`);
          params.push(body.position);
        }
        if (sets.length > 0) {
          params.push(cardId);
          await client.query(
            `UPDATE dashboard_cards SET ${sets.join(", ")} WHERE id = $${i}`,
            params,
          );
          await client.query(
            `UPDATE dashboards SET updated_at = now() WHERE id = $1`,
            [card.dashboardId],
          );
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "dashboard_card.updated",
          entity: "dashboard_card",
          entityId: cardId,
          data: { dashboardId: card.dashboardId },
        });
        return (await this.cardWithDashboard(client, cardId)).card;
      },
    );
    this.publishDashboardChanged(workspaceId, card.dashboardId);
    return card;
  }

  async deleteCard(
    workspaceId: string,
    userId: string,
    role: Role,
    cardId: string,
  ): Promise<void> {
    const dashboardId = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const { card, dashboard } = await this.cardWithDashboard(client, cardId);
        this.requireDashboardEdit(dashboard, userId, role);
        await client.query(`DELETE FROM dashboard_cards WHERE id = $1`, [
          cardId,
        ]);
        await client.query(
          `UPDATE dashboards SET updated_at = now() WHERE id = $1`,
          [card.dashboardId],
        );
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "dashboard_card.deleted",
          entity: "dashboard_card",
          entityId: cardId,
          data: { dashboardId: card.dashboardId },
        });
        return card.dashboardId;
      },
    );
    this.publishDashboardChanged(workspaceId, dashboardId);
  }

  // --- Card data (computed at read time) ------------------------------------

  /**
   * Resolve a card config's scope into the task filter for THIS caller:
   * config.listId narrows to one list, config.spaceId to one space —
   * intersected with the caller's visible spaces (a scope the caller cannot
   * see yields an empty scope, never a leak). No scope = all visible spaces.
   */
  private async resolveScope(
    client: PoolClient,
    userId: string,
    role: Role,
    config: Record<string, unknown>,
  ): Promise<{ spaceIds: string[]; listId: string | null }> {
    const visible = await this.access.visibleSpaceIds(client, userId, role);
    if (typeof config.listId === "string") {
      const listId = requireUuid(config.listId, "config.listId");
      const res = await client.query(
        `SELECT space_id FROM lists WHERE id = $1`,
        [listId],
      );
      const spaceId = res.rows[0]?.space_id as string | undefined;
      if (!spaceId || !visible.has(spaceId)) return { spaceIds: [], listId: null };
      return { spaceIds: [spaceId], listId };
    }
    if (typeof config.spaceId === "string") {
      const spaceId = requireUuid(config.spaceId, "config.spaceId");
      return {
        spaceIds: visible.has(spaceId) ? [spaceId] : [],
        listId: null,
      };
    }
    return { spaceIds: [...visible], listId: null };
  }

  /** `WHERE` tail (+params) limiting tasks `t` to the resolved scope. */
  private scopeSql(
    scope: { spaceIds: string[]; listId: string | null },
    params: unknown[],
  ): string {
    params.push(scope.spaceIds);
    let sql = `t.space_id = ANY($${params.length}::uuid[])`;
    if (scope.listId) {
      params.push(scope.listId);
      sql += ` AND t.list_id = $${params.length}`;
    }
    return sql;
  }

  async cardData(
    workspaceId: string,
    userId: string,
    role: Role,
    cardId: string,
  ): Promise<Record<string, unknown>> {
    const card = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => (await this.cardWithDashboard(client, cardId)).card,
    );

    if (card.kind === "text") {
      return {
        text: typeof card.config.text === "string" ? card.config.text : "",
      };
    }
    if (card.kind === "goalProgress") {
      // Reuse the goals progress math (mean of target progresses) verbatim.
      if (typeof card.config.goalId === "string") {
        const goalId = requireUuid(card.config.goalId, "config.goalId");
        const goal = await this.goals.getGoal(workspaceId, userId, role, goalId);
        return {
          goals: [{ id: goal.id, name: goal.name, progress: goal.progress }],
        };
      }
      const goals = await this.goals.listGoals(workspaceId, userId, false);
      return {
        goals: goals.map((g) => ({
          id: g.id,
          name: g.name,
          progress: g.progress,
        })),
      };
    }

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const scope = await this.resolveScope(client, userId, role, card.config);
      switch (card.kind) {
        case "statusBreakdown":
          return this.statusBreakdown(client, scope);
        case "priorityBreakdown":
          return this.priorityBreakdown(client, scope);
        case "assigneeLoad":
          return this.assigneeLoad(client, scope);
        case "timeTracked":
          return this.timeTracked(client, scope, card.config);
        case "sprintBurndown":
          return this.sprintBurndown(client, userId, role, card.config);
        case "recentActivity":
          return this.recentActivity(client, scope);
        case "completionTrend":
          return this.completionTrend(client, scope, card.config);
        case "overdueByAssignee":
          return this.overdueByAssignee(client, scope);
        default:
          throw new BadRequestException("Unsupported card kind");
      }
    });
  }

  /** Non-archived tasks by status (statuses merge across spaces by name). */
  private async statusBreakdown(
    client: PoolClient,
    scope: { spaceIds: string[]; listId: string | null },
  ): Promise<Record<string, unknown>> {
    const params: unknown[] = [];
    const where = this.scopeSql(scope, params);
    const res = await client.query(
      `SELECT COALESCE(s.name, 'No status') AS label,
              COALESCE(s.color, '#8A8F98') AS color,
              COUNT(*)::int AS count
       FROM tasks t LEFT JOIN statuses s ON s.id = t.status_id
       WHERE t.archived = false AND ${where}
       GROUP BY 1, 2
       ORDER BY count DESC, label`,
      params,
    );
    return {
      slices: res.rows.map((r) => ({
        label: r.label as string,
        color: r.color as string,
        count: r.count as number,
      })),
    };
  }

  /** Non-archived tasks by priority, all five slices in fixed order. */
  private async priorityBreakdown(
    client: PoolClient,
    scope: { spaceIds: string[]; listId: string | null },
  ): Promise<Record<string, unknown>> {
    const params: unknown[] = [];
    const where = this.scopeSql(scope, params);
    const res = await client.query(
      `SELECT COALESCE(t.priority, 'none') AS label, COUNT(*)::int AS count
       FROM tasks t
       WHERE t.archived = false AND ${where}
       GROUP BY 1`,
      params,
    );
    const counts = new Map<string, number>(
      res.rows.map((r) => [r.label as string, r.count as number]),
    );
    return {
      slices: ["urgent", "high", "normal", "low", "none"].map((label) => ({
        label,
        color: PRIORITY_COLORS[label],
        count: counts.get(label) ?? 0,
      })),
    };
  }

  /** Open/done counts per assignee (open = status type not 'done'). */
  private async assigneeLoad(
    client: PoolClient,
    scope: { spaceIds: string[]; listId: string | null },
  ): Promise<Record<string, unknown>> {
    const params: unknown[] = [];
    const where = this.scopeSql(scope, params);
    const res = await client.query(
      `SELECT u.id, u.full_name, u.avatar_url,
              (COUNT(*) FILTER (WHERE s.type IS DISTINCT FROM 'done'))::int AS open,
              (COUNT(*) FILTER (WHERE s.type = 'done'))::int AS done
       FROM task_assignees ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN users u ON u.id = ta.user_id
       LEFT JOIN statuses s ON s.id = t.status_id
       WHERE t.archived = false AND ${where}
       GROUP BY u.id, u.full_name, u.avatar_url
       ORDER BY open DESC, done DESC, u.full_name, u.id`,
      params,
    );
    return {
      rows: res.rows.map((r) => ({
        user: {
          id: r.id as string,
          fullName: r.full_name as string,
          avatarUrl: (r.avatar_url as string | null) ?? null,
        } satisfies UserRef,
        open: r.open as number,
        done: r.done as number,
      })),
    };
  }

  /** Finished tracked seconds per day over the last N days (default 7). */
  /**
   * M21: tasks completed per ISO week over the last N weeks (default 8), plus
   * how many were created in each week — a lightweight throughput / burn-up
   * signal. Uses completed_at (set when a task enters a 'done' status).
   */
  private async completionTrend(
    client: PoolClient,
    scope: { spaceIds: string[]; listId: string | null },
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let weeks = 8;
    if (config.weeks !== undefined) {
      if (
        typeof config.weeks !== "number" ||
        !Number.isInteger(config.weeks) ||
        config.weeks < 1 ||
        config.weeks > 26
      ) {
        throw new BadRequestException(
          "config.weeks must be an integer between 1 and 26",
        );
      }
      weeks = config.weeks;
    }
    const params: unknown[] = [];
    const where = this.scopeSql(scope, params);
    params.push(weeks - 1);
    // Monday of the week `weeks-1` weeks ago (inclusive of the current week).
    const startExpr = `date_trunc('week', now()) - ($${params.length}::int * interval '1 week')`;
    // Single query: a generated week axis with correlated counts, so every
    // parameter is referenced (Postgres can't type an unused $N) and empty
    // weeks come back as zero.
    const res = await client.query(
      `SELECT w.week::text AS week,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.completed_at IS NOT NULL
                  AND date_trunc('week', t.completed_at)::date = w.week
                  AND ${where})::int AS completed,
              (SELECT COUNT(*) FROM tasks t
                WHERE date_trunc('week', t.created_at)::date = w.week
                  AND ${where})::int AS created
         FROM (
           SELECT generate_series(
                    ${startExpr},
                    date_trunc('week', now()),
                    interval '1 week'
                  )::date AS week
         ) w
        ORDER BY w.week`,
      params,
    );
    let totalCompleted = 0;
    const series = res.rows.map((r) => {
      const completed = r.completed as number;
      totalCompleted += completed;
      return { week: r.week as string, completed, created: r.created as number };
    });
    return { weeks: series, totalCompleted };
  }

  /**
   * M21: overdue open tasks (past due_date, not in a 'done' status) grouped by
   * assignee, plus an unassigned bucket — a "who is behind" board.
   */
  private async overdueByAssignee(
    client: PoolClient,
    scope: { spaceIds: string[]; listId: string | null },
  ): Promise<Record<string, unknown>> {
    const params: unknown[] = [];
    const where = this.scopeSql(scope, params);
    const assigned = await client.query(
      `SELECT u.id, u.full_name, u.avatar_url, COUNT(*)::int AS overdue
         FROM tasks t
         JOIN task_assignees ta ON ta.task_id = t.id
         JOIN users u ON u.id = ta.user_id
         LEFT JOIN statuses s ON s.id = t.status_id
        WHERE t.archived = false
          AND t.due_date IS NOT NULL
          AND t.due_date < now()
          AND s.type IS DISTINCT FROM 'done'
          AND ${where}
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY overdue DESC, u.full_name, u.id`,
      params,
    );
    const unassigned = await client.query(
      `SELECT COUNT(*)::int AS overdue
         FROM tasks t
         LEFT JOIN statuses s ON s.id = t.status_id
        WHERE t.archived = false
          AND t.due_date IS NOT NULL
          AND t.due_date < now()
          AND s.type IS DISTINCT FROM 'done'
          AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)
          AND ${where}`,
      params,
    );
    return {
      rows: assigned.rows.map((r) => ({
        user: {
          id: r.id as string,
          fullName: r.full_name as string,
          avatarUrl: (r.avatar_url as string | null) ?? null,
        } satisfies UserRef,
        overdue: r.overdue as number,
      })),
      unassigned: (unassigned.rows[0]?.overdue as number) ?? 0,
    };
  }

  private async timeTracked(
    client: PoolClient,
    scope: { spaceIds: string[]; listId: string | null },
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let days = 7;
    if (config.days !== undefined) {
      if (
        typeof config.days !== "number" ||
        !Number.isInteger(config.days) ||
        config.days < 1 ||
        config.days > 90
      ) {
        throw new BadRequestException(
          "config.days must be an integer between 1 and 90",
        );
      }
      days = config.days;
    }
    const today = utcToday();
    const start = new Date(
      Date.parse(`${today}T00:00:00Z`) - (days - 1) * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);

    const params: unknown[] = [];
    const where = this.scopeSql(scope, params);
    params.push(start);
    const res = await client.query(
      `SELECT e.started_at::date::text AS day,
              COALESCE(SUM(e.duration_seconds), 0)::int AS seconds
       FROM time_entries e JOIN tasks t ON t.id = e.task_id
       WHERE e.ended_at IS NOT NULL
         AND e.started_at >= $${params.length}::date
         AND ${where}
       GROUP BY 1`,
      params,
    );
    const byDay = new Map<string, number>(
      res.rows.map((r) => [r.day as string, r.seconds as number]),
    );
    let totalSeconds = 0;
    const series: { date: string; seconds: number }[] = [];
    for (
      let t = Date.parse(`${start}T00:00:00Z`);
      t <= Date.parse(`${today}T00:00:00Z`);
      t += 24 * 60 * 60 * 1000
    ) {
      const date = new Date(t).toISOString().slice(0, 10);
      const seconds = byDay.get(date) ?? 0;
      totalSeconds += seconds;
      series.push({ date, seconds });
    }
    return { days: series, totalSeconds };
  }

  /** Burndown for the configured sprint — same math as /sprints/:id/report. */
  private async sprintBurndown(
    client: PoolClient,
    userId: string,
    role: Role,
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (typeof config.sprintId !== "string") {
      throw new BadRequestException("config.sprintId is required");
    }
    const sprintId = requireUuid(config.sprintId, "config.sprintId");
    const res = await client.query(
      `SELECT id, space_id, list_id, name,
              start_date::text AS start_date, end_date::text AS end_date
       FROM sprints WHERE id = $1`,
      [sprintId],
    );
    const row = res.rows[0];
    // An invisible sprint (private space) reads as missing — never leak it.
    const visible = await this.access.visibleSpaceIds(client, userId, role);
    if (!row || !visible.has(row.space_id as string)) {
      throw new NotFoundException("Sprint not found");
    }
    const listId = row.list_id as string;
    const points = (await sprintPointsForLists(client, [listId])).get(
      listId,
    ) ?? { total: 0, completed: 0 };
    const byDay = await completedPointsByDay(client, listId);
    return {
      sprint: {
        id: row.id as string,
        name: row.name as string,
        startDate: row.start_date as string,
        endDate: row.end_date as string,
      },
      totalPoints: points.total,
      days: computeBurndown(
        points.total,
        byDay,
        row.start_date as string,
        row.end_date as string,
      ),
    };
  }

  /** The last 20 task_activity rows across the caller's visible scope. */
  private async recentActivity(
    client: PoolClient,
    scope: { spaceIds: string[]; listId: string | null },
  ): Promise<Record<string, unknown>> {
    const params: unknown[] = [];
    const where = this.scopeSql(scope, params);
    const res = await client.query(
      `SELECT a.task_id, t.name AS task_name, a.kind, a.created_at,
              u.id AS u_id, u.full_name AS u_full_name,
              u.avatar_url AS u_avatar_url
       FROM task_activity a
       JOIN tasks t ON t.id = a.task_id
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 20`,
      params,
    );
    return {
      items: res.rows.map((r) => ({
        taskId: r.task_id as string,
        taskName: r.task_name as string,
        kind: r.kind as string,
        actor: r.u_id
          ? {
              id: r.u_id as string,
              fullName: r.u_full_name as string,
              avatarUrl: (r.u_avatar_url as string | null) ?? null,
            }
          : null,
        createdAt: iso(r.created_at),
      })),
    };
  }
}
