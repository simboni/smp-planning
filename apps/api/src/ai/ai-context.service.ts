import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";
import { AccessService } from "../access/access.service";

/**
 * Workspace-state snapshot for Copilot grounding.
 *
 * A keyword search can only answer questions whose words appear in a task
 * name. Broad questions — "how's this week going?", "what's pending?",
 * "who's overloaded?" — need the actual STATE of the workspace. This service
 * assembles a compact, permission-scoped snapshot (open / overdue / recently
 * completed tasks, with owners and status) that both Ask (to summarize) and the
 * Do operator (to pick real tasks to act on) build on.
 */

export interface SnapshotMember {
  id: string;
  name: string;
}

export interface SnapshotTask {
  id: string;
  name: string;
  listId: string;
  spaceId: string;
  spaceName: string;
  status: string | null;
  statusType: string | null; // not_started | active | done
  priority: string | null;
  due: string | null;
  overdue: boolean;
  done: boolean;
  completedRecently: boolean;
  updatedAt: string;
  assignees: SnapshotMember[];
}

export interface SnapshotSpace {
  id: string;
  name: string;
  lists: { id: string; name: string }[];
}

export interface WorkspaceSnapshot {
  counts: {
    openTasks: number;
    overdue: number;
    completedThisWeek: number;
    members: number;
    spaces: number;
  };
  members: SnapshotMember[];
  spaces: SnapshotSpace[];
  tasks: SnapshotTask[];
}

const MAX_TASKS = 60;

@Injectable()
export class AiContextService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  async snapshot(
    workspaceId: string,
    userId: string,
    role: Role,
    taskLimit = MAX_TASKS,
  ): Promise<WorkspaceSnapshot> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = [...(await this.access.visibleSpaceIds(client, userId, role))];
      if (visible.length === 0) {
        return {
          counts: { openTasks: 0, overdue: 0, completedThisWeek: 0, members: 0, spaces: 0 },
          members: [],
          spaces: [],
          tasks: [],
        };
      }

      const counts = await this.counts(client, visible);
      const members = await this.members(client);
      const spaces = await this.spaces(client, visible);
      const tasks = await this.tasks(client, visible, taskLimit);
      return { counts, members, spaces, tasks };
    });
  }

  private async counts(client: PoolClient, spaceIds: string[]) {
    const r = await client.query(
      `SELECT
         count(*) FILTER (WHERE coalesce(s.type,'') <> 'done')::int AS open_tasks,
         count(*) FILTER (WHERE coalesce(s.type,'') <> 'done'
                          AND t.due_date IS NOT NULL AND t.due_date < now())::int AS overdue,
         count(*) FILTER (WHERE s.type = 'done'
                          AND coalesce(t.completed_at, t.updated_at) > now() - interval '7 days')::int AS done_week
       FROM tasks t
       LEFT JOIN statuses s ON s.id = t.status_id
       WHERE t.space_id = ANY($1) AND t.parent_task_id IS NULL AND t.archived = false`,
      [spaceIds],
    );
    const spaces = await client.query(
      `SELECT count(*)::int AS n FROM spaces WHERE id = ANY($1) AND archived = false`,
      [spaceIds],
    );
    const mem = await client.query(
      `SELECT count(*)::int AS n FROM memberships WHERE workspace_id = current_setting('app.current_workspace')::uuid AND status = 'active'`,
    );
    return {
      openTasks: (r.rows[0]?.open_tasks as number) ?? 0,
      overdue: (r.rows[0]?.overdue as number) ?? 0,
      completedThisWeek: (r.rows[0]?.done_week as number) ?? 0,
      members: (mem.rows[0]?.n as number) ?? 0,
      spaces: (spaces.rows[0]?.n as number) ?? 0,
    };
  }

  private async spaces(
    client: PoolClient,
    spaceIds: string[],
  ): Promise<SnapshotSpace[]> {
    const r = await client.query(
      `SELECT sp.id, sp.name,
              coalesce(
                json_agg(json_build_object('id', l.id, 'name', l.name)
                         ORDER BY l.sort_order)
                  FILTER (WHERE l.id IS NOT NULL AND l.archived = false), '[]'
              ) AS lists
         FROM spaces sp
         LEFT JOIN lists l ON l.space_id = sp.id
        WHERE sp.id = ANY($1) AND sp.archived = false
        GROUP BY sp.id
        ORDER BY sp.sort_order
        LIMIT 40`,
      [spaceIds],
    );
    return r.rows.map((x) => ({
      id: x.id as string,
      name: x.name as string,
      lists: (x.lists as { id: string; name: string }[]).slice(0, 20),
    }));
  }

  private async members(client: PoolClient): Promise<SnapshotMember[]> {
    const r = await client.query(
      `SELECT u.id, u.full_name, u.email
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = current_setting('app.current_workspace')::uuid
          AND m.status = 'active'
        ORDER BY m.created_at LIMIT 100`,
    );
    return r.rows.map((x) => ({
      id: x.id as string,
      name: (x.full_name as string) || (x.email as string) || "Member",
    }));
  }

  private async tasks(
    client: PoolClient,
    spaceIds: string[],
    limit: number,
  ): Promise<SnapshotTask[]> {
    // Prioritize what matters: overdue-and-open first, then recently touched.
    const r = await client.query(
      `SELECT t.id, t.name, t.list_id, t.space_id, sp.name AS space_name,
              s.name AS status, s.type AS status_type, t.priority,
              t.due_date, t.completed_at, t.updated_at,
              coalesce(
                json_agg(json_build_object('id', u.id, 'name', u.full_name))
                  FILTER (WHERE u.id IS NOT NULL), '[]'
              ) AS assignees
         FROM tasks t
         JOIN spaces sp ON sp.id = t.space_id
         LEFT JOIN statuses s ON s.id = t.status_id
         LEFT JOIN task_assignees ta ON ta.task_id = t.id
         LEFT JOIN users u ON u.id = ta.user_id
        WHERE t.space_id = ANY($1) AND t.parent_task_id IS NULL AND t.archived = false
        GROUP BY t.id, sp.name, s.name, s.type
        ORDER BY
          (t.due_date IS NOT NULL AND t.due_date < now() AND coalesce(s.type,'') <> 'done') DESC,
          t.updated_at DESC
        LIMIT $2`,
      [spaceIds, limit],
    );
    return r.rows.map((x) => {
      const statusType = (x.status_type as string) ?? null;
      const due = x.due_date ? new Date(x.due_date as string).toISOString() : null;
      const done = statusType === "done";
      const overdue =
        !done && !!x.due_date && new Date(x.due_date as string).getTime() < Date.now();
      const completedAt = x.completed_at ?? x.updated_at;
      const completedRecently =
        done &&
        !!completedAt &&
        new Date(completedAt as string).getTime() > Date.now() - 7 * 864e5;
      const assignees = (x.assignees as { id: string; name: string }[]).map((a) => ({
        id: a.id,
        name: a.name || "Member",
      }));
      return {
        id: x.id as string,
        name: x.name as string,
        listId: x.list_id as string,
        spaceId: x.space_id as string,
        spaceName: x.space_name as string,
        status: (x.status as string) ?? null,
        statusType,
        priority: (x.priority as string) ?? null,
        due,
        overdue,
        done,
        completedRecently,
        updatedAt: new Date(x.updated_at as string).toISOString(),
        assignees,
      };
    });
  }
}
