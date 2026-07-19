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
import { StatusesService } from "../tasks/statuses.service";
import {
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  requireUuid,
} from "../tasks/tasks.support";

export type TemplateKind = "task" | "list" | "doc" | "space";

/** Summary DTO returned by the list/create endpoints (payload omitted). */
export interface TemplateDto {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  icon: string;
  createdAt: string;
}

// --- Serialized payload shapes ---------------------------------------------

interface TaskPayload {
  name: string;
  description: string;
  priority: string | null;
  timeEstimateMinutes: number | null;
  sprintPoints: number | null;
  checklists: { name: string; items: { name: string; resolved: boolean }[] }[];
  subtasks: { name: string }[];
  tags: string[];
}

interface StatusPayload {
  name: string;
  color: string;
  type: string;
  position: number;
}

interface ListPayload {
  list: { name: string; color: string | null };
  statuses: StatusPayload[];
  tasks: TaskPayload[];
}

interface DocPayload {
  doc: { name: string; icon: string };
  pages: {
    title: string;
    content: string;
    parentIndex: number;
    position: number;
  }[];
}

interface SpacePayload {
  space: { name: string; color: string; icon: string | null };
  statuses: StatusPayload[];
  folders: { name: string }[];
  lists: { name: string; color: string | null; folderIndex: number }[];
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Module 14: Templates.
 *
 * A template captures the STRUCTURE of a task / list / doc / space as a jsonb
 * payload that can be re-instantiated into a target. Creating a template
 * serializes the (visible) source; applying one re-creates it under fresh ids.
 * Members-only surface: guests are refused on every route (403).
 *
 * Serialization is deliberately structure-only where noted (a Space template
 * captures its statuses/folders/lists but NOT their tasks). Apply re-creates
 * space-level statuses fresh in the target — for M14 this can duplicate a
 * target space's existing default statuses; that is accepted/best-effort.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly statuses: StatusesService,
  ) {}

  private requireMember(role: Role): void {
    if (role === "guest") {
      throw new ForbiddenException("Templates are available to members only");
    }
  }

  private validIcon(icon: unknown, fallback: string): string {
    if (icon === undefined || icon === null) return fallback;
    if (typeof icon !== "string" || !icon.trim() || icon.length > 16) {
      throw new BadRequestException("icon must be a short non-empty string");
    }
    return icon.trim();
  }

  private toDto(r: Record<string, unknown>): TemplateDto {
    return {
      id: r.id as string,
      kind: r.kind as TemplateKind,
      name: r.name as string,
      description: r.description as string,
      icon: r.icon as string,
      createdAt: iso(r.created_at),
    };
  }

  // --- List / patch / delete ------------------------------------------------

  async list(
    workspaceId: string,
    userId: string,
    role: Role,
    kind?: string,
  ): Promise<TemplateDto[]> {
    this.requireMember(role);
    const filterKind =
      kind === undefined || kind === "" ? null : this.assertKind(kind);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, kind, name, description, icon, created_at
           FROM templates
          WHERE ($1::text IS NULL OR kind = $1)
          ORDER BY created_at DESC`,
        [filterKind],
      );
      return res.rows.map((r) => this.toDto(r));
    });
  }

  private assertKind(kind: string): TemplateKind {
    if (
      kind !== "task" &&
      kind !== "list" &&
      kind !== "doc" &&
      kind !== "space"
    ) {
      throw new BadRequestException("kind must be task, list, doc or space");
    }
    return kind;
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; description?: string; icon?: string },
  ): Promise<TemplateDto> {
    this.requireMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await this.loadTemplateMeta(client, id);
      this.requireCreatorOrAdmin(owning.created_by, userId, role);

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (body?.name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(requireName(body.name));
      }
      if (body?.description !== undefined) {
        sets.push(`description = $${i++}`);
        params.push(
          typeof body.description === "string" ? body.description : "",
        );
      }
      if (body?.icon !== undefined) {
        sets.push(`icon = $${i++}`);
        params.push(this.validIcon(body.icon, "📋"));
      }
      if (sets.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE templates SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      const res = await client.query(
        `SELECT id, kind, name, description, icon, created_at
           FROM templates WHERE id = $1`,
        [id],
      );
      return this.toDto(res.rows[0]);
    });
  }

  async remove(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    this.requireMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await this.loadTemplateMeta(client, id);
      this.requireCreatorOrAdmin(owning.created_by, userId, role);
      await client.query(`DELETE FROM templates WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "template.deleted",
        entity: "template",
        entityId: id,
      });
    });
  }

  private async loadTemplateMeta(
    client: PoolClient,
    id: string,
  ): Promise<{ created_by: string | null; kind: TemplateKind }> {
    const res = await client.query(
      `SELECT created_by, kind FROM templates WHERE id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException("Template not found");
    return {
      created_by: (res.rows[0].created_by as string | null) ?? null,
      kind: res.rows[0].kind as TemplateKind,
    };
  }

  private requireCreatorOrAdmin(
    createdBy: string | null,
    userId: string,
    role: Role,
  ): void {
    const isAdmin = role === "owner" || role === "admin";
    if (createdBy !== userId && !isAdmin) {
      throw new ForbiddenException(
        "Only the template's creator or a workspace admin can manage it",
      );
    }
  }

  // --- Create-from-source ---------------------------------------------------

  async createFromTask(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    body: { name?: string; description?: string; icon?: string },
  ): Promise<TemplateDto> {
    this.requireMember(role);
    const name = requireName(body?.name);
    const description =
      typeof body?.description === "string" ? body.description : "";
    const icon = this.validIcon(body?.icon, "✅");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await client.query(
        `SELECT space_id FROM tasks WHERE id = $1`,
        [taskId],
      );
      if (!row.rows[0]) throw new NotFoundException("Task not found");
      await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        row.rows[0].space_id as string,
      );
      const payload = await this.serializeTask(client, taskId);
      return this.insertTemplate(
        client,
        workspaceId,
        userId,
        "task",
        name,
        description,
        icon,
        payload,
      );
    });
  }

  async createFromList(
    workspaceId: string,
    userId: string,
    role: Role,
    listId: string,
    body: { name?: string; description?: string; icon?: string },
  ): Promise<TemplateDto> {
    this.requireMember(role);
    const name = requireName(body?.name);
    const description =
      typeof body?.description === "string" ? body.description : "";
    const icon = this.validIcon(body?.icon, "📋");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await client.query(
        `SELECT space_id, name, color FROM lists WHERE id = $1`,
        [listId],
      );
      if (!row.rows[0]) throw new NotFoundException("List not found");
      const spaceId = row.rows[0].space_id as string;
      await requireSpaceVisible(this.access, client, userId, role, spaceId);

      const statuses = await this.serializeStatuses(client, spaceId);
      const taskRows = await client.query(
        `SELECT id FROM tasks
          WHERE list_id = $1 AND parent_task_id IS NULL AND archived = false
          ORDER BY position, created_at`,
        [listId],
      );
      const tasks: TaskPayload[] = [];
      for (const t of taskRows.rows) {
        tasks.push(await this.serializeTask(client, t.id as string));
      }
      const payload: ListPayload = {
        list: {
          name: row.rows[0].name as string,
          color: (row.rows[0].color as string | null) ?? null,
        },
        statuses,
        tasks,
      };
      return this.insertTemplate(
        client,
        workspaceId,
        userId,
        "list",
        name,
        description,
        icon,
        payload,
      );
    });
  }

  async createFromDoc(
    workspaceId: string,
    userId: string,
    role: Role,
    docId: string,
    body: { name?: string; description?: string; icon?: string },
  ): Promise<TemplateDto> {
    this.requireMember(role);
    const name = requireName(body?.name);
    const description =
      typeof body?.description === "string" ? body.description : "";
    const icon = this.validIcon(body?.icon, "📄");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await client.query(
        `SELECT name, icon, space_id, is_private, created_by
           FROM docs WHERE id = $1`,
        [docId],
      );
      if (!row.rows[0]) throw new NotFoundException("Doc not found");
      await this.assertDocVisible(client, userId, role, row.rows[0]);

      const pagesRes = await client.query(
        `SELECT id, parent_page_id, title, content, position
           FROM doc_pages WHERE doc_id = $1`,
        [docId],
      );
      const payload: DocPayload = {
        doc: {
          name: row.rows[0].name as string,
          icon: row.rows[0].icon as string,
        },
        pages: this.serializePageTree(pagesRes.rows),
      };
      return this.insertTemplate(
        client,
        workspaceId,
        userId,
        "doc",
        name,
        description,
        icon,
        payload,
      );
    });
  }

  async createFromSpace(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string; description?: string; icon?: string },
  ): Promise<TemplateDto> {
    this.requireMember(role);
    const name = requireName(body?.name);
    const description =
      typeof body?.description === "string" ? body.description : "";
    const icon = this.validIcon(body?.icon, "🚀");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const spaceRow = await client.query(
        `SELECT name, color, icon FROM spaces WHERE id = $1`,
        [spaceId],
      );
      if (!spaceRow.rows[0]) throw new NotFoundException("Space not found");

      const statuses = await this.serializeStatuses(client, spaceId);
      const foldersRes = await client.query(
        `SELECT id, name FROM folders
          WHERE space_id = $1 AND archived = false
          ORDER BY sort_order, created_at`,
        [spaceId],
      );
      const folderIndexById = new Map<string, number>();
      const folders = foldersRes.rows.map((f, idx) => {
        folderIndexById.set(f.id as string, idx);
        return { name: f.name as string };
      });
      const listsRes = await client.query(
        `SELECT name, color, folder_id FROM lists
          WHERE space_id = $1 AND archived = false
          ORDER BY sort_order, created_at`,
        [spaceId],
      );
      const lists = listsRes.rows.map((l) => {
        const folderId = l.folder_id as string | null;
        return {
          name: l.name as string,
          color: (l.color as string | null) ?? null,
          folderIndex:
            folderId !== null ? (folderIndexById.get(folderId) ?? -1) : -1,
        };
      });
      const payload: SpacePayload = {
        space: {
          name: spaceRow.rows[0].name as string,
          color: spaceRow.rows[0].color as string,
          icon: (spaceRow.rows[0].icon as string | null) ?? null,
        },
        statuses,
        folders,
        lists,
      };
      return this.insertTemplate(
        client,
        workspaceId,
        userId,
        "space",
        name,
        description,
        icon,
        payload,
      );
    });
  }

  // --- Apply ----------------------------------------------------------------

  async apply(
    workspaceId: string,
    userId: string,
    role: Role,
    templateId: string,
    body: { targetListId?: string; targetSpaceId?: string; name?: string },
  ): Promise<{ createdId: string; kind: TemplateKind }> {
    this.requireMember(role);
    const nameOverride =
      body?.name !== undefined ? requireName(body.name) : undefined;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT kind, payload FROM templates WHERE id = $1`,
        [templateId],
      );
      if (!res.rows[0]) throw new NotFoundException("Template not found");
      const kind = res.rows[0].kind as TemplateKind;
      const payload = res.rows[0].payload as Record<string, unknown>;

      let createdId: string;
      if (kind === "task") {
        const targetListId = this.requireTarget(
          body?.targetListId,
          "targetListId",
        );
        const spaceId = await this.listSpace(client, targetListId);
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
        await this.statuses.ensureDefaults(client, workspaceId, spaceId);
        const first = await this.statuses.firstStatus(client, spaceId);
        createdId = await this.instantiateTask(
          client,
          workspaceId,
          userId,
          targetListId,
          spaceId,
          first?.id ?? null,
          payload as unknown as TaskPayload,
          nameOverride,
        );
      } else if (kind === "list") {
        const targetSpaceId = this.requireTarget(
          body?.targetSpaceId,
          "targetSpaceId",
        );
        await requireSpaceEdit(this.access, client, userId, role, targetSpaceId);
        createdId = await this.instantiateList(
          client,
          workspaceId,
          userId,
          targetSpaceId,
          payload as unknown as ListPayload,
          nameOverride,
        );
      } else if (kind === "doc") {
        let targetSpaceId: string | null = null;
        if (body?.targetSpaceId) {
          targetSpaceId = requireUuid(body.targetSpaceId, "targetSpaceId");
          await requireSpaceEdit(
            this.access,
            client,
            userId,
            role,
            targetSpaceId,
          );
        }
        createdId = await this.instantiateDoc(
          client,
          workspaceId,
          userId,
          targetSpaceId,
          payload as unknown as DocPayload,
          nameOverride,
        );
      } else {
        // space template -> a brand-new Space (any member+ may create one).
        createdId = await this.instantiateSpace(
          client,
          workspaceId,
          userId,
          payload as unknown as SpacePayload,
          nameOverride,
        );
      }

      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "template.applied",
        entity: "template",
        entityId: templateId,
        data: { kind, createdId },
      });
      return { createdId, kind };
    });
  }

  private requireTarget(v: unknown, label: string): string {
    if (v === undefined || v === null || v === "") {
      throw new BadRequestException(`${label} is required for this template`);
    }
    return requireUuid(v, label);
  }

  private async listSpace(
    client: PoolClient,
    listId: string,
  ): Promise<string> {
    const res = await client.query(
      `SELECT space_id FROM lists WHERE id = $1`,
      [listId],
    );
    if (!res.rows[0]) throw new NotFoundException("List not found");
    return res.rows[0].space_id as string;
  }

  // --- Serialization helpers ------------------------------------------------

  private async serializeTask(
    client: PoolClient,
    taskId: string,
  ): Promise<TaskPayload> {
    const t = await client.query(
      `SELECT name, description, priority, time_estimate_minutes, sprint_points
         FROM tasks WHERE id = $1`,
      [taskId],
    );
    const row = t.rows[0];
    const checklistRows = await client.query(
      `SELECT id, name FROM checklists WHERE task_id = $1 ORDER BY position, created_at`,
      [taskId],
    );
    const checklists: TaskPayload["checklists"] = [];
    for (const c of checklistRows.rows) {
      const items = await client.query(
        `SELECT name, resolved FROM checklist_items
          WHERE checklist_id = $1 ORDER BY position, created_at`,
        [c.id as string],
      );
      checklists.push({
        name: c.name as string,
        items: items.rows.map((it) => ({
          name: it.name as string,
          resolved: it.resolved as boolean,
        })),
      });
    }
    const subRows = await client.query(
      `SELECT name FROM tasks
        WHERE parent_task_id = $1 AND archived = false
        ORDER BY position, created_at`,
      [taskId],
    );
    const tagRows = await client.query(
      `SELECT tg.name FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.task_id = $1 ORDER BY tg.name`,
      [taskId],
    );
    return {
      name: row.name as string,
      description: (row.description as string) ?? "",
      priority: (row.priority as string | null) ?? null,
      timeEstimateMinutes: (row.time_estimate_minutes as number | null) ?? null,
      sprintPoints: (row.sprint_points as number | null) ?? null,
      checklists,
      subtasks: subRows.rows.map((r) => ({ name: r.name as string })),
      tags: tagRows.rows.map((r) => r.name as string),
    };
  }

  private async serializeStatuses(
    client: PoolClient,
    spaceId: string,
  ): Promise<StatusPayload[]> {
    const res = await client.query(
      `SELECT name, color, type, position FROM statuses
        WHERE space_id = $1 ORDER BY position, created_at`,
      [spaceId],
    );
    return res.rows.map((r) => ({
      name: r.name as string,
      color: r.color as string,
      type: r.type as string,
      position: r.position as number,
    }));
  }

  /** Flatten a page tree into a parent-before-child list with parentIndex refs. */
  private serializePageTree(
    rows: Record<string, unknown>[],
  ): DocPayload["pages"] {
    const byParent = new Map<string | null, Record<string, unknown>[]>();
    for (const r of rows) {
      const key = (r.parent_page_id as string | null) ?? null;
      const arr = byParent.get(key) ?? [];
      arr.push(r);
      byParent.set(key, arr);
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.position as number) - (b.position as number));
    }
    const out: DocPayload["pages"] = [];
    const walk = (parentId: string | null, parentIndex: number): void => {
      for (const r of byParent.get(parentId) ?? []) {
        out.push({
          title: r.title as string,
          content: (r.content as string) ?? "",
          parentIndex,
          position: r.position as number,
        });
        walk(r.id as string, out.length - 1);
      }
    };
    walk(null, -1);
    return out;
  }

  private async assertDocVisible(
    client: PoolClient,
    userId: string,
    role: Role,
    doc: Record<string, unknown>,
  ): Promise<void> {
    const spaceId = doc.space_id as string | null;
    if (spaceId !== null) {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      return;
    }
    if (doc.is_private as boolean) {
      if ((doc.created_by as string | null) !== userId) {
        throw new NotFoundException("Doc not found");
      }
      return;
    }
    // Public unattached doc: any non-guest (guests already refused above).
  }

  // --- Instantiation helpers ------------------------------------------------

  private async insertTemplate(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    kind: TemplateKind,
    name: string,
    description: string,
    icon: string,
    payload: unknown,
  ): Promise<TemplateDto> {
    const res = await client.query(
      `INSERT INTO templates
         (workspace_id, kind, name, description, icon, payload, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, kind, name, description, icon, created_at`,
      [
        workspaceId,
        kind,
        name,
        description,
        icon,
        JSON.stringify(payload),
        userId,
      ],
    );
    await this.audit.record(client, {
      workspaceId,
      actorUserId: userId,
      action: "template.created",
      entity: "template",
      entityId: res.rows[0].id as string,
      data: { kind, name },
    });
    return this.toDto(res.rows[0]);
  }

  private async nextTaskPosition(
    client: PoolClient,
    listId: string,
    statusId: string | null,
  ): Promise<number> {
    const res = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks
        WHERE list_id = $1 AND status_id IS NOT DISTINCT FROM $2`,
      [listId, statusId],
    );
    return res.rows[0].n as number;
  }

  private async findOrCreateTag(
    client: PoolClient,
    workspaceId: string,
    spaceId: string,
    name: string,
  ): Promise<string> {
    const existing = await client.query(
      `SELECT id FROM tags WHERE space_id = $1 AND name = $2`,
      [spaceId, name],
    );
    if (existing.rows[0]) return existing.rows[0].id as string;
    const ins = await client.query(
      `INSERT INTO tags (workspace_id, space_id, name, color)
       VALUES ($1, $2, $3, '#7B68EE') RETURNING id`,
      [workspaceId, spaceId, name],
    );
    return ins.rows[0].id as string;
  }

  /** Create one task (+ its checklists, subtasks and tags) from a payload. */
  private async instantiateTask(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    listId: string,
    spaceId: string,
    statusId: string | null,
    payload: TaskPayload,
    nameOverride?: string,
  ): Promise<string> {
    const pos = await this.nextTaskPosition(client, listId, statusId);
    const ins = await client.query(
      `INSERT INTO tasks
         (workspace_id, list_id, space_id, name, description, status_id,
          priority, time_estimate_minutes, sprint_points, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        workspaceId,
        listId,
        spaceId,
        nameOverride ?? payload.name,
        payload.description ?? "",
        statusId,
        payload.priority ?? null,
        payload.timeEstimateMinutes ?? null,
        payload.sprintPoints ?? null,
        pos,
        userId,
      ],
    );
    const taskId = ins.rows[0].id as string;

    for (const [ci, cl] of (payload.checklists ?? []).entries()) {
      const clIns = await client.query(
        `INSERT INTO checklists (workspace_id, task_id, name, position)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [workspaceId, taskId, cl.name ?? "Checklist", ci],
      );
      const checklistId = clIns.rows[0].id as string;
      for (const [ii, item] of (cl.items ?? []).entries()) {
        await client.query(
          `INSERT INTO checklist_items
             (workspace_id, checklist_id, name, resolved, position)
           VALUES ($1, $2, $3, $4, $5)`,
          [workspaceId, checklistId, item.name, item.resolved === true, ii],
        );
      }
    }

    for (const [si, sub] of (payload.subtasks ?? []).entries()) {
      await client.query(
        `INSERT INTO tasks
           (workspace_id, list_id, space_id, parent_task_id, name,
            status_id, position, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [workspaceId, listId, spaceId, taskId, sub.name, statusId, si, userId],
      );
    }

    for (const tagName of payload.tags ?? []) {
      const tagId = await this.findOrCreateTag(
        client,
        workspaceId,
        spaceId,
        tagName,
      );
      await client.query(
        `INSERT INTO task_tags (workspace_id, task_id, tag_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [workspaceId, taskId, tagId],
      );
    }
    return taskId;
  }

  private async instantiateList(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    spaceId: string,
    payload: ListPayload,
    nameOverride?: string,
  ): Promise<string> {
    // Re-create the template's statuses in the target space (append), so the
    // list's tasks can slot into a fresh not-started status.
    const createdStatusIds = await this.recreateStatuses(
      client,
      workspaceId,
      spaceId,
      payload.statuses ?? [],
    );
    const firstStatusId =
      createdStatusIds[0] ??
      (await this.statuses.firstStatus(client, spaceId))?.id ??
      null;

    const orderRes = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM lists
        WHERE space_id = $1 AND folder_id IS NULL`,
      [spaceId],
    );
    const listIns = await client.query(
      `INSERT INTO lists (workspace_id, space_id, name, color, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        workspaceId,
        spaceId,
        nameOverride ?? payload.list.name,
        payload.list.color ?? null,
        orderRes.rows[0].n as number,
        userId,
      ],
    );
    const listId = listIns.rows[0].id as string;

    for (const taskPayload of payload.tasks ?? []) {
      await this.instantiateTask(
        client,
        workspaceId,
        userId,
        listId,
        spaceId,
        firstStatusId,
        taskPayload,
      );
    }
    return listId;
  }

  /** Insert statuses (appended by position) into a space; return the new ids. */
  private async recreateStatuses(
    client: PoolClient,
    workspaceId: string,
    spaceId: string,
    statuses: StatusPayload[],
  ): Promise<string[]> {
    if (statuses.length === 0) return [];
    const baseRes = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM statuses WHERE space_id = $1`,
      [spaceId],
    );
    let pos = baseRes.rows[0].n as number;
    const ids: string[] = [];
    const ordered = [...statuses].sort((a, b) => a.position - b.position);
    for (const st of ordered) {
      const ins = await client.query(
        `INSERT INTO statuses (workspace_id, space_id, name, color, type, position)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [workspaceId, spaceId, st.name, st.color, st.type, pos++],
      );
      ids.push(ins.rows[0].id as string);
    }
    return ids;
  }

  private async instantiateDoc(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    spaceId: string | null,
    payload: DocPayload,
    nameOverride?: string,
  ): Promise<string> {
    const ins = await client.query(
      `INSERT INTO docs (workspace_id, space_id, name, icon, is_private, created_by)
       VALUES ($1, $2, $3, $4, false, $5) RETURNING id`,
      [
        workspaceId,
        spaceId,
        nameOverride ?? payload.doc.name,
        payload.doc.icon ?? "📄",
        userId,
      ],
    );
    const docId = ins.rows[0].id as string;

    const pages = payload.pages ?? [];
    if (pages.length === 0) {
      // Every doc keeps at least one page.
      await client.query(
        `INSERT INTO doc_pages (workspace_id, doc_id, title, position, updated_by)
         VALUES ($1, $2, $3, 0, $4)`,
        [workspaceId, docId, nameOverride ?? payload.doc.name, userId],
      );
      return docId;
    }
    const createdIds: string[] = [];
    for (const page of pages) {
      const parentId =
        page.parentIndex >= 0 && page.parentIndex < createdIds.length
          ? createdIds[page.parentIndex]
          : null;
      const pIns = await client.query(
        `INSERT INTO doc_pages
           (workspace_id, doc_id, parent_page_id, title, content, position, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          workspaceId,
          docId,
          parentId,
          page.title ?? "Untitled",
          page.content ?? "",
          page.position ?? 0,
          userId,
        ],
      );
      createdIds.push(pIns.rows[0].id as string);
    }
    return docId;
  }

  private async instantiateSpace(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    payload: SpacePayload,
    nameOverride?: string,
  ): Promise<string> {
    const orderRes = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM spaces`,
    );
    const ins = await client.query(
      `INSERT INTO spaces
         (workspace_id, name, color, icon, is_private, sort_order, created_by)
       VALUES ($1, $2, $3, $4, false, $5, $6) RETURNING id`,
      [
        workspaceId,
        nameOverride ?? payload.space.name,
        payload.space.color ?? "#7B68EE",
        payload.space.icon ?? null,
        orderRes.rows[0].n as number,
        userId,
      ],
    );
    const spaceId = ins.rows[0].id as string;

    await this.recreateStatuses(
      client,
      workspaceId,
      spaceId,
      payload.statuses ?? [],
    );

    const folderIds: string[] = [];
    for (const [fi, folder] of (payload.folders ?? []).entries()) {
      const fIns = await client.query(
        `INSERT INTO folders (workspace_id, space_id, name, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [workspaceId, spaceId, folder.name, fi, userId],
      );
      folderIds.push(fIns.rows[0].id as string);
    }

    for (const [li, list] of (payload.lists ?? []).entries()) {
      const folderId =
        list.folderIndex >= 0 && list.folderIndex < folderIds.length
          ? folderIds[list.folderIndex]
          : null;
      await client.query(
        `INSERT INTO lists
           (workspace_id, space_id, folder_id, name, color, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [workspaceId, spaceId, folderId, list.name, list.color ?? null, li, userId],
      );
    }
    return spaceId;
  }
}
