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

export interface WhiteboardSummary {
  id: string;
  name: string;
  spaceId: string | null;
  spaceName: string | null;
  updatedAt: string;
  updatedBy: string | null;
  elementCount: number;
}

export interface WhiteboardOut {
  id: string;
  name: string;
  spaceId: string | null;
  elements: unknown[];
  updatedAt: string;
}

const WB_SELECT = `
  SELECT w.id, w.name, w.space_id, w.elements, w.created_by, w.updated_by,
         w.updated_at, s.name AS space_name,
         jsonb_array_length(w.elements)::int AS element_count
  FROM whiteboards w LEFT JOIN spaces s ON s.id = w.space_id`;

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
    };
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
        }));
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { name?: string; spaceId?: string },
  ): Promise<WhiteboardOut> {
    this.noGuests(role);
    const name = requireName(body?.name);
    const spaceId =
      body?.spaceId === undefined || body?.spaceId === null
        ? null
        : requireUuid(body.spaceId, "spaceId");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      if (spaceId !== null) {
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
      }
      const ins = await client.query(
        `INSERT INTO whiteboards
           (workspace_id, space_id, name, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [workspaceId, spaceId, name, userId],
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
    body: { name?: string; elements?: unknown; spaceId?: string | null },
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
