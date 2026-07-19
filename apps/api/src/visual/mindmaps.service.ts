import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
import { MAX_ROOT_BYTES, iso, serializeCapped } from "./visual.support";

export interface MindmapSummary {
  id: string;
  name: string;
  spaceId: string | null;
  spaceName: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface MindmapOut {
  id: string;
  name: string;
  spaceId: string | null;
  root: Record<string, unknown>;
  updatedAt: string;
}

const MM_SELECT = `
  SELECT m.id, m.name, m.space_id, m.root, m.created_by, m.updated_by,
         m.updated_at, s.name AS space_name
  FROM mindmaps m LEFT JOIN spaces s ON s.id = m.space_id`;

/**
 * Module 12: Mind maps — a node tree in one jsonb `root` document,
 * workspace-wide with the same access model as whiteboards: space-attached
 * maps follow the space, unattached ones belong to all members, and guests
 * are excluded entirely (403). Deletes take creator or admin/owner.
 */
@Injectable()
export class MindmapsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private noGuests(role: Role): void {
    if (role === "guest") {
      throw new ForbiddenException("Guests cannot access mind maps");
    }
  }

  private toOut(r: Record<string, unknown>): MindmapOut {
    return {
      id: r.id as string,
      name: r.name as string,
      spaceId: (r.space_id as string | null) ?? null,
      root: (r.root as Record<string, unknown>) ?? {},
      updatedAt: iso(r.updated_at)!,
    };
  }

  private async requireMap(
    client: PoolClient,
    userId: string,
    role: Role,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(`${MM_SELECT} WHERE m.id = $1`, [id]);
    if (!res.rows[0]) throw new NotFoundException("Mind map not found");
    const spaceId = res.rows[0].space_id as string | null;
    if (spaceId !== null) {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
    }
    return res.rows[0];
  }

  private validRoot(v: unknown): string {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new BadRequestException("root must be an object");
    }
    return serializeCapped(v, MAX_ROOT_BYTES, "root");
  }

  async list(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<MindmapSummary[]> {
    this.noGuests(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = await this.access.visibleSpaceIds(client, userId, role);
      const res = await client.query(
        `${MM_SELECT} ORDER BY m.updated_at DESC, m.id`,
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
        }));
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { name?: string; spaceId?: string },
  ): Promise<MindmapOut> {
    this.noGuests(role);
    const name = requireName(body?.name);
    const spaceId =
      body?.spaceId === undefined || body?.spaceId === null
        ? null
        : requireUuid(body.spaceId, "spaceId");
    // Every map starts with a root node named like the map itself.
    const root = { id: randomUUID(), text: name, children: [] };
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      if (spaceId !== null) {
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
      }
      const ins = await client.query(
        `INSERT INTO mindmaps
           (workspace_id, space_id, name, root, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [workspaceId, spaceId, name, JSON.stringify(root), userId],
      );
      const id = ins.rows[0].id as string;
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "mindmap.created",
        entity: "mindmap",
        entityId: id,
        data: { name, spaceId },
      });
      return this.toOut(await this.requireMap(client, userId, role, id));
    });
  }

  async get(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<MindmapOut> {
    this.noGuests(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      return this.toOut(await this.requireMap(client, userId, role, id));
    });
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; root?: unknown; spaceId?: string | null },
  ): Promise<MindmapOut> {
    this.noGuests(role);
    const name = optionalName(body?.name);
    const rootJson =
      body?.root !== undefined ? this.validRoot(body.root) : undefined;

    const map = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const existing = await this.requireMap(client, userId, role, id);
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
        if (rootJson !== undefined) {
          sets.push(`root = $${i++}`);
          params.push(rootJson);
        }
        if (body?.spaceId !== undefined) {
          const spaceId =
            body.spaceId === null ? null : requireUuid(body.spaceId, "spaceId");
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
            `UPDATE mindmaps SET ${sets.join(", ")} WHERE id = $${i}`,
            params,
          );
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "mindmap.updated",
          entity: "mindmap",
          entityId: id,
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(rootJson !== undefined ? { rootChanged: true } : {}),
            ...(body?.spaceId !== undefined ? { spaceId: body.spaceId } : {}),
          },
        });
        return this.toOut(await this.requireMap(client, userId, role, id));
      },
    );

    this.events.publish(workspaceId, {
      type: "mindmap.changed",
      payload: { mindmapId: id },
    });
    return map;
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
      const existing = await this.requireMap(client, userId, role, id);
      const isAdmin = role === "owner" || role === "admin";
      if ((existing.created_by as string | null) !== userId && !isAdmin) {
        throw new ForbiddenException(
          "Only the mind map's creator or a workspace admin can delete it",
        );
      }
      await client.query(`DELETE FROM mindmaps WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "mindmap.deleted",
        entity: "mindmap",
        entityId: id,
        data: { name: existing.name as string },
      });
    });
  }
}
