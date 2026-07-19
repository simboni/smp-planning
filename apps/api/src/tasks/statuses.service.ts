import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { DbService } from "../db/db.service";
import {
  DEFAULT_STATUSES,
  optionalName,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  validColor,
  validStatusType,
  assertIdArray,
} from "./tasks.support";

export interface Status {
  id: string;
  name: string;
  color: string;
  type: "not_started" | "active" | "done";
  position: number;
}

function toStatus(r: Record<string, unknown>): Status {
  return {
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
    type: r.type as Status["type"],
    position: r.position as number,
  };
}

@Injectable()
export class StatusesService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  /**
   * Lazily provision the three ClickUp-style default statuses when a space
   * has none. Idempotent: a count-guard means a second caller in a later
   * transaction won't duplicate them.
   */
  async ensureDefaults(
    client: PoolClient,
    workspaceId: string,
    spaceId: string,
  ): Promise<void> {
    const count = await client.query(
      `SELECT 1 FROM statuses WHERE space_id = $1 LIMIT 1`,
      [spaceId],
    );
    if (count.rows[0]) return;
    for (const s of DEFAULT_STATUSES) {
      await client.query(
        `INSERT INTO statuses (workspace_id, space_id, name, color, type, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [workspaceId, spaceId, s.name, s.color, s.type, s.position],
      );
    }
  }

  /** All statuses in a space, ordered by position. */
  private async loadStatuses(
    client: PoolClient,
    spaceId: string,
  ): Promise<Status[]> {
    const res = await client.query(
      `SELECT id, name, color, type, position
       FROM statuses WHERE space_id = $1
       ORDER BY position, created_at`,
      [spaceId],
    );
    return res.rows.map(toStatus);
  }

  /** The space's first status (by position). Assumes defaults exist. */
  async firstStatus(
    client: PoolClient,
    spaceId: string,
  ): Promise<Status | null> {
    const res = await client.query(
      `SELECT id, name, color, type, position
       FROM statuses WHERE space_id = $1
       ORDER BY position, created_at LIMIT 1`,
      [spaceId],
    );
    return res.rows[0] ? toStatus(res.rows[0]) : null;
  }

  async getStatuses(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<Status[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      await this.ensureDefaults(client, workspaceId, spaceId);
      return this.loadStatuses(client, spaceId);
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string; color?: string; type?: string },
  ): Promise<Status> {
    const name = requireName(body?.name);
    const color =
      body?.color === undefined || body.color === null
        ? "#8A8F98"
        : validColor(body.color);
    const type =
      body?.type === undefined || body.type === null
        ? "active"
        : validStatusType(body.type);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await this.ensureDefaults(client, workspaceId, spaceId);
      const pos = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM statuses WHERE space_id = $1`,
        [spaceId],
      );
      const res = await client.query(
        `INSERT INTO statuses (workspace_id, space_id, name, color, type, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, color, type, position`,
        [workspaceId, spaceId, name, color, type, pos.rows[0].n as number],
      );
      return toStatus(res.rows[0]);
    });
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; color?: string; type?: string },
  ): Promise<Status> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await client.query(
        `SELECT space_id FROM statuses WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Status not found");
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
      if (body?.type !== undefined) {
        sets.push(`type = $${i++}`);
        params.push(validStatusType(body.type));
      }
      if (sets.length === 0) {
        const res = await client.query(
          `SELECT id, name, color, type, position FROM statuses WHERE id = $1`,
          [id],
        );
        return toStatus(res.rows[0]);
      }
      params.push(id);
      const res = await client.query(
        `UPDATE statuses SET ${sets.join(", ")} WHERE id = $${i}
         RETURNING id, name, color, type, position`,
        params,
      );
      return toStatus(res.rows[0]);
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
        `SELECT space_id FROM statuses WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Status not found");
      const spaceId = owning.rows[0].space_id as string;
      await requireSpaceEdit(this.access, client, userId, role, spaceId);

      const all = await this.loadStatuses(client, spaceId);
      if (all.length <= 1) {
        throw new BadRequestException("A space must keep at least one status");
      }
      // Move any tasks using this status to the space's first remaining one.
      const fallback = all.find((s) => s.id !== id)!;
      await client.query(
        `UPDATE tasks SET status_id = $1 WHERE status_id = $2`,
        [fallback.id, id],
      );
      await client.query(`DELETE FROM statuses WHERE id = $1`, [id]);
    });
  }

  async reorder(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    ids: string[],
  ): Promise<void> {
    assertIdArray(ids);
    if (ids.length === 0) return;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await client.query(
        `UPDATE statuses AS s SET position = v.ord
         FROM (SELECT unnest($1::uuid[]) AS id,
                      generate_subscripts($1::uuid[], 1) - 1 AS ord) AS v
         WHERE s.id = v.id AND s.space_id = $2`,
        [ids, spaceId],
      );
    });
  }
}
