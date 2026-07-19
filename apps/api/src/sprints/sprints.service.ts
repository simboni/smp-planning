import {
  BadRequestException,
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
  requireSpaceEdit,
  requireSpaceVisible,
} from "../tasks/tasks.support";
import {
  BurndownDay,
  completedPointsByDay,
  computeBurndown,
  sprintPointsForLists,
  validDateOnly,
} from "./sprints.support";

// --- Shapes -----------------------------------------------------------------

export interface Sprint {
  id: string;
  spaceId: string;
  listId: string;
  name: string;
  startDate: string;
  endDate: string;
  archived: boolean;
  createdAt: string;
}

export type SprintWithPoints = Sprint & {
  totalPoints: number;
  completedPoints: number;
};

export interface SprintReport {
  sprint: Sprint;
  totalPoints: number;
  completedPoints: number;
  /** This space's sprints (archived + current), chronologically. */
  velocity: { sprintId: string; name: string; completedPoints: number }[];
  burndown: { days: BurndownDay[] };
}

const SPRINT_SQL = `
  SELECT s.id, s.space_id, s.list_id, s.name,
         s.start_date::text AS start_date, s.end_date::text AS end_date,
         s.archived, s.created_at
  FROM sprints s`;

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toSprint(r: Record<string, unknown>): Sprint {
  return {
    id: r.id as string,
    spaceId: r.space_id as string,
    listId: r.list_id as string,
    name: r.name as string,
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    archived: r.archived as boolean,
    createdAt: iso(r.created_at),
  };
}

/**
 * Module 10: Sprints. A sprint WRAPS a List 1:1 with a date window: creating
 * a sprint creates a fresh folderless List in the space (so tasks/views on it
 * behave like any list), and deleting the sprint removes only the wrapper —
 * the list and its tasks survive. Creating/managing sprints requires EDIT
 * permission on the space; reading them requires the space to be visible
 * (an invisible space 404s, never leaking its existence).
 */
