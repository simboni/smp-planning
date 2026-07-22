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
import {
  optionalName,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  requireUuid,
} from "../tasks/tasks.support";
import { MAX_ELEMENTS_BYTES, iso, serializeCapped } from "./visual.support";

/** Optional cross-references a board can point at (M31). */
export interface WhiteboardLinks {
  folderId: string | null;
  folderName: string | null;
  listId: string | null;
  listName: string | null;
  taskId: string | null;
  taskName: string | null;
}

export interface WhiteboardSummary extends WhiteboardLinks {
  id: string;
  name: string;
  spaceId: string | null;
  spaceName: string | null;
  updatedAt: string;
  updatedBy: string | null;
  elementCount: number;
}

export interface WhiteboardOut extends WhiteboardLinks {
  id: string;
  name: string;
  spaceId: string | null;
  elements: unknown[];
  updatedAt: string;
}

const WB_SELECT = `
  SELECT w.id, w.name, w.space_id, w.elements, w.created_by, w.updated_by,
         w.updated_at, w.folder_id, w.list_id, w.task_id,
         s.name AS space_name, f.name AS folder_name,
         l.name AS list_name, t.name AS task_name,
         jsonb_array_length(w.elements)::int AS element_count
  FROM whiteboards w
    LEFT JOIN spaces s  ON s.id = w.space_id
    LEFT JOIN folders f ON f.id = w.folder_id
    LEFT JOIN lists l   ON l.id = w.list_id
    LEFT JOIN tasks t   ON t.id = w.task_id`;

/** Pull the link fields out of a WB_SELECT row. */
function linksOf(r: Record<string, unknown>): WhiteboardLinks {
  return {
    folderId: (r.folder_id as string | null) ?? null,
    folderName: (r.folder_name as string | null) ?? null,
    listId: (r.list_id as string | null) ?? null,
    listName: (r.list_name as string | null) ?? null,
    taskId: (r.task_id as string | null) ?? null,
    taskName: (r.task_name as string | null) ?? null,
  };
}

/**
 * Module 12: Whiteboards — one jsonb `elements` document per board,
 * workspace-wide like docs. Visibility: space-attached boards follow the
 * space (visible to read, edit to write); unattached boards belong to all
 * members. GUESTS ARE EXCLUDED entirely (403) — they never see whiteboards.
 * Deleting takes the creator or a workspace admin/owner.
 */
