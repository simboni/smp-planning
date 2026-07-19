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
  requireSpaceEdit,
  requireSpaceVisible,
  requireUuid,
} from "./tasks.support";

/**
 * Module 4: task relations — dependencies (`task_id` WAITS ON
 * `depends_on_task_id`) and symmetric links (unordered pairs stored once as
 * task_a < task_b). The workspace boundary is RLS; this service adds the
 * product rules: edit on the anchoring task's space, visibility of the other
 * task's space, no self/duplicate edges, and no dependency cycles (checked by
 * walking the waiting-on graph before inserting the closing edge).
 */
@Injectable()
export class RelationsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  /** Load a task's space (404 when missing / other workspace via RLS). */
  private async taskSpace(client: PoolClient, taskId: string): Promise<string> {
    const res = await client.query(`SELECT space_id FROM tasks WHERE id = $1`, [
      taskId,
    ]);
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    return res.rows[0].space_id as string;
  }

  // --- Dependencies ---------------------------------------------------------

  async addDependency(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    dependsOnTaskId: unknown,
  ): Promise<void> {
    const depId = requireUuid(dependsOnTaskId, "dependsOnTaskId");
    if (depId === taskId) {
      throw new BadRequestException("a task cannot depend on itself");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.taskSpace(client, taskId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const depSpaceId = await this.taskSpace(client, depId);
      await requireSpaceVisible(this.access, client, userId, role, depSpaceId);

      const dup = await client.query(
        `SELECT 1 FROM task_dependencies
         WHERE task_id = $1 AND depends_on_task_id = $2`,
        [taskId, depId],
      );
      if (dup.rows[0]) {
        throw new BadRequestException("dependency already exists");
      }

      // Cycle check: walk the waiting-on graph from the new dependency; if
      // the anchoring task is reachable, this edge would close a cycle.
      const cycle = await client.query(
        `WITH RECURSIVE walk AS (
           SELECT depends_on_task_id AS id
           FROM task_dependencies WHERE task_id = $1
           UNION
           SELECT d.depends_on_task_id
           FROM task_dependencies d JOIN walk w ON d.task_id = w.id
         )
         SELECT 1 FROM walk WHERE id = $2 LIMIT 1`,
        [depId, taskId],
      );
      if (cycle.rows[0]) {
        throw new BadRequestException("circular dependency");
      }

      await client.query(
        `INSERT INTO task_dependencies
           (workspace_id, task_id, depends_on_task_id, created_by)
         VALUES ($1, $2, $3, $4)`,
        [workspaceId, taskId, depId, userId],
      );
    });
  }

  async removeDependency(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    dependsOnTaskId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.taskSpace(client, taskId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await client.query(
        `DELETE FROM task_dependencies
         WHERE task_id = $1 AND depends_on_task_id = $2`,
        [taskId, dependsOnTaskId],
      );
    });
  }

  // --- Links ----------------------------------------------------------------

  async addLink(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    otherTaskId: unknown,
  ): Promise<void> {
    const otherId = requireUuid(otherTaskId, "taskId");
    if (otherId === taskId) {
      throw new BadRequestException("a task cannot be linked to itself");
    }
    // Canonical lowercase uuid text order matches Postgres uuid order.
    const [a, b] = taskId < otherId ? [taskId, otherId] : [otherId, taskId];
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.taskSpace(client, taskId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const otherSpaceId = await this.taskSpace(client, otherId);
      await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        otherSpaceId,
      );

      const dup = await client.query(
        `SELECT 1 FROM task_links WHERE task_a = $1 AND task_b = $2`,
        [a, b],
      );
      if (dup.rows[0]) throw new BadRequestException("link already exists");

      await client.query(
        `INSERT INTO task_links (workspace_id, task_a, task_b, created_by)
         VALUES ($1, $2, $3, $4)`,
        [workspaceId, a, b, userId],
      );
    });
  }

  async removeLink(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    otherTaskId: string,
  ): Promise<void> {
    const [a, b] =
      taskId < otherTaskId ? [taskId, otherTaskId] : [otherTaskId, taskId];
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spaceId = await this.taskSpace(client, taskId);
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      await client.query(
        `DELETE FROM task_links WHERE task_a = $1 AND task_b = $2`,
        [a, b],
      );
    });
  }
}
