import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService, permAtLeast } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { requireName, requireSpaceVisible } from "../tasks/tasks.support";

/** A saved view: a named lens (kind + config) on a List's tasks. */
export interface View {
  id: string;
  listId: string;
  name: string;
  kind: ViewKind;
  config: Record<string, unknown>;
  isShared: boolean;
  position: number;
  createdBy: string | null;
}

export const VIEW_KINDS = ["list", "board", "calendar", "table", "gantt"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

/** Max serialized size of a view's config payload (8 KB). */
const MAX_CONFIG_BYTES = 8 * 1024;

const VIEW_COLUMNS =
  "id, list_id, name, kind, config, is_shared, position, created_by";

/**
 * Module 5: saved views on Lists. Visibility follows the owning Space
 * (invisible space -> 404, mirroring Tasks). SHARED views are workspace
 * artifacts: creating/updating/deleting them requires >= edit on the space.
 * PERSONAL views (is_shared=false) only affect their creator, so anyone who
 * can SEE the list may manage their own — but never someone else's (403).
 * Personal views are returned only to their creator.
 */
@Injectable()
export class ViewsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  // --- helpers --------------------------------------------------------------

  private async listSpace(client: PoolClient, listId: string): Promise<string> {
    const res = await client.query(`SELECT space_id FROM lists WHERE id = $1`, [
      listId,
    ]);
    if (!res.rows[0]) throw new NotFoundException("List not found");
    return res.rows[0].space_id as string;
  }

  private toView(r: Record<string, unknown>): View {
    return {
      id: r.id as string,
      listId: r.list_id as string,
      name: r.name as string,
      kind: r.kind as ViewKind,
      config: (r.config as Record<string, unknown>) ?? {},
      isShared: r.is_shared as boolean,
      position: r.position as number,
      createdBy: (r.created_by as string | null) ?? null,
    };
  }

  private validKind(kind: unknown): ViewKind {
    if (!VIEW_KINDS.includes(kind as ViewKind)) {
      throw new BadRequestException(
        "kind must be one of list, board, calendar, table, gantt",
      );
    }
    return kind as ViewKind;
  }

  /** Any plain object whose serialized form fits in 8KB; client owns semantics. */
  private validConfig(config: unknown): Record<string, unknown> {
    if (config === undefined || config === null) return {};
    if (typeof config !== "object" || Array.isArray(config)) {
      throw new BadRequestException("config must be an object");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(config);
    } catch {
      throw new BadRequestException("config must be JSON-serializable");
    }
    if (serialized === undefined || Buffer.byteLength(serialized) > MAX_CONFIG_BYTES) {
      throw new BadRequestException("config must serialize to at most 8KB");
    }
    return config as Record<string, unknown>;
  }

  // --- endpoints ------------------------------------------------------------

  /** Shared views + the caller's own personal views, in position order. */
  async listViews(
    workspaceId: string,
    userId: string,
    role: Role,
    listId: string,
  ): Promise<View[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.listSpace(client, listId);
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT ${VIEW_COLUMNS}
         FROM views
         WHERE list_id = $1 AND (is_shared = true OR created_by = $2)
         ORDER BY position, created_at`,
        [listId, userId],
      );
      return res.rows.map((r) => this.toView(r));
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    listId: string,
    body: {
      name?: string;
      kind?: string;
      config?: unknown;
      isShared?: boolean;
    },
  ): Promise<View> {
    const name = requireName(body?.name);
    const kind = this.validKind(body?.kind);
    const config = this.validConfig(body?.config);
    const isShared = body?.isShared !== false; // defaults to shared

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.listSpace(client, listId);
      const perm = await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        spaceId,
      );
      // A shared view is a workspace artifact -> needs edit; a personal view
      // only affects its creator, so seeing the list is enough.
      if (isShared && !permAtLeast(perm, "edit")) {
        throw new ForbiddenException(
          "You need edit access on this space to create a shared view",
        );
      }
      const posRes = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM views WHERE list_id = $1`,
        [listId],
      );
      const res = await client.query(
        `INSERT INTO views
           (workspace_id, list_id, name, kind, config, is_shared, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${VIEW_COLUMNS}`,
        [
          workspaceId,
          listId,
          name,
          kind,
          JSON.stringify(config),
          isShared,
          posRes.rows[0].n as number,
          userId,
        ],
      );
      const view = this.toView(res.rows[0]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "view.created",
        entity: "view",
        entityId: view.id,
        data: { name: view.name, kind: view.kind, listId, isShared },
      });
      return view;
    });
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: {
      name?: string;
      config?: unknown;
      isShared?: boolean;
      position?: number;
    },
  ): Promise<View> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const current = await this.requireEditable(client, userId, role, id, body);

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (body?.name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(requireName(body.name));
      }
      if (body?.config !== undefined) {
        sets.push(`config = $${i++}`);
        params.push(JSON.stringify(this.validConfig(body.config)));
      }
      if (body?.isShared !== undefined) {
        sets.push(`is_shared = $${i++}`);
        params.push(body.isShared === true);
      }
      if (body?.position !== undefined) {
        if (!Number.isInteger(body.position) || body.position < 0) {
          throw new BadRequestException("position must be an integer >= 0");
        }
        sets.push(`position = $${i++}`);
        params.push(body.position);
      }

      let view: View;
      if (sets.length === 0) {
        view = current;
      } else {
        sets.push("updated_at = now()");
        params.push(id);
        const res = await client.query(
          `UPDATE views SET ${sets.join(", ")}
           WHERE id = $${i}
           RETURNING ${VIEW_COLUMNS}`,
          params,
        );
        view = this.toView(res.rows[0]);
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "view.updated",
        entity: "view",
        entityId: view.id,
        data: {
          ...(body?.name !== undefined ? { name: view.name } : {}),
          ...(body?.isShared !== undefined ? { isShared: view.isShared } : {}),
          ...(body?.position !== undefined ? { position: view.position } : {}),
          ...(body?.config !== undefined ? { config: true } : {}),
        },
      });
      return view;
    });
  }

  async remove(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireEditable(client, userId, role, id, {});
      await client.query(`DELETE FROM views WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "view.deleted",
        entity: "view",
        entityId: id,
      });
    });
  }

  /**
   * Load a view and enforce the write rules shared by PATCH/DELETE:
   *  - owning space not visible -> 404 (never leak);
   *  - shared view, or flipping isShared -> true -> requires >= edit (403);
   *  - personal view -> only its creator may touch it (403 for anyone else).
   */
  private async requireEditable(
    client: PoolClient,
    userId: string,
    role: Role,
    id: string,
    body: { isShared?: boolean },
  ): Promise<View> {
    const res = await client.query(
      `SELECT v.id, v.list_id, v.name, v.kind, v.config, v.is_shared,
              v.position, v.created_by, l.space_id
       FROM views v JOIN lists l ON l.id = v.list_id
       WHERE v.id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException("View not found");
    const view = this.toView(res.rows[0]);
    const perm = await requireSpaceVisible(
      this.access,
      client,
      userId,
      role,
      res.rows[0].space_id as string,
    );
    if (view.isShared || body?.isShared === true) {
      if (!permAtLeast(perm, "edit")) {
        throw new ForbiddenException(
          "You need edit access on this space to modify a shared view",
        );
      }
    }
    if (!view.isShared && view.createdBy !== userId) {
      throw new ForbiddenException(
        "Only its creator can modify a personal view",
      );
    }
    return view;
  }
}
