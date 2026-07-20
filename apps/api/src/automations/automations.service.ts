import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { LimitsService } from "../limits/limits.service";
import {
  Priority,
  recordActivity,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
} from "../tasks/tasks.support";
import {
  AutomationAction,
  AutomationTrigger,
  validateActions,
  validateTrigger,
} from "./automations.support";

export interface AutomationOut {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
}

export interface AutomationRunOut {
  id: string;
  taskId: string | null;
  taskName: string | null;
  ok: boolean;
  detail: string;
  createdAt: string;
}

/** A task event the engine may react to (never emitted BY the engine). */
export interface AutomationEvent {
  type: "task.created" | "status.changed" | "priority.changed" | "assignee.added";
  taskId: string;
  toStatusId?: string | null;
  toPriority?: Priority | null;
  /** The human whose mutation raised the event (comment-author fallback). */
  actorUserId?: string | null;
}

interface AutomationRow {
  id: string;
  name: string;
  space_id: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  created_by: string | null;
}

const OVERDUE_SCAN_MS = 60_000;
/** Per-automation cap of tasks handled per overdue scan pass. */
const OVERDUE_BATCH = 200;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Module 11: Automations — per-space rules (trigger + actions) evaluated
 * inside the SAME withWorkspace transaction as the task mutation that raised
 * the event (TasksService calls fire() after its writes), plus a periodic
 * scan for due.overdue rules.
 *
 * LOOP PROTECTION: the engine executes actions as direct SQL right here — it
 * never calls TasksService and never calls fire() itself, so a mutation made
 * BY an automation (e.g. set.status) can never re-trigger other automations.
 * That structural one-hop guarantee is the "flag": automation-driven writes
 * simply have no code path back into the trigger dispatch.
 */
