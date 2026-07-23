import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AiProvider } from "./ai.provider";
import { AiContextService, type WorkspaceSnapshot } from "./ai-context.service";
import { DbService } from "../db/db.service";
import { TasksService } from "../tasks/tasks.service";
import { ChatService } from "../chat/chat.service";
import { CommentsService } from "../comments/comments.service";

/**
 * Do (Copilot operator) — turns a command like "reassign the overdue design
 * tasks to whoever has capacity and post a recap in #design" into a PREVIEWED
 * list of concrete operations, then executes the ones the user approves.
 *
 * Safety: the model may only reference tasks / members / channels / lists that
 * are in the grounding snapshot (already permission-scoped), and every
 * operation runs through the ordinary service (updateTask, addAssignee,
 * createMessage, …) so RLS and role capabilities are enforced at execution.
 * Best-effort per operation — one failure never aborts the batch.
 */

export type OpType =
  | "create_task"
  | "set_status"
  | "set_assignees"
  | "set_priority"
  | "set_due"
  | "add_comment"
  | "post_message";

export interface Operation {
  type: OpType;
  summary: string;
  reason?: string;
  taskId?: string;
  taskName?: string;
  listId?: string;
  name?: string;
  description?: string;
  priority?: "urgent" | "high" | "normal" | "low";
  dueInDays?: number;
  assigneeIds?: string[];
  statusName?: string;
  body?: string;
  channelId?: string;
  channelName?: string;
}

export interface OperationPlan {
  summary: string;
  operations: Operation[];
  source: "claude" | "heuristic";
}

export interface OperationResult {
  summary: string;
  ok: boolean;
  detail: string;
}

export interface DoResult {
  results: OperationResult[];
  applied: number;
}

const MAX_OPS = 25;
const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);

const OP_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "create_task",
              "set_status",
              "set_assignees",
              "set_priority",
              "set_due",
              "add_comment",
              "post_message",
            ],
          },
          summary: { type: "string" },
          reason: { type: "string" },
          taskId: { type: "string" },
          listId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
          dueInDays: { type: "number" },
          assigneeIds: { type: "array", items: { type: "string" } },
          statusName: { type: "string" },
          body: { type: "string" },
          channelId: { type: "string" },
        },
        required: ["type", "summary"],
      },
    },
  },
  required: ["summary", "operations"],
};

const SYSTEM_DO =
  "You are StackUp's operator. Turn the user's command into concrete operations " +
  "on their workspace. Use ONLY the task ids, member ids, list ids and channel " +
  "ids from the provided context — never invent ids. Each operation needs a short " +
  "human 'summary' (what it does) and a 'reason' grounded in the context (e.g. " +
  "which member has capacity, why a task was chosen). Choose the smallest set of " +
  "operations that satisfies the command. Reply with ONLY the structured result.";

@Injectable()
export class AiOperatorService {
  constructor(
    private readonly ai: AiProvider,
    private readonly context: AiContextService,
    private readonly db: DbService,
    private readonly tasks: TasksService,
    private readonly chat: ChatService,
    private readonly comments: CommentsService,
  ) {}

  /** Plan operations for a command (no writes). */
  async plan(
    workspaceId: string,
    userId: string,
    role: Role,
    command: string,
  ): Promise<OperationPlan> {
    const snapshot = await this.context.snapshot(workspaceId, userId, role, 50);
    const channels = await this.listChannels(workspaceId, userId);

    if (!this.ai.available()) {
      return {
        summary: "Copilot actions need an AI key to plan. No changes were made.",
        operations: [],
        source: "heuristic",
      };
    }

    const prompt = buildPrompt(command, snapshot, channels);
    const raw = (await this.ai.completeJson(SYSTEM_DO, prompt, OP_SCHEMA, 2200)) as
      | { summary?: unknown; operations?: unknown }
      | null;
    if (!raw || !Array.isArray(raw.operations)) {
      return { summary: "I couldn't turn that into actions.", operations: [], source: "claude" };
    }

    const valid = validate(raw.operations, snapshot, channels);
    return {
      summary: typeof raw.summary === "string" ? raw.summary : "Proposed actions",
      operations: valid,
      source: "claude",
    };
  }

  /** Execute a (previewed) set of operations. Best-effort per op. */
  async run(
    workspaceId: string,
    userId: string,
    role: Role,
    operations: Operation[],
  ): Promise<DoResult> {
    // Re-validate against a fresh snapshot so a stale/tampered payload can't
    // act on anything the caller can't currently see.
    const snapshot = await this.context.snapshot(workspaceId, userId, role, 80);
    const channels = await this.listChannels(workspaceId, userId);
    const ops = validate(operations, snapshot, channels).slice(0, MAX_OPS);

    const taskSpace = new Map(snapshot.tasks.map((t) => [t.id, t.spaceId]));
    const results: OperationResult[] = [];
    let applied = 0;

    for (const op of ops) {
      try {
        await this.execute(workspaceId, userId, role, op, taskSpace);
        results.push({ summary: op.summary, ok: true, detail: "done" });
        applied += 1;
      } catch (err) {
        results.push({ summary: op.summary, ok: false, detail: (err as Error).message });
      }
    }
    return { results, applied };
  }

