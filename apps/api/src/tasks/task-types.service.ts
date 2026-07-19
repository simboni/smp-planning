import {
  BadRequestException,
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
} from "./tasks.support";

export interface TaskType {
  id: string;
  name: string;
  icon: string;
  isMilestone: boolean;
}

/** Defaults lazily provisioned for a space with no task types (ClickUp-ish). */
const DEFAULT_TASK_TYPES = [
  { name: "Milestone", icon: "🔷", isMilestone: true },
  { name: "Bug", icon: "🐞", isMilestone: false },
  { name: "Feature", icon: "✨", isMilestone: false },
] as const;

function toTaskType(r: Record<string, unknown>): TaskType {
  return {
    id: r.id as string,
    name: r.name as string,
    icon: r.icon as string,
    isMilestone: r.is_milestone as boolean,
  };
}

/**
 * Module 4: per-space task type catalogue (Milestone / Bug / Feature / ...).
 * "Task" itself stays implicit (tasks.task_type_id NULL); deleting a type
 * nulls the column via its FK.
 */
@Injectable()
export class TaskTypesService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  /** Provision the default catalogue when the space has none. Idempotent. */
  private async ensureDefaults(
    client: PoolClient,
    workspaceId: string,
    spaceId: string,
  ): Promise<void> {
    const count = await client.query(
      `SELECT 1 FROM task_types WHERE space_id = $1 LIMIT 1`,
      [spaceId],
    );
    if (count.rows[0]) return;
    for (const t of DEFAULT_TASK_TYPES) {
      await client.query(
        `INSERT INTO task_types (workspace_id, space_id, name, icon, is_milestone)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, spaceId, t.name, t.icon, t.isMilestone],
      );
    }
  }

  async listTaskTypes(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<TaskType[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      await this.ensureDefaults(client, workspaceId, spaceId);
      const res = await client.query(
        `SELECT id, name, icon, is_milestone FROM task_types
         WHERE space_id = $1 ORDER BY created_at, name`,
        [spaceId],
      );
      return res.rows.map(toTaskType);
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string; icon?: string; isMilestone?: boolean },
  ): Promise<TaskType> {
    const name = requireName(body?.name);
    const icon = this.validIcon(body?.icon) ?? "📌";
    const isMilestone = this.validMilestone(body?.isMilestone) ?? false;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      try {
        const res = await client.query(
          `INSERT INTO task_types (workspace_id, space_id, name, icon, is_milestone)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, icon, is_milestone`,
          [workspaceId, spaceId, name, icon, isMilestone],
        );
        return toTaskType(res.rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictException(
            "A task type with this name already exists in this space",
          );
        }
        throw err;
      }
    });
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; icon?: string; isMilestone?: boolean },
  ): Promise<TaskType> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await client.query(
        `SELECT id, space_id, name, icon, is_milestone FROM task_types WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Task type not found");
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
      if (body?.icon !== undefined) {
        sets.push(`icon = $${i++}`);
        params.push(this.validIcon(body.icon));
      }
      if (body?.isMilestone !== undefined) {
        sets.push(`is_milestone = $${i++}`);
        params.push(this.validMilestone(body.isMilestone));
      }
      if (sets.length === 0) return toTaskType(owning.rows[0]);
      params.push(id);
      try {
        const res = await client.query(
          `UPDATE task_types SET ${sets.join(", ")} WHERE id = $${i}
           RETURNING id, name, icon, is_milestone`,
          params,
        );
        return toTaskType(res.rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictException(
            "A task type with this name already exists in this space",
          );
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
        `SELECT space_id FROM task_types WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Task type not found");
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        owning.rows[0].space_id as string,
      );
      // tasks.task_type_id nulls via ON DELETE SET NULL.
      await client.query(`DELETE FROM task_types WHERE id = $1`, [id]);
    });
  }

  private validIcon(icon: unknown): string | undefined {
    if (icon === undefined) return undefined;
    if (typeof icon !== "string" || !icon.trim()) {
      throw new BadRequestException("icon must be a non-empty string");
    }
    return icon.trim();
  }

  private validMilestone(v: unknown): boolean | undefined {
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") {
      throw new BadRequestException("isMilestone must be a boolean");
    }
    return v;
  }
}
