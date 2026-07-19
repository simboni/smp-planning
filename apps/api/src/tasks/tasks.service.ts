import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { StatusesService, Status } from "./statuses.service";
import { TagsService, Tag } from "./tags.service";
import { Checklist } from "./checklists.service";
import {
  Priority,
  RecurrenceRule,
  advanceByRule,
  optionalName,
  parseDate,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  validColor,
  validPriority,
  validRecurrence,
  assertIdArray,
} from "./tasks.support";

interface UserRef {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface TaskCard {
  id: string;
  listId: string;
  spaceId: string;
  parentTaskId: string | null;
  name: string;
  statusId: string | null;
  status: { id: string; name: string; color: string; type: string } | null;
  priority: Priority | null;
  startDate: string | null;
  dueDate: string | null;
  timeEstimateMinutes: number | null;
  position: number;
  assignees: UserRef[];
  tags: Tag[];
  subtaskCount: number;
  checklistTotal: number;
  checklistDone: number;
  taskType: { id: string; name: string; icon: string; isMilestone: boolean } | null;
  isMilestone: boolean;
  /** Unresolved waiting-on tasks (dep status type != 'done'). */
  blockedCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Lightweight cross-task reference for dependency/link panels. */
export interface TaskRef {
  id: string;
  name: string;
  status: { id: string; name: string; color: string; type: string } | null;
  listId: string;
}

/** A space field projected onto a task (value null when unset). */
export interface TaskFieldValue {
  fieldId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  value: Record<string, unknown> | null;
}

export interface TaskDetail extends TaskCard {
  description: string;
  watchers: UserRef[];
  subtasks: TaskCard[];
  checklists: Checklist[];
  createdBy: UserRef | null;
  recurrence: RecurrenceRule | null;
  fields: TaskFieldValue[];
  waitingOn: TaskRef[];
  blocking: TaskRef[];
  linked: TaskRef[];
  breadcrumb: {
    space: { id: string; name: string; color: string; icon: string | null };
    folder: { id: string; name: string } | null;
    list: { id: string; name: string };
  };
}

/** Task columns + joined status/task type, as selected everywhere below. */
const TASK_COLS = `
  t.id, t.list_id, t.space_id, t.parent_task_id, t.name, t.description,
  t.status_id, t.priority, t.start_date, t.due_date, t.time_estimate_minutes,
  t.position, t.archived, t.created_by, t.created_at, t.updated_at, t.completed_at,
  t.task_type_id, t.is_milestone, t.recurrence,
  s.id AS s_id, s.name AS s_name, s.color AS s_color, s.type AS s_type,
  tt.id AS tt_id, tt.name AS tt_name, tt.icon AS tt_icon,
  tt.is_milestone AS tt_is_milestone`;

/** FROM clause pairing TASK_COLS with its joins. */
const TASK_FROM = `FROM tasks t
  LEFT JOIN statuses s ON s.id = t.status_id
  LEFT JOIN task_types tt ON tt.id = t.task_type_id`;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function userRef(r: Record<string, unknown>): UserRef {
  return {
    id: r.id as string,
    fullName: r.full_name as string,
    avatarUrl: (r.avatar_url as string | null) ?? null,
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly statuses: StatusesService,
    private readonly tags: TagsService,
  ) {}

  // --- helpers --------------------------------------------------------------

  private async listSpace(client: PoolClient, listId: string): Promise<string> {
    const res = await client.query(`SELECT space_id FROM lists WHERE id = $1`, [
      listId,
    ]);
    if (!res.rows[0]) throw new NotFoundException("List not found");
    return res.rows[0].space_id as string;
  }

  private async taskRow(
    client: PoolClient,
    taskId: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(
      `SELECT ${TASK_COLS} ${TASK_FROM} WHERE t.id = $1`,
      [taskId],
    );
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    return res.rows[0];
  }

  private validEstimate(v: unknown): number | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new BadRequestException(
        "timeEstimateMinutes must be a non-negative integer",
      );
    }
    return v;
  }

