import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { DbService } from "../db/db.service";
import { optionalName, requireName, requireSpaceEdit } from "./tasks.support";

export interface ChecklistItem {
  id: string;
  name: string;
  resolved: boolean;
  assigneeUserId: string | null;
  position: number;
}

export interface Checklist {
  id: string;
  name: string;
  position: number;
  items: ChecklistItem[];
}

function toItem(r: Record<string, unknown>): ChecklistItem {
  return {
    id: r.id as string,
    name: r.name as string,
    resolved: r.resolved as boolean,
    assigneeUserId: (r.assignee_user_id as string | null) ?? null,
    position: r.position as number,
  };
}

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  /** Resolve the owning space of a task (404 if the task doesn't exist). */
  private async taskSpace(
    client: PoolClient,
    taskId: string,
  ): Promise<string> {
    const res = await client.query(
      `SELECT space_id FROM tasks WHERE id = $1`,
      [taskId],
    );
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    return res.rows[0].space_id as string;
  }

  /** Resolve the owning space (via task) of a checklist. */
  private async checklistSpace(
    client: PoolClient,
    checklistId: string,
  ): Promise<string> {
    const res = await client.query(
      `SELECT t.space_id
       FROM checklists c JOIN tasks t ON t.id = c.task_id
       WHERE c.id = $1`,
      [checklistId],
    );
    if (!res.rows[0]) throw new NotFoundException("Checklist not found");
    return res.rows[0].space_id as string;
  }

  private async itemSpace(
    client: PoolClient,
    itemId: string,
  ): Promise<string> {
    const res = await client.query(
      `SELECT t.space_id
       FROM checklist_items ci
       JOIN checklists c ON c.id = ci.checklist_id
       JOIN tasks t ON t.id = c.task_id
       WHERE ci.id = $1`,
      [itemId],
    );
    if (!res.rows[0]) throw new NotFoundException("Checklist item not found");
    return res.rows[0].space_id as string;
  }

  async createChecklist(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    body: { name?: string },
  ): Promise<Checklist> {
    const name = optionalName(body?.name) ?? "Checklist";
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.taskSpace(client, taskId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const pos = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM checklists WHERE task_id = $1`,
        [taskId],
      );
      const res = await client.query(
        `INSERT INTO checklists (workspace_id, task_id, name, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, position`,
        [workspaceId, taskId, name, pos.rows[0].n as number],
      );
      return {
        id: res.rows[0].id as string,
        name: res.rows[0].name as string,
        position: res.rows[0].position as number,
        items: [],
      };
    });
  }

  async updateChecklist(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string },
  ): Promise<Checklist> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.checklistSpace(client, id);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const name = optionalName(body?.name);
      if (name !== undefined) {
        await client.query(`UPDATE checklists SET name = $1 WHERE id = $2`, [
          name,
          id,
        ]);
      }
      const res = await client.query(
        `SELECT id, name, position FROM checklists WHERE id = $1`,
        [id],
      );
      const items = await client.query(
        `SELECT id, name, resolved, assignee_user_id, position
         FROM checklist_items WHERE checklist_id = $1 ORDER BY position, created_at`,
        [id],
      );
      return {
        id: res.rows[0].id as string,
        name: res.rows[0].name as string,
        position: res.rows[0].position as number,
        items: items.rows.map(toItem),
      };
    });
  }

  async removeChecklist(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.checklistSpace(client, id);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await client.query(`DELETE FROM checklists WHERE id = $1`, [id]);
    });
  }

  async createItem(
    workspaceId: string,
    userId: string,
    role: Role,
    checklistId: string,
    body: { name?: string },
  ): Promise<ChecklistItem> {
    const name = requireName(body?.name);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.checklistSpace(client, checklistId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const pos = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM checklist_items WHERE checklist_id = $1`,
        [checklistId],
      );
      const res = await client.query(
        `INSERT INTO checklist_items (workspace_id, checklist_id, name, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, resolved, assignee_user_id, position`,
        [workspaceId, checklistId, name, pos.rows[0].n as number],
      );
      return toItem(res.rows[0]);
    });
  }

  async updateItem(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; resolved?: boolean; assigneeUserId?: string | null },
  ): Promise<ChecklistItem> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.itemSpace(client, id);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      const name = optionalName(body?.name);
      if (name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(name);
      }
      if (body?.resolved !== undefined) {
        sets.push(`resolved = $${i++}`);
        params.push(body.resolved === true);
      }
      if (body?.assigneeUserId !== undefined) {
        // Validate the assignee is a member of this workspace before storing
        // it — otherwise an arbitrary/foreign UUID could be written (every
        // other assignee path validates membership; this one must too).
        if (body.assigneeUserId !== null) {
          const m = await client.query(
            "SELECT 1 FROM memberships WHERE user_id = $1",
            [body.assigneeUserId],
          );
          if (!m.rows[0]) {
            throw new BadRequestException(
              "assignee is not a member of this workspace",
            );
          }
        }
        sets.push(`assignee_user_id = $${i++}`);
        params.push(body.assigneeUserId ?? null);
      }
      if (sets.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE checklist_items SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      const res = await client.query(
        `SELECT id, name, resolved, assignee_user_id, position
         FROM checklist_items WHERE id = $1`,
        [id],
      );
      return toItem(res.rows[0]);
    });
  }

  async removeItem(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.itemSpace(client, id);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await client.query(`DELETE FROM checklist_items WHERE id = $1`, [id]);
    });
  }
}
