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
import type { UserRef } from "../tasks/tasks.service";
import {
  optionalName,
  parseDate,
  requireName,
  requireUuid,
  validColor,
} from "../tasks/tasks.support";

// --- Shapes -----------------------------------------------------------------

export interface GoalFolder {
  id: string;
  name: string;
  color: string;
  position: number;
  goalCount: number;
}

export interface Goal {
  id: string;
  folderId: string | null;
  name: string;
  description: string;
  owner: UserRef | null;
  dueDate: string | null;
  archived: boolean;
  progress: number;
  targetCount: number;
  createdAt: string;
}

export const TARGET_TYPES = ["number", "currency", "boolean", "tasks"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export interface TargetTaskRef {
  id: string;
  name: string;
  listId: string | null;
  statusType: string | null;
}

export interface Target {
  id: string;
  name: string;
  type: TargetType;
  startValue: number;
  targetValue: number;
  currentValue: number;
  currency: string;
  done: boolean;
  position: number;
  progress: number;
  tasks?: TargetTaskRef[];
}

export interface Portfolio {
  id: string;
  name: string;
  color: string;
  itemCount: number;
}

export interface PortfolioItem {
  listId: string;
  listName: string;
  spaceId: string;
  spaceName: string;
  color: string | null;
  stats: { total: number; done: number; inProgress: number; overdue: number };
  progress: number;
}

// --- SQL --------------------------------------------------------------------

const GOAL_SQL = `
  SELECT g.id, g.folder_id, g.name, g.description, g.owner_user_id,
         g.due_date::text AS due_date, g.archived, g.created_by, g.created_at,
         u.full_name AS owner_full_name, u.avatar_url AS owner_avatar_url
  FROM goals g LEFT JOIN users u ON u.id = g.owner_user_id`;

/**
 * Every target with its linked-task completion counts in ONE query (the
 * lateral aggregate collapses target_tasks x statuses), so listing goals
 * never runs a per-goal or per-target query.
 */
const targetSql = (where: string) => `
  SELECT t.id, t.goal_id, t.name, t.type, t.start_value, t.target_value,
         t.current_value, t.currency, t.done, t.position,
         COALESCE(agg.total, 0) AS task_total,
         COALESCE(agg.done_count, 0) AS task_done
  FROM targets t
  LEFT JOIN (
    SELECT l.target_id, COUNT(*)::int AS total,
           (COUNT(*) FILTER (WHERE s.type = 'done'))::int AS done_count
    FROM target_tasks l
    JOIN tasks k ON k.id = l.task_id
    LEFT JOIN statuses s ON s.id = k.status_id
    GROUP BY l.target_id
  ) agg ON agg.target_id = t.id
  WHERE ${where}
  ORDER BY t.position, t.created_at, t.id`;

// --- Small helpers ----------------------------------------------------------

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function validNumber(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new BadRequestException(`${field} must be a finite number`);
  }
  return v;
}

function validCurrency(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z]{3}$/.test(v)) {
    throw new BadRequestException("currency must be a 3-letter code like USD");
  }
  return v.toUpperCase();
}

function validTargetType(v: unknown): TargetType {
  if (!TARGET_TYPES.includes(v as TargetType)) {
    throw new BadRequestException(
      "type must be one of number, currency, boolean, tasks",
    );
  }
  return v as TargetType;
}

/** Validate + dedupe a client id array (each element must be a uuid). */
function uuidSet(v: unknown, label: string): string[] {
  if (!Array.isArray(v)) {
    throw new BadRequestException(`${label} must be an array of task ids`);
  }
  return [...new Set(v.map((x) => requireUuid(x, label)))];
}

interface TargetRow {
  id: string;
  goal_id: string;
  name: string;
  type: TargetType;
  start_value: string;
  target_value: string;
  current_value: string;
  currency: string;
  done: boolean;
  position: number;
  task_total: number;
  task_done: number;
}