  private async assertWorkspaceMember(
    client: PoolClient,
    userId: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM memberships WHERE user_id = $1`,
      [userId],
    );
    if (!res.rows[0]) {
      throw new BadRequestException("user is not a member of this workspace");
    }
  }

  /** Validate a status belongs to the space; return its type. */
  private async statusType(
    client: PoolClient,
    statusId: string,
    spaceId: string,
  ): Promise<string> {
    const res = await client.query(
      `SELECT type FROM statuses WHERE id = $1 AND space_id = $2`,
      [statusId, spaceId],
    );
    if (!res.rows[0]) {
      throw new BadRequestException("statusId must reference a status in this space");
    }
    return res.rows[0].type as string;
  }

  // --- Card assembly (batched, no N+1) --------------------------------------

  private baseCard(r: Record<string, unknown>): TaskCard {
    return {
      id: r.id as string,
      listId: r.list_id as string,
      spaceId: r.space_id as string,
      parentTaskId: (r.parent_task_id as string | null) ?? null,
      name: r.name as string,
      statusId: (r.status_id as string | null) ?? null,
      status: r.s_id
        ? {
            id: r.s_id as string,
            name: r.s_name as string,
            color: r.s_color as string,
            type: r.s_type as string,
          }
        : null,
      priority: (r.priority as Priority | null) ?? null,
      startDate: iso(r.start_date),
      dueDate: iso(r.due_date),
      timeEstimateMinutes: (r.time_estimate_minutes as number | null) ?? null,
      position: r.position as number,
      assignees: [],
      tags: [],
      subtaskCount: 0,
      checklistTotal: 0,
      checklistDone: 0,
      taskType: r.tt_id
        ? {
            id: r.tt_id as string,
            name: r.tt_name as string,
            icon: r.tt_icon as string,
            isMilestone: r.tt_is_milestone as boolean,
          }
        : null,
      isMilestone: r.is_milestone as boolean,
      blockedCount: 0,
      archived: r.archived as boolean,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      completedAt: iso(r.completed_at),
    };
  }

  /** Enrich a set of task rows with assignees/tags/counts in 4 batch queries. */
  private async buildCards(
    client: PoolClient,
    rows: Record<string, unknown>[],
  ): Promise<TaskCard[]> {
    const cards = rows.map((r) => this.baseCard(r));
    if (cards.length === 0) return cards;
    const byId = new Map(cards.map((c) => [c.id, c]));
    const ids = cards.map((c) => c.id);

    const assignees = await client.query(
      `SELECT ta.task_id, u.id, u.full_name, u.avatar_url
       FROM task_assignees ta JOIN users u ON u.id = ta.user_id
       WHERE ta.task_id = ANY($1) ORDER BY ta.created_at`,
      [ids],
    );
    for (const r of assignees.rows) {
      byId.get(r.task_id as string)?.assignees.push(userRef(r));
    }

    const tags = await client.query(
      `SELECT tt.task_id, tg.id, tg.name, tg.color
       FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
       WHERE tt.task_id = ANY($1) ORDER BY tg.name`,
      [ids],
    );
    for (const r of tags.rows) {
      byId.get(r.task_id as string)?.tags.push({
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
      });
    }

    const subs = await client.query(
      `SELECT parent_task_id, COUNT(*)::int AS n
       FROM tasks WHERE parent_task_id = ANY($1)
       GROUP BY parent_task_id`,
      [ids],
    );
    for (const r of subs.rows) {
      const c = byId.get(r.parent_task_id as string);
      if (c) c.subtaskCount = r.n as number;
    }

    const checks = await client.query(
      `SELECT c.task_id,
              COUNT(ci.id)::int AS total,
              COUNT(ci.id) FILTER (WHERE ci.resolved)::int AS done
       FROM checklists c
       LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
       WHERE c.task_id = ANY($1)
       GROUP BY c.task_id`,
      [ids],
    );
    for (const r of checks.rows) {
      const c = byId.get(r.task_id as string);
      if (c) {
        c.checklistTotal = r.total as number;
        c.checklistDone = r.done as number;
      }
    }

    // Unresolved waiting-on deps (dep task's status type != 'done'), batched.
    const blocked = await client.query(
      `SELECT d.task_id, COUNT(*)::int AS n
       FROM task_dependencies d
       JOIN tasks dt ON dt.id = d.depends_on_task_id
       LEFT JOIN statuses ds ON ds.id = dt.status_id
       WHERE d.task_id = ANY($1) AND ds.type IS DISTINCT FROM 'done'
       GROUP BY d.task_id`,
      [ids],
    );
    for (const r of blocked.rows) {
      const c = byId.get(r.task_id as string);
      if (c) c.blockedCount = r.n as number;
    }
    return cards;
  }

  // --- Relations / fields for TaskDetail ------------------------------------

  private taskRef(r: Record<string, unknown>): TaskRef {
    return {
      id: r.id as string,
      name: r.name as string,
      listId: r.list_id as string,
      status: r.s_id
        ? {
            id: r.s_id as string,
            name: r.s_name as string,
            color: r.s_color as string,
            type: r.s_type as string,
          }
        : null,
    };
  }

  private async loadRelations(
    client: PoolClient,
    taskId: string,
  ): Promise<{ waitingOn: TaskRef[]; blocking: TaskRef[]; linked: TaskRef[] }> {
    const refCols = `t.id, t.name, t.list_id,
      s.id AS s_id, s.name AS s_name, s.color AS s_color, s.type AS s_type`;
    const waiting = await client.query(
      `SELECT ${refCols}
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.depends_on_task_id
       LEFT JOIN statuses s ON s.id = t.status_id
       WHERE d.task_id = $1 ORDER BY d.created_at`,
      [taskId],
    );
    const blocking = await client.query(
      `SELECT ${refCols}
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.task_id
       LEFT JOIN statuses s ON s.id = t.status_id
       WHERE d.depends_on_task_id = $1 ORDER BY d.created_at`,
      [taskId],
    );
    const linked = await client.query(
      `SELECT ${refCols}
       FROM task_links l
       JOIN tasks t
         ON t.id = CASE WHEN l.task_a = $1 THEN l.task_b ELSE l.task_a END
       LEFT JOIN statuses s ON s.id = t.status_id
       WHERE l.task_a = $1 OR l.task_b = $1 ORDER BY l.created_at`,
      [taskId],
    );
    return {
      waitingOn: waiting.rows.map((r) => this.taskRef(r)),
      blocking: blocking.rows.map((r) => this.taskRef(r)),
      linked: linked.rows.map((r) => this.taskRef(r)),
    };
  }

  /** ALL of the space's fields projected onto the task (unset -> value null). */
  private async loadFields(
    client: PoolClient,
    spaceId: string,
    taskId: string,
  ): Promise<TaskFieldValue[]> {
    const res = await client.query(
      `SELECT f.id, f.name, f.type, f.config, v.value
       FROM custom_fields f
       LEFT JOIN custom_field_values v
         ON v.field_id = f.id AND v.task_id = $2
       WHERE f.space_id = $1
       ORDER BY f.position, f.created_at`,
      [spaceId, taskId],
    );
    return res.rows.map((r) => ({
      fieldId: r.id as string,
      name: r.name as string,
      type: r.type as string,
      config: r.config as Record<string, unknown>,
      value: (r.value as Record<string, unknown> | null) ?? null,
    }));
  }

  private async buildDetail(
    client: PoolClient,
    row: Record<string, unknown>,
  ): Promise<TaskDetail> {
    const [card] = await this.buildCards(client, [row]);
    const taskId = card.id;

    const watchersRes = await client.query(
      `SELECT u.id, u.full_name, u.avatar_url
       FROM task_watchers tw JOIN users u ON u.id = tw.user_id
       WHERE tw.task_id = $1 ORDER BY tw.created_at`,
      [taskId],
    );

    const subRows = await client.query(
      `SELECT ${TASK_COLS} ${TASK_FROM}
       WHERE t.parent_task_id = $1 AND t.archived = false
       ORDER BY s.position NULLS LAST, t.position, t.created_at`,
      [taskId],
    );
    const subtasks = await this.buildCards(client, subRows.rows);

    const checklistRes = await client.query(
      `SELECT id, name, position FROM checklists
       WHERE task_id = $1 ORDER BY position, created_at`,
      [taskId],
    );
    const checklistIds = checklistRes.rows.map((r) => r.id as string);
    const itemsByChecklist = new Map<string, Checklist["items"]>();
    if (checklistIds.length > 0) {
      const itemsRes = await client.query(
        `SELECT id, checklist_id, name, resolved, assignee_user_id, position
         FROM checklist_items WHERE checklist_id = ANY($1)
         ORDER BY position, created_at`,
        [checklistIds],
      );
      for (const r of itemsRes.rows) {
        const arr = itemsByChecklist.get(r.checklist_id as string) ?? [];
        arr.push({
          id: r.id as string,
          name: r.name as string,
          resolved: r.resolved as boolean,
          assigneeUserId: (r.assignee_user_id as string | null) ?? null,
          position: r.position as number,
        });
        itemsByChecklist.set(r.checklist_id as string, arr);
      }
    }
    const checklists: Checklist[] = checklistRes.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      position: r.position as number,
      items: itemsByChecklist.get(r.id as string) ?? [],
    }));

    let createdBy: UserRef | null = null;
    if (row.created_by) {
      const cbRes = await client.query(
        `SELECT id, full_name, avatar_url FROM users WHERE id = $1`,
        [row.created_by as string],
      );
      if (cbRes.rows[0]) createdBy = userRef(cbRes.rows[0]);
    }

    const listRes = await client.query(
      `SELECT id, name, folder_id FROM lists WHERE id = $1`,
      [card.listId],
    );
    const spaceRes = await client.query(
      `SELECT id, name, color, icon FROM spaces WHERE id = $1`,
      [card.spaceId],
    );
    let folder: { id: string; name: string } | null = null;
    const folderId = listRes.rows[0]?.folder_id as string | null;
    if (folderId) {
      const fRes = await client.query(
        `SELECT id, name FROM folders WHERE id = $1`,
        [folderId],
      );
      if (fRes.rows[0]) {
        folder = {
          id: fRes.rows[0].id as string,
          name: fRes.rows[0].name as string,
        };
      }
    }

    const relations = await this.loadRelations(client, taskId);
    const fields = await this.loadFields(client, card.spaceId, taskId);

    return {
      ...card,
      description: (row.description as string) ?? "",
      watchers: watchersRes.rows.map(userRef),
      subtasks,
      checklists,
      createdBy,
      recurrence: (row.recurrence as RecurrenceRule | null) ?? null,
      fields,
      ...relations,
      breadcrumb: {
        space: {
          id: spaceRes.rows[0].id as string,
          name: spaceRes.rows[0].name as string,
          color: spaceRes.rows[0].color as string,
          icon: (spaceRes.rows[0].icon as string | null) ?? null,
        },
        folder,
        list: {
          id: listRes.rows[0].id as string,
          name: listRes.rows[0].name as string,
        },
      },
    };
  }

  // --- Reads ----------------------------------------------------------------

  async listTasks(
    workspaceId: string,
    userId: string,
    role: Role,
    listId: string,
  ): Promise<TaskCard[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.listSpace(client, listId);
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const rows = await client.query(
        `SELECT ${TASK_COLS} ${TASK_FROM}
         WHERE t.list_id = $1 AND t.parent_task_id IS NULL AND t.archived = false
         ORDER BY s.position NULLS LAST, t.position, t.created_at`,
        [listId],
      );
      return this.buildCards(client, rows.rows);
    });
  }

  async getTask(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<TaskDetail> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.taskRow(client, id);
      await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        row.space_id as string,
      );
      return this.buildDetail(client, row);
    });
  }

  // --- Create ---------------------------------------------------------------

  async createTask(
    workspaceId: string,
    userId: string,
    role: Role,
    listId: string,
    body: {
      name?: string;
      statusId?: string;
      priority?: string | null;
      assigneeIds?: string[];
      tagIds?: string[];
      startDate?: string | null;
      dueDate?: string | null;
      timeEstimateMinutes?: number | null;
      description?: string;
      parentTaskId?: string | null;
    },
  ): Promise<TaskDetail> {
    const name = requireName(body?.name);
    const priority = validPriority(body?.priority);
    const startDate = parseDate(body?.startDate, "startDate");
    const dueDate = parseDate(body?.dueDate, "dueDate");
    const timeEstimate = this.validEstimate(body?.timeEstimateMinutes);
    const description =
      typeof body?.description === "string" ? body.description : "";
    const assigneeIds = body?.assigneeIds ?? [];
    const tagIds = body?.tagIds ?? [];
    if (assigneeIds.length) assertIdArray(assigneeIds);
    if (tagIds.length) assertIdArray(tagIds);

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.listSpace(client, listId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await this.statuses.ensureDefaults(client, workspaceId, spaceId);

      let statusId: string | null;
      let sType: string | null;
      if (body?.statusId) {
        sType = await this.statusType(client, body.statusId, spaceId);
        statusId = body.statusId;
      } else {
        const first = await this.statuses.firstStatus(client, spaceId);
        statusId = first?.id ?? null;
        sType = first?.type ?? null;
      }

      let parentTaskId: string | null = null;
      if (body?.parentTaskId) {
        const p = await client.query(
          `SELECT id FROM tasks WHERE id = $1 AND list_id = $2`,
          [body.parentTaskId, listId],
        );
        if (!p.rows[0]) {
          throw new BadRequestException(
            "parentTaskId must reference a task in this list",
          );
        }
        parentTaskId = body.parentTaskId;
      }

      // Validate assignees are workspace members and tags belong to the space.
      for (const uid of assigneeIds) await this.assertWorkspaceMember(client, uid);
      if (tagIds.length) {
        const check = await client.query(
          `SELECT id FROM tags WHERE id = ANY($1) AND space_id = $2`,
          [tagIds, spaceId],
        );
        if (check.rows.length !== new Set(tagIds).size) {
          throw new BadRequestException("tagIds must reference tags in this space");
        }
      }

      const posRes = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks
         WHERE list_id = $1 AND status_id IS NOT DISTINCT FROM $2`,
        [listId, statusId],
      );
      const completedAt = sType === "done" ? new Date() : null;
      const ins = await client.query(
        `INSERT INTO tasks
           (workspace_id, list_id, space_id, parent_task_id, name, description,
            status_id, priority, start_date, due_date, time_estimate_minutes,
            position, created_by, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          workspaceId,
          listId,
          spaceId,
          parentTaskId,
          name,
          description,
          statusId,
          priority,
          startDate,
          dueDate,
          timeEstimate,
          posRes.rows[0].n as number,
          userId,
          completedAt,
        ],
      );
      const taskId = ins.rows[0].id as string;

      for (const uid of new Set(assigneeIds)) {
        await client.query(
          `INSERT INTO task_assignees (workspace_id, task_id, user_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [workspaceId, taskId, uid],
        );
      }
      for (const tid of new Set(tagIds)) {
        await client.query(
          `INSERT INTO task_tags (workspace_id, task_id, tag_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [workspaceId, taskId, tid],
        );
      }

      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "task.created",
        entity: "task",
        entityId: taskId,
        data: { name, listId, parentTaskId },
      });

      const row = await this.taskRow(client, taskId);
      return this.buildDetail(client, row);
    });
  }

  async createSubtask(
    workspaceId: string,
    userId: string,
    role: Role,
    parentId: string,
    body: { name?: string },
  ): Promise<TaskCard> {
    const name = requireName(body?.name);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const parent = await client.query(
        `SELECT list_id, space_id FROM tasks WHERE id = $1`,
        [parentId],
      );
      if (!parent.rows[0]) throw new NotFoundException("Task not found");
      const listId = parent.rows[0].list_id as string;
      const spaceId = parent.rows[0].space_id as string;
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await this.statuses.ensureDefaults(client, workspaceId, spaceId);
      const first = await this.statuses.firstStatus(client, spaceId);
      const statusId = first?.id ?? null;
      const completedAt = first?.type === "done" ? new Date() : null;
      const posRes = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks
         WHERE list_id = $1 AND status_id IS NOT DISTINCT FROM $2`,
        [listId, statusId],
      );
      const ins = await client.query(
        `INSERT INTO tasks
           (workspace_id, list_id, space_id, parent_task_id, name,
            status_id, position, created_by, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          workspaceId,
          listId,
          spaceId,
          parentId,
          name,
          statusId,
          posRes.rows[0].n as number,
          userId,
          completedAt,
        ],
      );
      const taskId = ins.rows[0].id as string;
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "task.created",
        entity: "task",
        entityId: taskId,
        data: { name, listId, parentTaskId: parentId },
      });
      const row = await this.taskRow(client, taskId);
      const [card] = await this.buildCards(client, [row]);
      return card;
    });
  }

  // --- Update / delete ------------------------------------------------------

  async updateTask(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: {
      name?: string;
      description?: string;
      statusId?: string;
      priority?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      timeEstimateMinutes?: number | null;
      archived?: boolean;
      taskTypeId?: string | null;
      isMilestone?: boolean;
      recurrence?: Record<string, unknown> | null;
    },
  ): Promise<TaskDetail & { spawnedTaskId?: string }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.taskRow(client, id);
      const spaceId = existing.space_id as string;
      await requireSpaceEdit(this.access, client, userId, role, spaceId);

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      const auditData: Record<string, unknown> = {};

      const name = optionalName(body?.name);
      if (name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(name);
        auditData.name = name;
      }
      if (body?.description !== undefined) {
        sets.push(`description = $${i++}`);
        params.push(typeof body.description === "string" ? body.description : "");
      }
      if (body?.priority !== undefined) {
        sets.push(`priority = $${i++}`);
        params.push(validPriority(body.priority));
      }
      if (body?.startDate !== undefined) {
        sets.push(`start_date = $${i++}`);
        params.push(parseDate(body.startDate, "startDate"));
      }
      if (body?.dueDate !== undefined) {
        sets.push(`due_date = $${i++}`);
        params.push(parseDate(body.dueDate, "dueDate"));
      }
      if (body?.timeEstimateMinutes !== undefined) {
        sets.push(`time_estimate_minutes = $${i++}`);
        params.push(this.validEstimate(body.timeEstimateMinutes));
      }
      if (body?.archived !== undefined) {
        sets.push(`archived = $${i++}`);
        params.push(body.archived === true);
      }
      if (body?.taskTypeId !== undefined) {
        if (body.taskTypeId === null) {
          sets.push(`task_type_id = NULL`);
        } else {
          const tt = await client.query(
            `SELECT 1 FROM task_types WHERE id = $1 AND space_id = $2`,
            [body.taskTypeId, spaceId],
          );
          if (!tt.rows[0]) {
            throw new BadRequestException(
              "taskTypeId must reference a task type in this space",
            );
          }
          sets.push(`task_type_id = $${i++}`);
          params.push(body.taskTypeId);
        }
        auditData.taskTypeId = body.taskTypeId;
      }
      if (body?.isMilestone !== undefined) {
        if (typeof body.isMilestone !== "boolean") {
          throw new BadRequestException("isMilestone must be a boolean");
        }
        sets.push(`is_milestone = $${i++}`);
        params.push(body.isMilestone);
      }
      if (body?.recurrence !== undefined) {
        const rule = validRecurrence(body.recurrence);
        sets.push(`recurrence = $${i++}`);
        params.push(rule ? JSON.stringify(rule) : null);
        auditData.recurrence = rule;
      }
      let becameDone = false;
      if (body?.statusId !== undefined) {
        const type = await this.statusType(client, body.statusId, spaceId);
        sets.push(`status_id = $${i++}`);
        params.push(body.statusId);
        // Entering a 'done' status completes the task; leaving one reopens it.
        // Being blocked never hard-rejects a done move (ClickUp only warns).
        sets.push(`completed_at = $${i++}`);
        params.push(type === "done" ? new Date() : null);
        auditData.statusId = body.statusId;
        auditData.statusChanged = existing.status_id !== body.statusId;
        becameDone = type === "done" && existing.s_type !== "done";
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      await client.query(
        `UPDATE tasks SET ${sets.join(", ")} WHERE id = $${i}`,
        params,
      );

      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "task.updated",
        entity: "task",
        entityId: id,
        data: auditData,
      });

      // A recurring task completing clones itself to the next occurrence.
      let spawnedTaskId: string | undefined;
      if (becameDone) {
        spawnedTaskId =
          (await this.spawnNextOccurrence(client, workspaceId, userId, id)) ??
          undefined;
      }

      const row = await this.taskRow(client, id);
      const detail = await this.buildDetail(client, row);
      return spawnedTaskId ? { ...detail, spawnedTaskId } : detail;
    });
  }

  // --- Recurrence -----------------------------------------------------------

  /**
   * Clone a just-completed recurring task forward: same list, content, tags,
   * assignees, custom field values, type and rule; status = the space's first
   * not-done status; start/due advanced one step from the ORIGINAL due date
   * (from now when it had none), preserving the start->due gap. The completed
   * original's rule is cleared so history never re-fires. Returns the new
   * task id, or null when the task carries no rule.
   */
  private async spawnNextOccurrence(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    taskId: string,
  ): Promise<string | null> {
    const res = await client.query(
      `SELECT list_id, space_id, start_date, due_date, recurrence
       FROM tasks WHERE id = $1`,
      [taskId],
    );
    const t = res.rows[0];
    if (!t?.recurrence) return null;
    const rule = t.recurrence as RecurrenceRule;
    const listId = t.list_id as string;
    const spaceId = t.space_id as string;

    // First not-done status by position (fall back to the very first).
    const st = await client.query(
      `SELECT id FROM statuses WHERE space_id = $1 AND type <> 'done'
       ORDER BY position, created_at LIMIT 1`,
      [spaceId],
    );
    const statusId =
      (st.rows[0]?.id as string | undefined) ??
      (await this.statuses.firstStatus(client, spaceId))?.id ??
      null;

    const due = t.due_date ? new Date(t.due_date as string | Date) : null;
    const start = t.start_date ? new Date(t.start_date as string | Date) : null;
    const newDue = advanceByRule(due ?? new Date(), rule);
    let newStart: Date | null = null;
    if (start) {
      newStart = due
        ? new Date(newDue.getTime() - (due.getTime() - start.getTime()))
        : advanceByRule(start, rule);
    }

    const posRes = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks
       WHERE list_id = $1 AND status_id IS NOT DISTINCT FROM $2`,
      [listId, statusId],
    );
    const ins = await client.query(
      `INSERT INTO tasks
         (workspace_id, list_id, space_id, parent_task_id, name, description,
          status_id, priority, start_date, due_date, time_estimate_minutes,
          position, created_by, task_type_id, is_milestone, recurrence)
       SELECT workspace_id, list_id, space_id, parent_task_id, name, description,
              $2, priority, $3, $4, time_estimate_minutes,
              $5, $6, task_type_id, is_milestone, recurrence
       FROM tasks WHERE id = $1
       RETURNING id`,
      [taskId, statusId, newStart, newDue, posRes.rows[0].n as number, userId],
    );
    const newId = ins.rows[0].id as string;

    await client.query(
      `INSERT INTO task_assignees (workspace_id, task_id, user_id)
       SELECT workspace_id, $2, user_id FROM task_assignees WHERE task_id = $1`,
      [taskId, newId],
    );
    await client.query(
      `INSERT INTO task_tags (workspace_id, task_id, tag_id)
       SELECT workspace_id, $2, tag_id FROM task_tags WHERE task_id = $1`,
      [taskId, newId],
    );
    await client.query(
      `INSERT INTO custom_field_values (workspace_id, task_id, field_id, value)
       SELECT workspace_id, $2, field_id, value
       FROM custom_field_values WHERE task_id = $1`,
      [taskId, newId],
    );

    // The completed original keeps its history but never re-fires.
    await client.query(
      `UPDATE tasks SET recurrence = NULL, updated_at = now() WHERE id = $1`,
      [taskId],
    );

    await this.audit.record(client, {
      workspaceId,
      actorUserId: userId,
      action: "task.recurred",
      entity: "task",
      entityId: taskId,
      data: { spawnedTaskId: newId, listId, rule: { ...rule } },
    });
    return newId;
  }