@Injectable()
export class SprintsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private publishSprintChanged(workspaceId: string, sprintId: string): void {
    this.events.publish(workspaceId, {
      type: "sprint.changed",
      payload: { sprintId },
    });
  }

  /** Load a sprint row (404 when missing). */
  private async sprintRow(
    client: PoolClient,
    sprintId: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(`${SPRINT_SQL} WHERE s.id = $1`, [sprintId]);
    if (!res.rows[0]) throw new NotFoundException("Sprint not found");
    return res.rows[0];
  }

  // --- Create ---------------------------------------------------------------

  async createSprint(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string; startDate?: string; endDate?: string },
  ): Promise<Sprint> {
    const startDate = validDateOnly(body?.startDate, "startDate");
    const endDate = validDateOnly(body?.endDate, "endDate");
    if (endDate < startDate) {
      throw new BadRequestException("endDate must be on or after startDate");
    }
    const givenName = optionalName(body?.name);

    const sprint = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        await requireSpaceEdit(this.access, client, userId, role, spaceId);

        const countRes = await client.query(
          `SELECT COUNT(*)::int AS n FROM sprints WHERE space_id = $1`,
          [spaceId],
        );
        const name =
          givenName ?? `Sprint ${(countRes.rows[0].n as number) + 1}`;

        // The sprint's backing list: a normal folderless list in the space.
        const orderRes = await client.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
           FROM lists WHERE space_id = $1 AND folder_id IS NULL`,
          [spaceId],
        );
        const listRes = await client.query(
          `INSERT INTO lists (workspace_id, space_id, name, sort_order, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [workspaceId, spaceId, name, orderRes.rows[0].n as number, userId],
        );
        const listId = listRes.rows[0].id as string;

        const ins = await client.query(
          `INSERT INTO sprints
             (workspace_id, space_id, list_id, name, start_date, end_date)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [workspaceId, spaceId, listId, name, startDate, endDate],
        );
        const sprintId = ins.rows[0].id as string;
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "sprint.created",
          entity: "sprint",
          entityId: sprintId,
          data: { name, spaceId, listId, startDate, endDate },
        });
        return toSprint(await this.sprintRow(client, sprintId));
      },
    );
    this.publishSprintChanged(workspaceId, sprint.id);
    return sprint;
  }

  // --- Read -----------------------------------------------------------------

  async listSprints(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<SprintWithPoints[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `${SPRINT_SQL} WHERE s.space_id = $1
         ORDER BY s.start_date, s.created_at, s.id`,
        [spaceId],
      );
      const sprints = res.rows.map(toSprint);
      const points = await sprintPointsForLists(
        client,
        sprints.map((s) => s.listId),
      );
      return sprints.map((s) => {
        const p = points.get(s.listId) ?? { total: 0, completed: 0 };
        return { ...s, totalPoints: p.total, completedPoints: p.completed };
      });
    });
  }

  // --- Update / delete ------------------------------------------------------

  async updateSprint(
    workspaceId: string,
    userId: string,
    role: Role,
    sprintId: string,
    body: {
      name?: string;
      startDate?: string;
      endDate?: string;
      archived?: boolean;
    },
  ): Promise<Sprint> {
    const name = optionalName(body?.name);
    const sprint = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const existing = await this.sprintRow(client, sprintId);
        await requireSpaceEdit(
          this.access,
          client,
          userId,
          role,
          existing.space_id as string,
        );

        // Validate the RESULTING window so a partial patch can't invert it.
        const startDate =
          body?.startDate !== undefined
            ? validDateOnly(body.startDate, "startDate")
            : (existing.start_date as string);
        const endDate =
          body?.endDate !== undefined
            ? validDateOnly(body.endDate, "endDate")
            : (existing.end_date as string);
        if (endDate < startDate) {
          throw new BadRequestException(
            "endDate must be on or after startDate",
          );
        }

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (name !== undefined) {
          sets.push(`name = $${i++}`);
          params.push(name);
        }
        if (body?.startDate !== undefined) {
          sets.push(`start_date = $${i++}`);
          params.push(startDate);
        }
        if (body?.endDate !== undefined) {
          sets.push(`end_date = $${i++}`);
          params.push(endDate);
        }
        if (body?.archived !== undefined) {
          sets.push(`archived = $${i++}`);
          params.push(body.archived === true);
        }
        if (sets.length > 0) {
          params.push(sprintId);
          await client.query(
            `UPDATE sprints SET ${sets.join(", ")} WHERE id = $${i}`,
            params,
          );
        }
        // Renaming the sprint renames its backing list, keeping them in step.
        if (name !== undefined && name !== (existing.name as string)) {
          await client.query(`UPDATE lists SET name = $1 WHERE id = $2`, [
            name,
            existing.list_id as string,
          ]);
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "sprint.updated",
          entity: "sprint",
          entityId: sprintId,
          data: { ...body },
        });
        return toSprint(await this.sprintRow(client, sprintId));
      },
    );
    this.publishSprintChanged(workspaceId, sprintId);
    return sprint;
  }

  async deleteSprint(
    workspaceId: string,
    userId: string,
    role: Role,
    sprintId: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.sprintRow(client, sprintId);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        existing.space_id as string,
      );
      // Only the sprint WRAPPER goes away — the backing list (and its tasks)
      // survives as a normal list in the space.
      await client.query(`DELETE FROM sprints WHERE id = $1`, [sprintId]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "sprint.deleted",
        entity: "sprint",
        entityId: sprintId,
        data: { listId: existing.list_id as string },
      });
    });
    this.publishSprintChanged(workspaceId, sprintId);
  }

  // --- Report ---------------------------------------------------------------

  async report(
    workspaceId: string,
    userId: string,
    role: Role,
    sprintId: string,
  ): Promise<SprintReport> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.sprintRow(client, sprintId);
      const sprint = toSprint(row);
      await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        sprint.spaceId,
      );

      // Velocity across the whole space: archived + current, chronologically.
      const all = await client.query(
        `${SPRINT_SQL} WHERE s.space_id = $1
         ORDER BY s.start_date, s.created_at, s.id`,
        [sprint.spaceId],
      );
      const sprints = all.rows.map(toSprint);
      const points = await sprintPointsForLists(
        client,
        sprints.map((s) => s.listId),
      );
      const velocity = sprints.map((s) => ({
        sprintId: s.id,
        name: s.name,
        completedPoints: points.get(s.listId)?.completed ?? 0,
      }));

      const mine = points.get(sprint.listId) ?? { total: 0, completed: 0 };
      const byDay = await completedPointsByDay(client, sprint.listId);
      return {
        sprint,
        totalPoints: mine.total,
        completedPoints: mine.completed,
        velocity,
        burndown: {
          days: computeBurndown(
            mine.total,
            byDay,
            sprint.startDate,
            sprint.endDate,
          ),
        },
      };
    });
  }
}