@Injectable()
export class AutomationsService implements OnModuleInit, OnModuleDestroy {
  /**
   * Workspace ids known to carry enabled due.overdue rules. RLS blocks any
   * cross-tenant "which workspaces have such rules?" query, so the registry
   * is in-memory: populated on rule create/update/list. Tradeoff (accepted
   * for M11): after a process restart the registry is empty until a rule in
   * the workspace is saved or listed again — the scan resumes lazily.
   */
  private readonly overdueWorkspaces = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.scanOverdue().catch((err) =>
        console.error("automation overdue scan failed:", err),
      );
    }, OVERDUE_SCAN_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // --- helpers --------------------------------------------------------------

  private async automationRow(
    client: PoolClient,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(
      `SELECT id, name, space_id, trigger, actions, enabled, created_by
       FROM automations WHERE id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException("Automation not found");
    return res.rows[0];
  }

  private trackOverdue(
    workspaceId: string,
    trigger: AutomationTrigger,
    enabled: boolean,
  ): void {
    if (trigger?.type === "due.overdue" && enabled) {
      this.overdueWorkspaces.add(workspaceId);
    }
  }

  private async withRunStats(
    client: PoolClient,
    row: Record<string, unknown>,
  ): Promise<AutomationOut> {
    const stats = await client.query(
      `SELECT COUNT(*)::int AS n, MAX(created_at) AS last
       FROM automation_runs WHERE automation_id = $1`,
      [row.id as string],
    );
    return {
      id: row.id as string,
      name: row.name as string,
      trigger: row.trigger as AutomationTrigger,
      actions: row.actions as AutomationAction[],
      enabled: row.enabled as boolean,
      runCount: stats.rows[0].n as number,
      lastRunAt: iso(stats.rows[0].last),
    };
  }

  // --- CRUD (auth'd) --------------------------------------------------------

  async listAutomations(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<AutomationOut[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT a.id, a.name, a.trigger, a.actions, a.enabled,
                COUNT(r.id)::int AS run_count, MAX(r.created_at) AS last_run_at
         FROM automations a
         LEFT JOIN automation_runs r ON r.automation_id = a.id
         WHERE a.space_id = $1
         GROUP BY a.id
         ORDER BY MIN(a.created_at), a.id`,
        [spaceId],
      );
      return res.rows.map((r) => {
        const trigger = r.trigger as AutomationTrigger;
        // Lazy registry rebuild after restarts: seeing a due.overdue rule
        // re-registers its workspace for the periodic scan.
        this.trackOverdue(workspaceId, trigger, r.enabled as boolean);
        return {
          id: r.id as string,
          name: r.name as string,
          trigger,
          actions: r.actions as AutomationAction[],
          enabled: r.enabled as boolean,
          runCount: r.run_count as number,
          lastRunAt: iso(r.last_run_at),
        };
      });
    });
  }

  async createAutomation(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: {
      name?: string;
      trigger?: unknown;
      actions?: unknown;
      enabled?: boolean;
    },
  ): Promise<AutomationOut> {
    const name = requireName(body?.name);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const trigger = await validateTrigger(client, spaceId, body?.trigger);
      const actions = await validateActions(client, spaceId, body?.actions);
      const enabled = body?.enabled !== false;
      const ins = await client.query(
        `INSERT INTO automations
           (workspace_id, space_id, name, trigger, actions, enabled, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          workspaceId,
          spaceId,
          name,
          JSON.stringify(trigger),
          JSON.stringify(actions),
          enabled,
          userId,
        ],
      );
      const id = ins.rows[0].id as string;
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "automation.created",
        entity: "automation",
        entityId: id,
        data: { name, spaceId, trigger: { ...trigger } },
      });
      this.trackOverdue(workspaceId, trigger, enabled);
      return this.withRunStats(client, await this.automationRow(client, id));
    });
  }

  async updateAutomation(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: {
      name?: string;
      trigger?: unknown;
      actions?: unknown;
      enabled?: boolean;
    },
  ): Promise<AutomationOut> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.automationRow(client, id);
      const spaceId = existing.space_id as string;
      await requireSpaceEdit(this.access, client, userId, role, spaceId);

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (body?.name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(requireName(body.name));
      }
      let trigger = existing.trigger as AutomationTrigger;
      if (body?.trigger !== undefined) {
        trigger = await validateTrigger(client, spaceId, body.trigger);
        sets.push(`trigger = $${i++}`);
        params.push(JSON.stringify(trigger));
      }
      if (body?.actions !== undefined) {
        const actions = await validateActions(client, spaceId, body.actions);
        sets.push(`actions = $${i++}`);
        params.push(JSON.stringify(actions));
      }
      let enabled = existing.enabled as boolean;
      if (body?.enabled !== undefined) {
        enabled = body.enabled === true;
        sets.push(`enabled = $${i++}`);
        params.push(enabled);
      }
      if (sets.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE automations SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "automation.updated",
        entity: "automation",
        entityId: id,
        data: { enabled: body?.enabled, name: body?.name },
      });
      this.trackOverdue(workspaceId, trigger, enabled);
      return this.withRunStats(client, await this.automationRow(client, id));
    });
  }

  async deleteAutomation(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.automationRow(client, id);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        existing.space_id as string,
      );
      await client.query(`DELETE FROM automations WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "automation.deleted",
        entity: "automation",
        entityId: id,
        data: { name: existing.name as string },
      });
    });
  }

  async listRuns(
    workspaceId: string,
    userId: string,
    role: Role,
    automationId: string,
  ): Promise<AutomationRunOut[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.automationRow(client, automationId);
      await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        existing.space_id as string,
      );
      const res = await client.query(
        `SELECT r.id, r.task_id, t.name AS task_name, r.ok, r.detail,
                r.created_at
         FROM automation_runs r
         LEFT JOIN tasks t ON t.id = r.task_id
         WHERE r.automation_id = $1
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 50`,
        [automationId],
      );
      return res.rows.map((r) => ({
        id: r.id as string,
        taskId: (r.task_id as string | null) ?? null,
        taskName: (r.task_name as string | null) ?? null,
        ok: r.ok as boolean,
        detail: r.detail as string,
        createdAt: iso(r.created_at)!,
      }));
    });
  }

  // --- Engine ---------------------------------------------------------------

  /**
   * React to a task event. MUST run on the caller's withWorkspace client so
   * automation effects commit atomically with the mutation that raised the
   * event. Called ONLY from user-driven TasksService mutations — never from
   * action execution (see the loop-protection note on the class).
   */
  async fire(
    client: PoolClient,
    workspaceId: string,
    spaceId: string,
    event: AutomationEvent,
  ): Promise<void> {
    const res = await client.query(
      `SELECT id, name, space_id, trigger, actions, created_by
       FROM automations
       WHERE space_id = $1 AND enabled = true AND trigger->>'type' = $2
       ORDER BY created_at, id`,
      [spaceId, event.type],
    );
    if (res.rows.length === 0) return;
    // M20: once the workspace hits its monthly automation cap, stop running
    // rules until the next period. Metering never blocks the user's own
    // mutation — fire() is best-effort and simply no-ops when over quota.
    if (!(await this.limits.automationQuotaAvailable(client, workspaceId))) {
      return;
    }
    for (const row of res.rows as AutomationRow[]) {
      const trigger = row.trigger;
      if (
        event.type === "status.changed" &&
        trigger.toStatusId &&
        trigger.toStatusId !== event.toStatusId
      ) {
        continue;
      }
      if (
        event.type === "priority.changed" &&
        trigger.toPriority &&
        trigger.toPriority !== event.toPriority
      ) {
        continue;
      }
      await this.runOne(
        client,
        workspaceId,
        row,
        event.taskId,
        event.actorUserId ?? null,
      );
    }
  }

  /**
   * Execute one automation against one task: actions run sequentially under
   * a savepoint (a failing action rolls back ONLY this automation's writes,
   * never the user's mutation), then an automation_runs row + a task
   * activity entry record the outcome.
   */
  private async runOne(
    client: PoolClient,
    workspaceId: string,
    automation: AutomationRow,
    taskId: string,
    actorUserId: string | null,
  ): Promise<void> {
    let ok = true;
    let detail = "";
    await client.query("SAVEPOINT automation_run");
    try {
      detail = await this.executeActions(
        client,
        workspaceId,
        automation,
        taskId,
        actorUserId,
      );
      await client.query("RELEASE SAVEPOINT automation_run");
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT automation_run");
      await client.query("RELEASE SAVEPOINT automation_run");
      ok = false;
      detail = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    await client.query(
      `INSERT INTO automation_runs
         (workspace_id, automation_id, task_id, ok, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, automation.id, taskId, ok, detail],
    );
    await recordActivity(client, {
      workspaceId,
      taskId,
      actorUserId: null,
      kind: "automation",
      data: { automationId: automation.id, name: automation.name },
    });
  }

  /** Direct-SQL action execution with per-action guards; returns a summary. */
  private async executeActions(
    client: PoolClient,
    workspaceId: string,
    automation: AutomationRow,
    taskId: string,
    actorUserId: string | null,
  ): Promise<string> {
    const parts: string[] = [];
    for (const action of automation.actions) {
      switch (action.type) {
        case "set.status": {
          const st = await client.query(
            `SELECT s.id, s.type FROM statuses s
             JOIN tasks t ON t.space_id = s.space_id
             WHERE s.id = $1 AND t.id = $2`,
            [action.statusId, taskId],
          );
          if (!st.rows[0]) {
            parts.push("set.status: skipped (status gone)");
            break;
          }
          const cur = await client.query(
            `SELECT status_id FROM tasks WHERE id = $1`,
            [taskId],
          );
          if ((cur.rows[0]?.status_id as string | null) === action.statusId) {
            parts.push("set.status: skipped (already set)");
            break;
          }
          await client.query(
            `UPDATE tasks
               SET status_id = $1,
                   completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
                   updated_at = now()
             WHERE id = $3`,
            [action.statusId, st.rows[0].type === "done", taskId],
          );
          parts.push("set.status: applied");
          break;
        }
        case "set.priority": {
          const cur = await client.query(
            `SELECT priority FROM tasks WHERE id = $1`,
            [taskId],
          );
          if ((cur.rows[0]?.priority as string | null) === action.priority) {
            parts.push("set.priority: skipped (already set)");
            break;
          }
          await client.query(
            `UPDATE tasks SET priority = $1, updated_at = now() WHERE id = $2`,
            [action.priority, taskId],
          );
          parts.push(`set.priority: ${action.priority}`);
          break;
        }
        case "add.assignee": {
          const m = await client.query(
            `SELECT 1 FROM memberships WHERE user_id = $1`,
            [action.userId],
          );
          if (!m.rows[0]) {
            parts.push("add.assignee: skipped (not a member)");
            break;
          }
          const ins = await client.query(
            `INSERT INTO task_assignees (workspace_id, task_id, user_id)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING task_id`,
            [workspaceId, taskId, action.userId],
          );
          parts.push(
            ins.rows.length > 0
              ? "add.assignee: added"
              : "add.assignee: skipped (already assigned)",
          );
          break;
        }
        case "add.tag": {
          const tag = await client.query(
            `SELECT tg.id FROM tags tg
             JOIN tasks t ON t.space_id = tg.space_id
             WHERE tg.id = $1 AND t.id = $2`,
            [action.tagId, taskId],
          );
          if (!tag.rows[0]) {
            parts.push("add.tag: skipped (tag gone)");
            break;
          }
          const ins = await client.query(
            `INSERT INTO task_tags (workspace_id, task_id, tag_id)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING task_id`,
            [workspaceId, taskId, action.tagId],
          );
          parts.push(
            ins.rows.length > 0
              ? "add.tag: added"
              : "add.tag: skipped (already tagged)",
          );
          break;
        }
        case "post.comment": {
          // Comments need an author: the rule's creator, else the acting
          // user. (Plain INSERT + activity row, mirroring CommentsService —
          // no mention/notification fan-out for bot comments.)
          const author = automation.created_by ?? actorUserId;
          if (!author) {
            parts.push("post.comment: skipped (no author)");
            break;
          }
          const ins = await client.query(
            `INSERT INTO comments (workspace_id, task_id, author_user_id, body)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [workspaceId, taskId, author, action.body],
          );
          await recordActivity(client, {
            workspaceId,
            taskId,
            actorUserId: author,
            kind: "comment",
            data: { commentId: ins.rows[0].id as string },
          });
          parts.push("post.comment: posted");
          break;
        }
      }
    }
    return parts.join("; ");
  }

  // --- due.overdue scan -----------------------------------------------------

  /**
   * One pass over every registered workspace: for each enabled due.overdue
   * rule, act on non-archived, not-done tasks in its space whose due date has
   * passed and that this rule has not fired on before (automation_fired is
   * the once-per-task guard). Public so tests (and ops) can invoke a pass
   * directly; the module's 60s interval calls it in production.
   */
  async scanOverdue(): Promise<void> {
    for (const workspaceId of [...this.overdueWorkspaces]) {
      try {
        // System pass: workspace context only (empty user reads as NULL —
        // every table touched here is tenant-keyed, not user-keyed).
        await this.db.withWorkspace(workspaceId, "", async (client) => {
          const autos = await client.query(
            `SELECT id, name, space_id, trigger, actions, created_by
             FROM automations
             WHERE enabled = true AND trigger->>'type' = 'due.overdue'
             ORDER BY created_at, id`,
          );
          if (autos.rows.length === 0) {
            // No live rules left — drop the workspace from the registry.
            this.overdueWorkspaces.delete(workspaceId);
            return;
          }
          for (const auto of autos.rows as AutomationRow[]) {
            const tasks = await client.query(
              `SELECT t.id FROM tasks t
               LEFT JOIN statuses s ON s.id = t.status_id
               WHERE t.space_id = $1 AND t.archived = false
                 AND t.due_date < now()
                 AND s.type IS DISTINCT FROM 'done'
                 AND NOT EXISTS (
                   SELECT 1 FROM automation_fired f
                   WHERE f.automation_id = $2 AND f.task_id = t.id
                 )
               ORDER BY t.due_date, t.id
               LIMIT ${OVERDUE_BATCH}`,
              [auto.space_id, auto.id],
            );
            for (const t of tasks.rows) {
              const taskId = t.id as string;
              await this.runOne(client, workspaceId, auto, taskId, null);
              await client.query(
                `INSERT INTO automation_fired (workspace_id, automation_id, task_id)
                 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [workspaceId, auto.id, taskId],
              );
            }
          }
        });
      } catch (err) {
        console.error(
          `automation overdue scan failed for workspace ${workspaceId}:`,
          err,
        );
      }
    }
  }
}