  async deleteTask(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.taskRow(client, id);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        existing.space_id as string,
      );
      await client.query(`DELETE FROM tasks WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "task.deleted",
        entity: "task",
        entityId: id,
      });
    });
  }

  // --- Reorder --------------------------------------------------------------

  async reorderTasks(
    workspaceId: string,
    userId: string,
    role: Role,
    listId: string,
    statusId: string,
    ids: string[],
  ): Promise<void> {
    assertIdArray(ids);
    if (typeof statusId !== "string" || !statusId) {
      throw new BadRequestException("statusId is required");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.listSpace(client, listId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const type = await this.statusType(client, statusId, spaceId);
      if (ids.length === 0) return;

      // Recurring tasks about to TRANSITION into done via this move spawn
      // their next occurrence after the update below.
      let recurring: string[] = [];
      if (type === "done") {
        const rec = await client.query(
          `SELECT t.id FROM tasks t
           LEFT JOIN statuses s ON s.id = t.status_id
           WHERE t.id = ANY($1) AND t.list_id = $2
             AND t.recurrence IS NOT NULL
             AND s.type IS DISTINCT FROM 'done'`,
          [ids, listId],
        );
        recurring = rec.rows.map((r) => r.id as string);
      }

      // Move the listed tasks into this status at positions 0..n-1. Preserve a
      // prior completion time; complete freshly moved-in tasks; reopen others.
      await client.query(
        `UPDATE tasks AS t
           SET position = v.ord,
               status_id = $2,
               completed_at = CASE WHEN $3 THEN COALESCE(t.completed_at, now()) ELSE NULL END,
               updated_at = now()
         FROM (SELECT unnest($1::uuid[]) AS id,
                      generate_subscripts($1::uuid[], 1) - 1 AS ord) AS v
         WHERE t.id = v.id AND t.list_id = $4`,
        [ids, statusId, type === "done", listId],
      );

      for (const rid of recurring) {
        await this.spawnNextOccurrence(client, workspaceId, userId, rid);
      }
    });
  }

  // --- Assignees ------------------------------------------------------------

  private async taskSpaceEdit(
    client: PoolClient,
    userId: string,
    role: Role,
    taskId: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT space_id FROM tasks WHERE id = $1`,
      [taskId],
    );
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    await requireSpaceEdit(
      this.access,
      client,
      userId,
      role,
      res.rows[0].space_id as string,
    );
  }

  async addAssignee(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    targetUserId: string,
  ): Promise<void> {
    if (typeof targetUserId !== "string" || !targetUserId) {
      throw new BadRequestException("userId is required");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.taskSpaceEdit(client, userId, role, taskId);
      await this.assertWorkspaceMember(client, targetUserId);
      await client.query(
        `INSERT INTO task_assignees (workspace_id, task_id, user_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [workspaceId, taskId, targetUserId],
      );
    });
  }

  async removeAssignee(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    targetUserId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.taskSpaceEdit(client, userId, role, taskId);
      await client.query(
        `DELETE FROM task_assignees WHERE task_id = $1 AND user_id = $2`,
        [taskId, targetUserId],
      );
    });
  }

  // --- Watchers -------------------------------------------------------------

  async addWatcher(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    targetUserId: string,
  ): Promise<void> {
    if (typeof targetUserId !== "string" || !targetUserId) {
      throw new BadRequestException("userId is required");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.taskSpaceEdit(client, userId, role, taskId);
      await this.assertWorkspaceMember(client, targetUserId);
      await client.query(
        `INSERT INTO task_watchers (workspace_id, task_id, user_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [workspaceId, taskId, targetUserId],
      );
    });
  }

  async removeWatcher(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    targetUserId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.taskSpaceEdit(client, userId, role, taskId);
      await client.query(
        `DELETE FROM task_watchers WHERE task_id = $1 AND user_id = $2`,
        [taskId, targetUserId],
      );
    });
  }

  // --- Task tags ------------------------------------------------------------

  async addTag(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    body: { tagId?: string; name?: string; color?: string },
  ): Promise<Tag> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT space_id FROM tasks WHERE id = $1`,
        [taskId],
      );
      if (!res.rows[0]) throw new NotFoundException("Task not found");
      const spaceId = res.rows[0].space_id as string;
      await requireSpaceEdit(this.access, client, userId, role, spaceId);

      let tag: Tag;
      if (body?.tagId) {
        const t = await client.query(
          `SELECT id, name, color FROM tags WHERE id = $1 AND space_id = $2`,
          [body.tagId, spaceId],
        );
        if (!t.rows[0]) {
          throw new BadRequestException("tagId must reference a tag in this space");
        }
        tag = {
          id: t.rows[0].id as string,
          name: t.rows[0].name as string,
          color: t.rows[0].color as string,
        };
      } else {
        const name = requireName(body?.name);
        const color =
          body?.color === undefined || body.color === null
            ? "#7B68EE"
            : validColor(body.color);
        // Reuse an existing same-name tag rather than 409 when applying inline.
        const existing = await client.query(
          `SELECT id, name, color FROM tags WHERE space_id = $1 AND name = $2`,
          [spaceId, name],
        );
        if (existing.rows[0]) {
          tag = {
            id: existing.rows[0].id as string,
            name: existing.rows[0].name as string,
            color: existing.rows[0].color as string,
          };
        } else {
          tag = await this.tags.insert(client, workspaceId, spaceId, name, color);
        }
      }
      await client.query(
        `INSERT INTO task_tags (workspace_id, task_id, tag_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [workspaceId, taskId, tag.id],
      );
      return tag;
    });
  }

  async removeTag(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    tagId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.taskSpaceEdit(client, userId, role, taskId);
      await client.query(
        `DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2`,
        [taskId, tagId],
      );
    });
  }
}