  private async execute(
    workspaceId: string,
    userId: string,
    role: Role,
    op: Operation,
    taskSpace: Map<string, string>,
  ): Promise<void> {
    switch (op.type) {
      case "create_task":
        if (!op.listId || !op.name) throw new Error("missing list or name");
        await this.tasks.createTask(workspaceId, userId, role, op.listId, {
          name: op.name,
          description: op.description,
          priority: op.priority ?? null,
          dueDate: dueDate(op.dueInDays),
          assigneeIds: op.assigneeIds?.length ? op.assigneeIds : undefined,
        });
        return;
      case "set_status": {
        if (!op.taskId || !op.statusName) throw new Error("missing task or status");
        const spaceId = taskSpace.get(op.taskId);
        if (!spaceId) throw new Error("task not found");
        const statusId = await this.resolveStatus(workspaceId, userId, spaceId, op.statusName);
        if (!statusId) throw new Error(`no status like "${op.statusName}"`);
        await this.tasks.updateTask(workspaceId, userId, role, op.taskId, { statusId });
        return;
      }
      case "set_priority":
        if (!op.taskId || !op.priority) throw new Error("missing task or priority");
        await this.tasks.updateTask(workspaceId, userId, role, op.taskId, {
          priority: op.priority,
        });
        return;
      case "set_due":
        if (!op.taskId) throw new Error("missing task");
        await this.tasks.updateTask(workspaceId, userId, role, op.taskId, {
          dueDate: dueDate(op.dueInDays),
        });
        return;
      case "set_assignees": {
        if (!op.taskId) throw new Error("missing task");
        await this.setAssignees(workspaceId, userId, role, op.taskId, op.assigneeIds ?? []);
        return;
      }
      case "add_comment":
        if (!op.taskId || !op.body) throw new Error("missing task or body");
        await this.comments.createComment(workspaceId, userId, role, op.taskId, {
          body: op.body,
        });
        return;
      case "post_message":
        if (!op.channelId || !op.body) throw new Error("missing channel or body");
        await this.chat.createMessage(workspaceId, userId, role, op.channelId, {
          body: op.body,
        });
        return;
      default:
        throw new Error("unknown operation");
    }
  }

  /** Replace a task's assignees with the target set (add missing, remove extra). */
  private async setAssignees(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    target: string[],
  ): Promise<void> {
    const current = await this.db.withWorkspace(workspaceId, userId, (c) =>
      c
        .query(`SELECT user_id FROM task_assignees WHERE task_id = $1`, [taskId])
        .then((r) => r.rows.map((x) => x.user_id as string)),
    );
    const want = new Set(target);
    const have = new Set(current);
    for (const uid of target) {
      if (!have.has(uid)) await this.tasks.addAssignee(workspaceId, userId, role, taskId, uid);
    }
    for (const uid of current) {
      if (!want.has(uid)) await this.tasks.removeAssignee(workspaceId, userId, role, taskId, uid);
    }
  }

