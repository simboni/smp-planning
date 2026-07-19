import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { DbService } from "../db/db.service";
import { requireSpaceEdit, requireSpaceVisible } from "../tasks/tasks.support";

/** Known ClickApp toggle keys (see 0015 migration's column default). */
const CLICKAPP_KEYS = [
  "timeTracking",
  "sprints",
  "customFields",
  "priorities",
  "tags",
  "dependencies",
  "milestones",
  "points",
] as const;
const CLICKAPP_KEY_SET = new Set<string>(CLICKAPP_KEYS);

/** Favorite entity types (mirrors the favorites table CHECK constraint). */
const FAVORITE_TYPES = ["space", "list", "doc", "whiteboard", "dashboard"] as const;
type FavoriteType = (typeof FAVORITE_TYPES)[number];

export interface FavoriteOut {
  entityType: FavoriteType;
  entityId: string;
  name: string;
}

/**
 * Module 14: per-space ClickApps (feature toggles) and per-user Favorites.
 *
 * ClickApps are a jsonb boolean map on the space; reading needs the space
 * visible, writing needs edit. Enforcement of the toggles themselves is
 * UI-level / best-effort for M14 — this only stores and merges the map.
 *
 * Favorites are strictly scoped to the caller (user_id = token sub). Adding
 * one validates the target is currently visible; listing resolves display
 * names and silently drops anything the caller can no longer see.
 */
@Injectable()
export class WorkspaceExtrasService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  // --- ClickApps ------------------------------------------------------------

  async getClickApps(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<{ clickapps: Record<string, boolean> }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT clickapps FROM spaces WHERE id = $1`,
        [spaceId],
      );
      return {
        clickapps: (res.rows[0].clickapps as Record<string, boolean>) ?? {},
      };
    });
  }

  async setClickApps(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { clickapps?: Record<string, unknown> },
  ): Promise<{ clickapps: Record<string, boolean> }> {
    const incoming = body?.clickapps;
    if (
      incoming === undefined ||
      incoming === null ||
      typeof incoming !== "object" ||
      Array.isArray(incoming)
    ) {
      throw new BadRequestException("clickapps must be an object of booleans");
    }
    const patch: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (!CLICKAPP_KEY_SET.has(key)) {
        throw new BadRequestException(`Unknown ClickApp key: ${key}`);
      }
      if (typeof value !== "boolean") {
        throw new BadRequestException(`ClickApp '${key}' must be a boolean`);
      }
      patch[key] = value;
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const cur = await client.query(
        `SELECT clickapps FROM spaces WHERE id = $1`,
        [spaceId],
      );
      const merged = {
        ...((cur.rows[0].clickapps as Record<string, boolean>) ?? {}),
        ...patch,
      };
      await client.query(`UPDATE spaces SET clickapps = $1 WHERE id = $2`, [
        JSON.stringify(merged),
        spaceId,
      ]);
      return { clickapps: merged };
    });
  }

  // --- Favorites ------------------------------------------------------------

  private assertFavoriteType(t: unknown): FavoriteType {
    if (typeof t !== "string" || !FAVORITE_TYPES.includes(t as FavoriteType)) {
      throw new BadRequestException(
        "entityType must be one of space, list, doc, whiteboard, dashboard",
      );
    }
    return t as FavoriteType;
  }

  async listFavorites(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<FavoriteOut[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const rows = await client.query(
        `SELECT entity_type, entity_id FROM favorites
          WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      const visible = await this.access.visibleSpaceIds(client, userId, role);
      const out: FavoriteOut[] = [];
      for (const r of rows.rows) {
        const type = r.entity_type as FavoriteType;
        const id = r.entity_id as string;
        const name = await this.resolveName(client, userId, role, visible, type, id);
        if (name !== null) out.push({ entityType: type, entityId: id, name });
      }
      return out;
    });
  }

  async addFavorite(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { entityType?: string; entityId?: string },
  ): Promise<FavoriteOut> {
    const type = this.assertFavoriteType(body?.entityType);
    if (typeof body?.entityId !== "string" || !body.entityId) {
      throw new BadRequestException("entityId is required");
    }
    const entityId = body.entityId;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = await this.access.visibleSpaceIds(client, userId, role);
      const name = await this.resolveName(
        client,
        userId,
        role,
        visible,
        type,
        entityId,
      );
      if (name === null) throw new NotFoundException("Entity not found");
      await client.query(
        `INSERT INTO favorites (workspace_id, user_id, entity_type, entity_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [workspaceId, userId, type, entityId],
      );
      return { entityType: type, entityId, name };
    });
  }

  async removeFavorite(
    workspaceId: string,
    userId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    const type = this.assertFavoriteType(entityType);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await client.query(
        `DELETE FROM favorites
          WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3`,
        [userId, type, entityId],
      );
    });
  }

  /**
   * Resolve a favorite's display name if the caller can currently see it, else
   * null (used both to gate an add and to skip now-invisible list entries).
   */
  private async resolveName(
    client: PoolClient,
    userId: string,
    role: Role,
    visibleSpaceIds: Set<string>,
    type: FavoriteType,
    id: string,
  ): Promise<string | null> {
    if (type === "space") {
      const res = await client.query(
        `SELECT name FROM spaces WHERE id = $1`,
        [id],
      );
      if (!res.rows[0] || !visibleSpaceIds.has(id)) return null;
      return res.rows[0].name as string;
    }
    if (type === "list") {
      const res = await client.query(
        `SELECT name, space_id FROM lists WHERE id = $1`,
        [id],
      );
      if (!res.rows[0] || !visibleSpaceIds.has(res.rows[0].space_id as string)) {
        return null;
      }
      return res.rows[0].name as string;
    }
    if (type === "doc") {
      const res = await client.query(
        `SELECT name, space_id, is_private, created_by FROM docs WHERE id = $1`,
        [id],
      );
      const row = res.rows[0];
      if (!row) return null;
      const spaceId = row.space_id as string | null;
      if (spaceId !== null) {
        return visibleSpaceIds.has(spaceId) ? (row.name as string) : null;
      }
      if (row.is_private as boolean) {
        return (row.created_by as string | null) === userId
          ? (row.name as string)
          : null;
      }
      return role === "guest" ? null : (row.name as string);
    }
    if (type === "whiteboard") {
      const res = await client.query(
        `SELECT name, space_id FROM whiteboards WHERE id = $1`,
        [id],
      );
      const row = res.rows[0];
      if (!row) return null;
      const spaceId = row.space_id as string | null;
      if (spaceId === null) return role === "guest" ? null : (row.name as string);
      return visibleSpaceIds.has(spaceId) ? (row.name as string) : null;
    }
    // dashboard: workspace-wide, any non-guest member.
    const res = await client.query(
      `SELECT name FROM dashboards WHERE id = $1`,
      [id],
    );
    if (!res.rows[0] || role === "guest") return null;
    return res.rows[0].name as string;
  }
}
