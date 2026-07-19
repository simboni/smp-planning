import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { DbService } from "../db/db.service";
import {
  optionalName,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  validColor,
} from "./tasks.support";

export interface Tag {
  id: string;
  name: string;
  color: string;
}

function toTag(r: Record<string, unknown>): Tag {
  return {
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
  };
}

@Injectable()
export class TagsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  async getTags(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<Tag[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT id, name, color FROM tags WHERE space_id = $1 ORDER BY name`,
        [spaceId],
      );
      return res.rows.map(toTag);
    });
  }

  /**
   * Create a tag in a space (unique per space by name -> 409 on dup). Runs
   * inside an existing transaction when `client` is supplied (used when a task
   * applies a brand-new tag); otherwise opens its own.
   */
  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string; color?: string },
  ): Promise<Tag> {
    const name = requireName(body?.name);
    const color =
      body?.color === undefined || body.color === null
        ? "#7B68EE"
        : validColor(body.color);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      return this.insert(client, workspaceId, spaceId, name, color);
    });
  }

  /** Low-level insert (dedup -> 409). Caller has already gated permission. */
  async insert(
    client: PoolClient,
    workspaceId: string,
    spaceId: string,
    name: string,
    color: string,
  ): Promise<Tag> {
    try {
      const res = await client.query(
        `INSERT INTO tags (workspace_id, space_id, name, color)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, color`,
        [workspaceId, spaceId, name, color],
      );
      return toTag(res.rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictException("A tag with this name already exists");
      }
      throw err;
    }
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; color?: string },
  ): Promise<Tag> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await client.query(
        `SELECT space_id FROM tags WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Tag not found");
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        owning.rows[0].space_id as string,
      );
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      const name = optionalName(body?.name);
      if (name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(name);
      }
      if (body?.color !== undefined) {
        sets.push(`color = $${i++}`);
        params.push(validColor(body.color));
      }
      if (sets.length === 0) {
        const res = await client.query(
          `SELECT id, name, color FROM tags WHERE id = $1`,
          [id],
        );
        return toTag(res.rows[0]);
      }
      params.push(id);
      try {
        const res = await client.query(
          `UPDATE tags SET ${sets.join(", ")} WHERE id = $${i}
           RETURNING id, name, color`,
          params,
        );
        return toTag(res.rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictException("A tag with this name already exists");
        }
        throw err;
      }
    });
  }

  async remove(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await client.query(
        `SELECT space_id FROM tags WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Tag not found");
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        owning.rows[0].space_id as string,
      );
      await client.query(`DELETE FROM tags WHERE id = $1`, [id]);
    });
  }
}