@Injectable()
export class WhiteboardsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private noGuests(role: Role): void {
    if (role === "guest") {
      throw new ForbiddenException("Guests cannot access whiteboards");
    }
  }

  private toOut(r: Record<string, unknown>): WhiteboardOut {
    return {
      id: r.id as string,
      name: r.name as string,
      spaceId: (r.space_id as string | null) ?? null,
      elements: (r.elements as unknown[]) ?? [],
      updatedAt: iso(r.updated_at)!,
      ...linksOf(r),
    };
  }

  /**
   * Resolve an optional link id: undefined/null clears it; a value must be a
   * uuid that exists in THIS workspace (the SELECT is RLS-scoped) AND whose
   * space the caller can actually see — otherwise a member could link a board
   * to (and read the name of) an entity in a private space they have no access
   * to. Every linkable table carries a denormalized space_id we visibility-check
   * via AccessService.
   */
  private async resolveLink(
    client: PoolClient,
    table: "folders" | "lists" | "tasks",
    value: string | null | undefined,
    label: string,
    userId: string,
    role: Role,
  ): Promise<string | null | undefined> {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const id = requireUuid(value, label);
    const res = await client.query(
      `SELECT space_id FROM ${table} WHERE id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new BadRequestException(`${label} not found`);
    const spaceId = res.rows[0].space_id as string | null;
    if (spaceId) {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
    }
    return id;
  }

  /** Load a board and enforce read visibility (attached -> space visible). */
  private async requireBoard(
    client: PoolClient,
    userId: string,
    role: Role,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(`${WB_SELECT} WHERE w.id = $1`, [id]);
    if (!res.rows[0]) throw new NotFoundException("Whiteboard not found");
    const spaceId = res.rows[0].space_id as string | null;
    if (spaceId !== null) {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
    }
    return res.rows[0];
  }

  private validElements(v: unknown): string {
    if (!Array.isArray(v)) {
      throw new BadRequestException("elements must be an array");
    }
    return serializeCapped(v, MAX_ELEMENTS_BYTES, "elements");
  }

  async list(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<WhiteboardSummary[]> {
    this.noGuests(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = await this.access.visibleSpaceIds(client, userId, role);
      const res = await client.query(
        `${WB_SELECT} ORDER BY w.updated_at DESC, w.id`,
      );
      return res.rows
        .filter((r) => {
          const spaceId = r.space_id as string | null;
          return spaceId === null || visible.has(spaceId);
        })
        .map((r) => ({
          id: r.id as string,
          name: r.name as string,
          spaceId: (r.space_id as string | null) ?? null,
          spaceName: (r.space_name as string | null) ?? null,
          updatedAt: iso(r.updated_at)!,
          updatedBy: (r.updated_by as string | null) ?? null,
          elementCount: r.element_count as number,
          ...linksOf(r),
        }));
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    body: {
      name?: string;
      spaceId?: string;
      elements?: unknown;
      folderId?: string | null;
      listId?: string | null;
      taskId?: string | null;
    },
  ): Promise<WhiteboardOut> {
    this.noGuests(role);
    const name = requireName(body?.name);
    const spaceId =
      body?.spaceId === undefined || body?.spaceId === null
        ? null
        : requireUuid(body.spaceId, "spaceId");
    // Optional starter content (templates seed a board on creation).
    const elementsJson =
      body?.elements !== undefined ? this.validElements(body.elements) : undefined;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      if (spaceId !== null) {
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
      }
      const folderId = await this.resolveLink(client, "folders", body?.folderId, "folderId", userId, role);
      const listId = await this.resolveLink(client, "lists", body?.listId, "listId", userId, role);
      const taskId = await this.resolveLink(client, "tasks", body?.taskId, "taskId", userId, role);
      const ins = await client.query(
        `INSERT INTO whiteboards
           (workspace_id, space_id, name, elements, folder_id, list_id, task_id,
            created_by, updated_by)
         VALUES ($1, $2, $3, COALESCE($4::jsonb, '[]'::jsonb), $5, $6, $7, $8, $8)
         RETURNING id`,
        [workspaceId, spaceId, name, elementsJson ?? null,
         folderId ?? null, listId ?? null, taskId ?? null, userId],
      );
      const id = ins.rows[0].id as string;
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "whiteboard.created",
        entity: "whiteboard",
        entityId: id,
        data: { name, spaceId },
      });
      return this.toOut(await this.requireBoard(client, userId, role, id));
    });
  }

  async get(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<WhiteboardOut> {
    this.noGuests(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      return this.toOut(await this.requireBoard(client, userId, role, id));
    });
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: {
      name?: string;
      elements?: unknown;
      spaceId?: string | null;
      folderId?: string | null;
      listId?: string | null;
      taskId?: string | null;
    },
  ): Promise<WhiteboardOut> {
    this.noGuests(role);
    const name = optionalName(body?.name);
    const elementsJson =
      body?.elements !== undefined ? this.validElements(body.elements) : undefined;

    const board = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const existing = await this.requireBoard(client, userId, role, id);
        // Writing an attached board needs EDIT on its space; unattached
        // boards are editable by every member (guests never get here).
        const currentSpace = existing.space_id as string | null;
        if (currentSpace !== null) {
          await requireSpaceEdit(this.access, client, userId, role, currentSpace);
        }

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (name !== undefined) {
          sets.push(`name = $${i++}`);
          params.push(name);
        }
        if (elementsJson !== undefined) {
          sets.push(`elements = $${i++}`);
          params.push(elementsJson);
        }
        if (body?.spaceId !== undefined) {
          const spaceId =
            body.spaceId === null ? null : requireUuid(body.spaceId, "spaceId");
          // Attaching (or moving) needs edit on the TARGET space too.
          if (spaceId !== null) {
            await requireSpaceEdit(this.access, client, userId, role, spaceId);
          }
          sets.push(`space_id = $${i++}`);
          params.push(spaceId);
        }
        // Optional cross-reference links (folder / list / task).
        const folderId = await this.resolveLink(client, "folders", body?.folderId, "folderId", userId, role);
        if (folderId !== undefined) {
          sets.push(`folder_id = $${i++}`);
          params.push(folderId);
        }
        const listId = await this.resolveLink(client, "lists", body?.listId, "listId", userId, role);
        if (listId !== undefined) {
          sets.push(`list_id = $${i++}`);
          params.push(listId);
        }
        const taskId = await this.resolveLink(client, "tasks", body?.taskId, "taskId", userId, role);
        if (taskId !== undefined) {
          sets.push(`task_id = $${i++}`);
          params.push(taskId);
        }
        if (sets.length > 0) {
          sets.push(`updated_by = $${i++}`, `updated_at = now()`);
          params.push(userId, id);
          await client.query(
            `UPDATE whiteboards SET ${sets.join(", ")} WHERE id = $${i}`,
            params,
          );
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "whiteboard.updated",
          entity: "whiteboard",
          entityId: id,
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(elementsJson !== undefined ? { elementsChanged: true } : {}),
            ...(body?.spaceId !== undefined ? { spaceId: body.spaceId } : {}),
          },
        });
        return this.toOut(await this.requireBoard(client, userId, role, id));
      },
    );

    this.events.publish(workspaceId, {
      type: "board.changed",
      payload: { whiteboardId: id },
    });
    return board;
  }

  /** Delete: creator or workspace admin/owner. */
  async remove(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    this.noGuests(role);
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.requireBoard(client, userId, role, id);
      const isAdmin = role === "owner" || role === "admin";
      if ((existing.created_by as string | null) !== userId && !isAdmin) {
        throw new ForbiddenException(
          "Only the whiteboard's creator or a workspace admin can delete it",
        );
      }
      await client.query(`DELETE FROM whiteboards WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "whiteboard.deleted",
        entity: "whiteboard",
        entityId: id,
        data: { name: existing.name as string },
      });
    });
  }
}