/** The 0..1 progress of one target, per its type's rule. */
function targetProgress(r: TargetRow): number {
  if (r.type === "boolean") return r.done ? 1 : 0;
  if (r.type === "tasks") {
    return r.task_total > 0 ? r.task_done / r.task_total : 0;
  }
  const start = num(r.start_value);
  const target = num(r.target_value);
  const current = num(r.current_value);
  // Degenerate range: done iff the current value reached the target.
  if (target === start) return current >= target ? 1 : 0;
  return clamp01((current - start) / (target - start));
}

function toTarget(r: TargetRow): Target {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    startValue: num(r.start_value),
    targetValue: num(r.target_value),
    currentValue: num(r.current_value),
    currency: r.currency,
    done: r.done,
    position: r.position,
    progress: targetProgress(r),
  };
}

/**
 * Module 9: Goals (OKRs) & Portfolios.
 *
 * Goals, goal folders and portfolios are WORKSPACE-WIDE: every member (and
 * admin/owner) can see all of them; guests get 403 at the controller. Any
 * member can create. LIGHT PERMISSION RULE (deliberate): editing/deleting a
 * goal is allowed for its creator, its owner (owner_user_id) or a workspace
 * admin/owner; portfolios for their creator or admin/owner; goal folders
 * carry no created_by column, so any member may edit/delete them.
 *
 * Task/list VISIBILITY still applies at the edges: only tasks/lists in
 * spaces visible to the caller can be linked, portfolio items the caller
 * cannot see are filtered out, and linked tasks in invisible spaces are
 * masked as "Private task" in the goal detail (aggregate counts still
 * include them, names never leak).
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  // --- shared helpers -------------------------------------------------------

  private publishGoalChanged(workspaceId: string, goalId: string): void {
    this.events.publish(workspaceId, {
      type: "goal.changed",
      payload: { goalId },
    });
  }

  private toGoal(
    r: Record<string, unknown>,
    progress: number,
    targetCount: number,
  ): Goal {
    return {
      id: r.id as string,
      folderId: (r.folder_id as string | null) ?? null,
      name: r.name as string,
      description: r.description as string,
      owner: r.owner_user_id
        ? {
            id: r.owner_user_id as string,
            fullName: r.owner_full_name as string,
            avatarUrl: (r.owner_avatar_url as string | null) ?? null,
          }
        : null,
      dueDate: (r.due_date as string | null) ?? null,
      archived: r.archived as boolean,
      progress,
      targetCount,
      createdAt: iso(r.created_at)!,
    };
  }

  /** Target rows grouped per goal (single batched query — no N+1). */
  private async targetsByGoal(
    client: PoolClient,
    goalIds: string[],
  ): Promise<Map<string, TargetRow[]>> {
    const map = new Map<string, TargetRow[]>();
    if (goalIds.length === 0) return map;
    const res = await client.query(targetSql(`t.goal_id = ANY($1::uuid[])`), [
      goalIds,
    ]);
    for (const r of res.rows as TargetRow[]) {
      const list = map.get(r.goal_id) ?? [];
      list.push(r);
      map.set(r.goal_id, list);
    }
    return map;
  }

  /** Mean of the goal's target progresses; 0 when it has no targets. */
  private goalProgress(targets: TargetRow[]): number {
    if (targets.length === 0) return 0;
    const sum = targets.reduce((acc, t) => acc + targetProgress(t), 0);
    return sum / targets.length;
  }

  /** Load a goal row (404 when missing). */
  private async goalRow(
    client: PoolClient,
    goalId: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(`${GOAL_SQL} WHERE g.id = $1`, [goalId]);
    if (!res.rows[0]) throw new NotFoundException("Goal not found");
    return res.rows[0];
  }

  /** Light edit rule: goal creator, goal owner, or workspace admin/owner. */
  private requireGoalEdit(
    row: Record<string, unknown>,
    userId: string,
    role: Role,
  ): void {
    const allowed =
      role === "owner" ||
      role === "admin" ||
      row.created_by === userId ||
      row.owner_user_id === userId;
    if (!allowed) {
      throw new ForbiddenException(
        "Only the goal's creator, its owner or an admin can change it",
      );
    }
  }

  /**
   * All taskIds must exist in this workspace AND live in spaces visible to
   * the caller — otherwise 400 (never link what you cannot see).
   */
  private async requireLinkableTasks(
    client: PoolClient,
    userId: string,
    role: Role,
    taskIds: string[],
  ): Promise<void> {
    if (taskIds.length === 0) return;
    const res = await client.query(
      `SELECT id, space_id FROM tasks WHERE id = ANY($1::uuid[])`,
      [taskIds],
    );
    if (res.rows.length !== taskIds.length) {
      throw new BadRequestException("One or more tasks do not exist");
    }
    const visible = await this.access.visibleSpaceIds(client, userId, role);
    for (const r of res.rows) {
      if (!visible.has(r.space_id as string)) {
        throw new BadRequestException("One or more tasks are not linkable");
      }
    }
  }

  /** Same rule for portfolio lists: exist + visible space, else 400. */
  private async requireLinkableLists(
    client: PoolClient,
    userId: string,
    role: Role,
    listIds: string[],
  ): Promise<void> {
    if (listIds.length === 0) return;
    const res = await client.query(
      `SELECT id, space_id FROM lists WHERE id = ANY($1::uuid[])`,
      [listIds],
    );
    if (res.rows.length !== listIds.length) {
      throw new BadRequestException("One or more lists do not exist");
    }
    const visible = await this.access.visibleSpaceIds(client, userId, role);
    for (const r of res.rows) {
      if (!visible.has(r.space_id as string)) {
        throw new BadRequestException("One or more lists are not linkable");
      }
    }
  }

  /** Optional folder reference must point at an existing folder (400). */
  private async requireFolder(
    client: PoolClient,
    folderId: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT id FROM goal_folders WHERE id = $1`,
      [folderId],
    );
    if (!res.rows[0]) throw new BadRequestException("folderId does not exist");
  }

  /** Optional goal owner must be an active member of the workspace (400). */
  private async requireMemberUser(
    client: PoolClient,
    ownerUserId: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active'`,
      [ownerUserId],
    );
    if (!res.rows[0]) {
      throw new BadRequestException("ownerUserId is not a workspace member");
    }
  }

  // --- Goal folders ---------------------------------------------------------

  async listFolders(workspaceId: string, userId: string): Promise<GoalFolder[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT f.id, f.name, f.color, f.position,
                (SELECT COUNT(*)::int FROM goals g WHERE g.folder_id = f.id)
                  AS goal_count
         FROM goal_folders f
         ORDER BY f.position, f.created_at, f.id`,
      );
      return res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
        position: r.position as number,
        goalCount: r.goal_count as number,
      }));
    });
  }

  async createFolder(
    workspaceId: string,
    userId: string,
    body: { name?: string; color?: string },
  ): Promise<GoalFolder> {
    const name = requireName(body?.name);
    const color = body?.color !== undefined ? validColor(body.color) : undefined;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const pos = await client.query(
        `SELECT COALESCE(MAX(position) + 1, 0)::int AS n FROM goal_folders`,
      );
      const res = await client.query(
        `INSERT INTO goal_folders (workspace_id, name, color, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, color, position`,
        [workspaceId, name, color ?? "#7B68EE", pos.rows[0].n as number],
      );
      const r = res.rows[0];
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "goal_folder.created",
        entity: "goal_folder",
        entityId: r.id as string,
        data: { name },
      });
      return {
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
        position: r.position as number,
        goalCount: 0,
      };
    });
  }

  // NOTE (light rule): goal_folders carry no created_by column, so any
  // member may rename/recolor/delete a folder (admins included, of course).
  async updateFolder(
    workspaceId: string,
    userId: string,
    folderId: string,
    body: { name?: string; color?: string },
  ): Promise<GoalFolder> {
    const name = optionalName(body?.name);
    const color = body?.color !== undefined ? validColor(body.color) : undefined;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(name);
      }
      if (color !== undefined) {
        sets.push(`color = $${i++}`);
        params.push(color);
      }
      if (sets.length === 0) sets.push(`name = name`);
      params.push(folderId);
      const res = await client.query(
        `UPDATE goal_folders SET ${sets.join(", ")} WHERE id = $${i}
         RETURNING id, name, color, position,
           (SELECT COUNT(*)::int FROM goals g WHERE g.folder_id = goal_folders.id)
             AS goal_count`,
        params,
      );
      if (!res.rows[0]) throw new NotFoundException("Goal folder not found");
      const r = res.rows[0];
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "goal_folder.updated",
        entity: "goal_folder",
        entityId: folderId,
      });
      return {
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
        position: r.position as number,
        goalCount: r.goal_count as number,
      };
    });
  }

  async deleteFolder(
    workspaceId: string,
    userId: string,
    folderId: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      // Goals survive: goals.folder_id is ON DELETE SET NULL.
      const res = await client.query(
        `DELETE FROM goal_folders WHERE id = $1 RETURNING id`,
        [folderId],
      );
      if (!res.rows[0]) throw new NotFoundException("Goal folder not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "goal_folder.deleted",
        entity: "goal_folder",
        entityId: folderId,
      });
    });
  }

  // --- Goals ----------------------------------------------------------------

  async listGoals(
    workspaceId: string,
    userId: string,
    includeArchived: boolean,
  ): Promise<Goal[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `${GOAL_SQL}
         WHERE $1 OR g.archived = false
         ORDER BY g.created_at, g.id`,
        [includeArchived],
      );
      const byGoal = await this.targetsByGoal(
        client,
        res.rows.map((r) => r.id as string),
      );
      return res.rows.map((r) => {
        const targets = byGoal.get(r.id as string) ?? [];
        return this.toGoal(r, this.goalProgress(targets), targets.length);
      });
    });
  }

  async createGoal(
    workspaceId: string,
    userId: string,
    body: {
      name?: string;
      description?: string;
      folderId?: string;
      ownerUserId?: string;
      dueDate?: string;
    },
  ): Promise<Goal> {
    const name = requireName(body?.name);
    const description =
      body?.description !== undefined ? String(body.description) : "";
    const folderId =
      body?.folderId != null ? requireUuid(body.folderId, "folderId") : null;
    const ownerUserId =
      body?.ownerUserId != null
        ? requireUuid(body.ownerUserId, "ownerUserId")
        : null;
    const dueDate = parseDate(body?.dueDate, "dueDate");
    const goal = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        if (folderId) await this.requireFolder(client, folderId);
        if (ownerUserId) await this.requireMemberUser(client, ownerUserId);
        const ins = await client.query(
          `INSERT INTO goals
             (workspace_id, folder_id, name, description, owner_user_id,
              due_date, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [workspaceId, folderId, name, description, ownerUserId, dueDate, userId],
        );
        const row = await this.goalRow(client, ins.rows[0].id as string);
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "goal.created",
          entity: "goal",
          entityId: row.id as string,
          data: { name },
        });
        return this.toGoal(row, 0, 0);
      },
    );
    this.publishGoalChanged(workspaceId, goal.id);
    return goal;
  }

  async getGoal(
    workspaceId: string,
    userId: string,
    role: Role,
    goalId: string,
  ): Promise<Goal & { targets: Target[] }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.goalRow(client, goalId);
      const rows = (await this.targetsByGoal(client, [goalId])).get(goalId) ?? [];
      const targets = rows.map(toTarget);

      // Linked tasks for 'tasks' targets, masking those the caller cannot
      // see: {id, name:"Private task", listId:null} — the id stays stable
      // for unlink flows, the name/list never leak.
      const taskTargetIds = rows
        .filter((r) => r.type === "tasks")
        .map((r) => r.id);
      if (taskTargetIds.length > 0) {
        const links = await client.query(
          `SELECT l.target_id, k.id, k.name, k.list_id, k.space_id,
                  s.type AS status_type
           FROM target_tasks l
           JOIN tasks k ON k.id = l.task_id
           LEFT JOIN statuses s ON s.id = k.status_id
           WHERE l.target_id = ANY($1::uuid[])
           ORDER BY k.name, k.id`,
          [taskTargetIds],
        );
        const visible = await this.access.visibleSpaceIds(client, userId, role);
        const byTarget = new Map<string, TargetTaskRef[]>();
        for (const r of links.rows) {
          const refs = byTarget.get(r.target_id as string) ?? [];
          refs.push(
            visible.has(r.space_id as string)
              ? {
                  id: r.id as string,
                  name: r.name as string,
                  listId: r.list_id as string,
                  statusType: (r.status_type as string | null) ?? null,
                }
              : { id: r.id as string, name: "Private task", listId: null, statusType: null },
          );
          byTarget.set(r.target_id as string, refs);
        }
        for (const t of targets) {
          if (t.type === "tasks") t.tasks = byTarget.get(t.id) ?? [];
        }
      }
      return {
        ...this.toGoal(row, this.goalProgress(rows), rows.length),
        targets,
      };
    });
  }

  async updateGoal(
    workspaceId: string,
    userId: string,
    role: Role,
    goalId: string,
    body: {
      name?: string;
      description?: string;
      folderId?: string | null;
      ownerUserId?: string | null;
      dueDate?: string | null;
      archived?: boolean;
    },
  ): Promise<Goal> {
    const name = optionalName(body?.name);
    const goal = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const row = await this.goalRow(client, goalId);
        this.requireGoalEdit(row, userId, role);

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (name !== undefined) {
          sets.push(`name = $${i++}`);
          params.push(name);
        }
        if (body?.description !== undefined) {
          sets.push(`description = $${i++}`);
          params.push(String(body.description));
        }
        if (body?.folderId !== undefined) {
          const folderId =
            body.folderId === null
              ? null
              : requireUuid(body.folderId, "folderId");
          if (folderId) await this.requireFolder(client, folderId);
          sets.push(`folder_id = $${i++}`);
          params.push(folderId);
        }
        if (body?.ownerUserId !== undefined) {
          const ownerUserId =
            body.ownerUserId === null
              ? null
              : requireUuid(body.ownerUserId, "ownerUserId");
          if (ownerUserId) await this.requireMemberUser(client, ownerUserId);
          sets.push(`owner_user_id = $${i++}`);
          params.push(ownerUserId);
        }
        if (body?.dueDate !== undefined) {
          sets.push(`due_date = $${i++}`);
          params.push(parseDate(body.dueDate, "dueDate"));
        }
        if (body?.archived !== undefined) {
          sets.push(`archived = $${i++}`);
          params.push(body.archived === true);
        }
        if (sets.length > 0) {
          sets.push(`updated_at = now()`);
          params.push(goalId);
          await client.query(
            `UPDATE goals SET ${sets.join(", ")} WHERE id = $${i}`,
            params,
          );
        }
        const fresh = await this.goalRow(client, goalId);
        const targets = (await this.targetsByGoal(client, [goalId])).get(goalId) ?? [];
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "goal.updated",
          entity: "goal",
          entityId: goalId,
        });
        return this.toGoal(fresh, this.goalProgress(targets), targets.length);
      },
    );
    this.publishGoalChanged(workspaceId, goalId);
    return goal;
  }

  async deleteGoal(
    workspaceId: string,
    userId: string,
    role: Role,
    goalId: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.goalRow(client, goalId);
      this.requireGoalEdit(row, userId, role);
      await client.query(`DELETE FROM goals WHERE id = $1`, [goalId]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "goal.deleted",
        entity: "goal",
        entityId: goalId,
      });
    });
    this.publishGoalChanged(workspaceId, goalId);
  }

  // --- Targets --------------------------------------------------------------

  /** One target (with computed progress) by id; 404 when missing. */
  private async targetOut(client: PoolClient, targetId: string): Promise<Target> {
    const res = await client.query(targetSql(`t.id = $1`), [targetId]);
    if (!res.rows[0]) throw new NotFoundException("Target not found");
    return toTarget(res.rows[0] as TargetRow);
  }

  async createTarget(
    workspaceId: string,
    userId: string,
    role: Role,
    goalId: string,
    body: {
      name?: string;
      type?: string;
      startValue?: number;
      targetValue?: number;
      currency?: string;
      taskIds?: string[];
    },
  ): Promise<Target> {
    const name = requireName(body?.name);
    const type = validTargetType(body?.type);
    const startValue =
      body?.startValue !== undefined ? validNumber(body.startValue, "startValue") : 0;
    const targetValue =
      body?.targetValue !== undefined
        ? validNumber(body.targetValue, "targetValue")
        : 100;
    const currency =
      body?.currency !== undefined ? validCurrency(body.currency) : undefined;
    const taskIds =
      body?.taskIds !== undefined ? uuidSet(body.taskIds, "taskIds") : [];
    if (type !== "tasks" && taskIds.length > 0) {
      throw new BadRequestException("taskIds only apply to 'tasks' targets");
    }

    const target = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const row = await this.goalRow(client, goalId);
        this.requireGoalEdit(row, userId, role);
        await this.requireLinkableTasks(client, userId, role, taskIds);
        const pos = await client.query(
          `SELECT COALESCE(MAX(position) + 1, 0)::int AS n
           FROM targets WHERE goal_id = $1`,
          [goalId],
        );
        // number/currency targets start where the range starts.
        const ins = await client.query(
          `INSERT INTO targets
             (workspace_id, goal_id, name, type, start_value, target_value,
              current_value, currency, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            workspaceId,
            goalId,
            name,
            type,
            startValue,
            targetValue,
            startValue,
            currency ?? "USD",
            pos.rows[0].n as number,
          ],
        );
        const targetId = ins.rows[0].id as string;
        for (const taskId of taskIds) {
          await client.query(
            `INSERT INTO target_tasks (workspace_id, target_id, task_id)
             VALUES ($1, $2, $3)`,
            [workspaceId, targetId, taskId],
          );
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "target.created",
          entity: "target",
          entityId: targetId,
          data: { goalId, name, type },
        });
        return this.targetOut(client, targetId);
      },
    );
    this.publishGoalChanged(workspaceId, goalId);
    return target;
  }

  async updateTarget(
    workspaceId: string,
    userId: string,
    role: Role,
    targetId: string,
    body: {
      name?: string;
      startValue?: number;
      targetValue?: number;
      currentValue?: number;
      currency?: string;
      done?: boolean;
      taskIds?: string[];
    },
  ): Promise<Target> {
    const name = optionalName(body?.name);
    const { target, goalId } = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const existing = await client.query(
          `SELECT goal_id, type FROM targets WHERE id = $1`,
          [targetId],
        );
        if (!existing.rows[0]) throw new NotFoundException("Target not found");
        const goalId = existing.rows[0].goal_id as string;
        const type = existing.rows[0].type as TargetType;
        const goal = await this.goalRow(client, goalId);
        this.requireGoalEdit(goal, userId, role);

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (name !== undefined) {
          sets.push(`name = $${i++}`);
          params.push(name);
        }
        if (body?.startValue !== undefined) {
          sets.push(`start_value = $${i++}`);
          params.push(validNumber(body.startValue, "startValue"));
        }
        if (body?.targetValue !== undefined) {
          sets.push(`target_value = $${i++}`);
          params.push(validNumber(body.targetValue, "targetValue"));
        }
        if (body?.currentValue !== undefined) {
          sets.push(`current_value = $${i++}`);
          params.push(validNumber(body.currentValue, "currentValue"));
        }
        if (body?.currency !== undefined) {
          sets.push(`currency = $${i++}`);
          params.push(validCurrency(body.currency));
        }
        if (body?.done !== undefined) {
          sets.push(`done = $${i++}`);
          params.push(body.done === true);
        }
        if (sets.length > 0) {
          params.push(targetId);
          await client.query(
            `UPDATE targets SET ${sets.join(", ")} WHERE id = $${i}`,
            params,
          );
        }
        if (body?.taskIds !== undefined) {
          if (type !== "tasks") {
            throw new BadRequestException(
              "taskIds only apply to 'tasks' targets",
            );
          }
          const taskIds = uuidSet(body.taskIds, "taskIds");
          await this.requireLinkableTasks(client, userId, role, taskIds);
          // taskIds REPLACES the linked set.
          await client.query(`DELETE FROM target_tasks WHERE target_id = $1`, [
            targetId,
          ]);
          for (const taskId of taskIds) {
            await client.query(
              `INSERT INTO target_tasks (workspace_id, target_id, task_id)
               VALUES ($1, $2, $3)`,
              [workspaceId, targetId, taskId],
            );
          }
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "target.updated",
          entity: "target",
          entityId: targetId,
          data: { goalId },
        });
        return { target: await this.targetOut(client, targetId), goalId };
      },
    );
    this.publishGoalChanged(workspaceId, goalId);
    return target;
  }

  async deleteTarget(
    workspaceId: string,
    userId: string,
    role: Role,
    targetId: string,
  ): Promise<void> {
    const goalId = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const existing = await client.query(
          `SELECT goal_id FROM targets WHERE id = $1`,
          [targetId],
        );
        if (!existing.rows[0]) throw new NotFoundException("Target not found");
        const goalId = existing.rows[0].goal_id as string;
        const goal = await this.goalRow(client, goalId);
        this.requireGoalEdit(goal, userId, role);
        await client.query(`DELETE FROM targets WHERE id = $1`, [targetId]);
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "target.deleted",
          entity: "target",
          entityId: targetId,
          data: { goalId },
        });
        return goalId;
      },
    );
    this.publishGoalChanged(workspaceId, goalId);
  }

  // --- Portfolios -----------------------------------------------------------

  async listPortfolios(workspaceId: string, userId: string): Promise<Portfolio[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT p.id, p.name, p.color,
                (SELECT COUNT(*)::int FROM portfolio_items i
                  WHERE i.portfolio_id = p.id) AS item_count
         FROM portfolios p ORDER BY p.created_at, p.id`,
      );
      return res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
        itemCount: r.item_count as number,
      }));
    });
  }

  async createPortfolio(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { name?: string; color?: string; listIds?: string[] },
  ): Promise<Portfolio> {
    const name = requireName(body?.name);
    const color = body?.color !== undefined ? validColor(body.color) : undefined;
    const listIds =
      body?.listIds !== undefined ? uuidSet(body.listIds, "listIds") : [];
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireLinkableLists(client, userId, role, listIds);
      const res = await client.query(
        `INSERT INTO portfolios (workspace_id, name, color, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, color`,
        [workspaceId, name, color ?? "#7B68EE", userId],
      );
      const r = res.rows[0];
      for (const [idx, listId] of listIds.entries()) {
        await client.query(
          `INSERT INTO portfolio_items (workspace_id, portfolio_id, list_id, position)
           VALUES ($1, $2, $3, $4)`,
          [workspaceId, r.id as string, listId, idx],
        );
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "portfolio.created",
        entity: "portfolio",
        entityId: r.id as string,
        data: { name },
      });
      return {
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
        itemCount: listIds.length,
      };
    });
  }

  async getPortfolio(
    workspaceId: string,
    userId: string,
    role: Role,
    portfolioId: string,
  ): Promise<{ portfolio: Portfolio; items: PortfolioItem[] }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, name, color FROM portfolios WHERE id = $1`,
        [portfolioId],
      );
      if (!res.rows[0]) throw new NotFoundException("Portfolio not found");
      const itemsRes = await client.query(
        `SELECT i.list_id, l.name AS list_name, l.color, l.space_id,
                s.name AS space_name
         FROM portfolio_items i
         JOIN lists l ON l.id = i.list_id
         JOIN spaces s ON s.id = l.space_id
         WHERE i.portfolio_id = $1
         ORDER BY i.position, i.list_id`,
        [portfolioId],
      );
      // Lists in spaces the caller cannot see are FILTERED OUT (itemCount
      // still reflects the full membership).
      const visible = await this.access.visibleSpaceIds(client, userId, role);
      const rows = itemsRes.rows.filter((r) =>
        visible.has(r.space_id as string),
      );
      const listIds = rows.map((r) => r.list_id as string);

      // Per-list rollup in ONE grouped query: total non-archived tasks,
      // done (status type 'done'), inProgress ('active'), overdue (past due
      // and not done — a missing status counts as not done).
      const stats = new Map<
        string,
        { total: number; done: number; inProgress: number; overdue: number }
      >();
      if (listIds.length > 0) {
        const statsRes = await client.query(
          `SELECT t.list_id,
                  COUNT(*)::int AS total,
                  (COUNT(*) FILTER (WHERE s.type = 'done'))::int AS done,
                  (COUNT(*) FILTER (WHERE s.type = 'active'))::int AS in_progress,
                  (COUNT(*) FILTER (
                     WHERE t.due_date < now()
                       AND (s.type IS NULL OR s.type <> 'done')))::int AS overdue
           FROM tasks t LEFT JOIN statuses s ON s.id = t.status_id
           WHERE t.archived = false AND t.list_id = ANY($1::uuid[])
           GROUP BY t.list_id`,
          [listIds],
        );
        for (const r of statsRes.rows) {
          stats.set(r.list_id as string, {
            total: r.total as number,
            done: r.done as number,
            inProgress: r.in_progress as number,
            overdue: r.overdue as number,
          });
        }
      }
      const items = rows.map((r) => {
        const st = stats.get(r.list_id as string) ?? {
          total: 0,
          done: 0,
          inProgress: 0,
          overdue: 0,
        };
        return {
          listId: r.list_id as string,
          listName: r.list_name as string,
          spaceId: r.space_id as string,
          spaceName: r.space_name as string,
          color: (r.color as string | null) ?? null,
          stats: st,
          progress: st.total > 0 ? st.done / st.total : 0,
        };
      });
      return {
        portfolio: {
          id: res.rows[0].id as string,
          name: res.rows[0].name as string,
          color: res.rows[0].color as string,
          itemCount: itemsRes.rows.length,
        },
        items,
      };
    });
  }

  /** Light rule: a portfolio is edited/deleted by its creator or admin/owner. */
  private requirePortfolioEdit(
    row: Record<string, unknown>,
    userId: string,
    role: Role,
  ): void {
    const allowed =
      role === "owner" || role === "admin" || row.created_by === userId;
    if (!allowed) {
      throw new ForbiddenException(
        "Only the portfolio's creator or an admin can change it",
      );
    }
  }

  async updatePortfolio(
    workspaceId: string,
    userId: string,
    role: Role,
    portfolioId: string,
    body: { name?: string; color?: string; listIds?: string[] },
  ): Promise<Portfolio> {
    const name = optionalName(body?.name);
    const color = body?.color !== undefined ? validColor(body.color) : undefined;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, name, color, created_by FROM portfolios WHERE id = $1`,
        [portfolioId],
      );
      if (!res.rows[0]) throw new NotFoundException("Portfolio not found");
      this.requirePortfolioEdit(res.rows[0], userId, role);

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(name);
      }
      if (color !== undefined) {
        sets.push(`color = $${i++}`);
        params.push(color);
      }
      if (sets.length > 0) {
        params.push(portfolioId);
        await client.query(
          `UPDATE portfolios SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      if (body?.listIds !== undefined) {
        // listIds REPLACES the membership (same visibility rule as create).
        const listIds = uuidSet(body.listIds, "listIds");
        await this.requireLinkableLists(client, userId, role, listIds);
        await client.query(
          `DELETE FROM portfolio_items WHERE portfolio_id = $1`,
          [portfolioId],
        );
        for (const [idx, listId] of listIds.entries()) {
          await client.query(
            `INSERT INTO portfolio_items (workspace_id, portfolio_id, list_id, position)
             VALUES ($1, $2, $3, $4)`,
            [workspaceId, portfolioId, listId, idx],
          );
        }
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "portfolio.updated",
        entity: "portfolio",
        entityId: portfolioId,
      });
      const out = await client.query(
        `SELECT p.id, p.name, p.color,
                (SELECT COUNT(*)::int FROM portfolio_items i
                  WHERE i.portfolio_id = p.id) AS item_count
         FROM portfolios p WHERE p.id = $1`,
        [portfolioId],
      );
      const r = out.rows[0];
      return {
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
        itemCount: r.item_count as number,
      };
    });
  }

  async deletePortfolio(
    workspaceId: string,
    userId: string,
    role: Role,
    portfolioId: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, created_by FROM portfolios WHERE id = $1`,
        [portfolioId],
      );
      if (!res.rows[0]) throw new NotFoundException("Portfolio not found");
      this.requirePortfolioEdit(res.rows[0], userId, role);
      await client.query(`DELETE FROM portfolios WHERE id = $1`, [portfolioId]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "portfolio.deleted",
        entity: "portfolio",
        entityId: portfolioId,
      });
    });
  }
}