  /** Resolve a status name (or common phrase) to a status id in the space. */
  private async resolveStatus(
    workspaceId: string,
    userId: string,
    spaceId: string,
    name: string,
  ): Promise<string | null> {
    return this.db.withWorkspace(workspaceId, userId, async (c) => {
      const exact = await c.query(
        `SELECT id FROM statuses WHERE space_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [spaceId, name],
      );
      if (exact.rows[0]) return exact.rows[0].id as string;
      // Fall back to intent → status type.
      const n = name.toLowerCase();
      let type: string | null = null;
      if (/(done|complete|finish|closed?)/.test(n)) type = "done";
      else if (/(progress|doing|active|start)/.test(n)) type = "active";
      else if (/(to ?do|todo|backlog|open|new)/.test(n)) type = "not_started";
      if (!type) return null;
      const byType = await c.query(
        `SELECT id FROM statuses WHERE space_id = $1 AND type = $2 ORDER BY position LIMIT 1`,
        [spaceId, type],
      );
      return byType.rows[0] ? (byType.rows[0].id as string) : null;
    });
  }

  private async listChannels(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string; name: string }[]> {
    try {
      return await this.db.withWorkspace(workspaceId, userId, (c) =>
        c
          .query(
            // Only channels the user is a member of — never leak private
            // channel names into a plan, and only offer ones they can post to.
            `SELECT ch.id, ch.name
               FROM channels ch
               JOIN channel_members cm ON cm.channel_id = ch.id
              WHERE cm.user_id = $1 AND ch.is_dm = false
              ORDER BY ch.created_at LIMIT 50`,
            [userId],
          )
          .then((r) => r.rows.map((x) => ({ id: x.id as string, name: x.name as string }))),
      );
    } catch {
      return [];
    }
  }
}

/* ---- validation + prompt ------------------------------------------ */

function validate(
  raw: unknown[],
  snapshot: WorkspaceSnapshot,
  channels: { id: string; name: string }[],
): Operation[] {
  const taskIds = new Set(snapshot.tasks.map((t) => t.id));
  const taskName = new Map(snapshot.tasks.map((t) => [t.id, t.name]));
  const listIds = new Set(snapshot.spaces.flatMap((s) => s.lists.map((l) => l.id)));
  const memberIds = new Set(snapshot.members.map((m) => m.id));
  const channelIds = new Map(channels.map((c) => [c.id, c.name]));

  const out: Operation[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const type = o.type as OpType;
    const summary = str(o.summary);
    if (!summary) continue;
    const base: Operation = { type, summary, reason: str(o.reason) };

    const needTask = () => {
      const id = str(o.taskId);
      if (!id || !taskIds.has(id)) return null;
      base.taskId = id;
      base.taskName = taskName.get(id);
      return id;
    };
    const cleanAssignees = () =>
      Array.isArray(o.assigneeIds)
        ? o.assigneeIds
            .map((x) => str(x))
            .filter((x): x is string => !!x && memberIds.has(x))
        : [];

    switch (type) {
      case "create_task": {
        const listId = str(o.listId);
        const name = str(o.name);
        if (!listId || !listIds.has(listId) || !name) continue;
        base.listId = listId;
        base.name = name;
        base.description = str(o.description);
        base.priority = validPriority(o.priority);
        base.dueInDays = validDays(o.dueInDays);
        base.assigneeIds = cleanAssignees();
        break;
      }
      case "set_status":
        if (!needTask() || !str(o.statusName)) continue;
        base.statusName = str(o.statusName);
        break;
      case "set_priority":
        if (!needTask() || !validPriority(o.priority)) continue;
        base.priority = validPriority(o.priority);
        break;
      case "set_due":
        if (!needTask()) continue;
        base.dueInDays = validDays(o.dueInDays);
        break;
      case "set_assignees": {
        if (!needTask()) continue;
        const a = cleanAssignees();
        if (a.length === 0) continue;
        base.assigneeIds = a;
        break;
      }
      case "add_comment":
        if (!needTask() || !str(o.body)) continue;
        base.body = str(o.body);
        break;
      case "post_message": {
        const cid = str(o.channelId);
        if (!cid || !channelIds.has(cid) || !str(o.body)) continue;
        base.channelId = cid;
        base.channelName = channelIds.get(cid);
        base.body = str(o.body);
        break;
      }
      default:
        continue;
    }
    out.push(base);
  }
  return out.slice(0, MAX_OPS);
}

function buildPrompt(
  command: string,
  snapshot: WorkspaceSnapshot,
  channels: { id: string; name: string }[],
): string {
  const parts: string[] = [`Command: ${command}`, ""];

  parts.push("Tasks (use taskId):");
  for (const t of snapshot.tasks) {
    const owners = t.assignees.length ? t.assignees.map((a) => a.name).join(", ") : "unassigned";
    const state = t.done ? "Done" : t.overdue ? "OVERDUE" : (t.status ?? "open");
    parts.push(
      `- taskId=${t.id} "${t.name}" — ${state} — owner: ${owners}` +
        (t.due ? ` — due ${t.due.slice(0, 10)}` : "") +
        ` — space "${t.spaceName}"`,
    );
  }

  parts.push("\nLists (use listId for create_task):");
  for (const s of snapshot.spaces) {
    for (const l of s.lists) parts.push(`- listId=${l.id} "${l.name}" (space "${s.name}")`);
  }

  parts.push("\nMembers (use for assigneeIds):");
  for (const m of snapshot.members) parts.push(`- memberId=${m.id} "${m.name}"`);

  if (channels.length) {
    parts.push("\nChannels (use channelId for post_message):");
    for (const c of channels) parts.push(`- channelId=${c.id} "#${c.name}"`);
  }

  parts.push(
    "\nReturn the operations. For set_status, give statusName (e.g. 'In Progress', 'Done'). " +
      "For due dates use dueInDays from today.",
  );
  return parts.join("\n");
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function validPriority(v: unknown): Operation["priority"] {
  return typeof v === "string" && PRIORITIES.has(v) ? (v as Operation["priority"]) : undefined;
}
function validDays(v: unknown): number | undefined {
  return typeof v === "number" && isFinite(v)
    ? Math.max(0, Math.min(365, Math.round(v)))
    : undefined;
}
function dueDate(days?: number): string | null {
  if (typeof days !== "number" || !isFinite(days)) return null;
  return new Date(Date.now() + days * 864e5).toISOString();
}
