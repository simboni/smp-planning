import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { PRIORITIES, Priority, requireUuid } from "../tasks/tasks.support";

/**
 * Module 11 Automations: trigger/action schemas stored in jsonb, plus their
 * save-time validators. References (statusId/userId/tagId) are checked to
 * belong to the automation's space / workspace at rule save; the engine
 * re-guards at execution time since referents can vanish later.
 */

export const TRIGGER_TYPES = [
  "task.created",
  "status.changed",
  "priority.changed",
  "assignee.added",
  "due.overdue",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export interface AutomationTrigger {
  type: TriggerType;
  /** status.changed only: fire only when moving INTO this status. */
  toStatusId?: string;
  /** priority.changed only: fire only when changing TO this priority. */
  toPriority?: Priority;
}

export const ACTION_TYPES = [
  "set.status",
  "set.priority",
  "add.assignee",
  "add.tag",
  "post.comment",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface AutomationAction {
  type: ActionType;
  statusId?: string;
  priority?: Priority;
  userId?: string;
  tagId?: string;
  body?: string;
}

const MAX_ACTIONS = 10;
const MAX_COMMENT_LEN = 4000;

async function assertStatusInSpace(
  client: PoolClient,
  statusId: string,
  spaceId: string,
): Promise<void> {
  const res = await client.query(
    `SELECT 1 FROM statuses WHERE id = $1 AND space_id = $2`,
    [statusId, spaceId],
  );
  if (!res.rows[0]) {
    throw new BadRequestException(
      "statusId must reference a status in this space",
    );
  }
}

function requirePriority(v: unknown, label: string): Priority {
  if (!PRIORITIES.includes(v as Priority)) {
    throw new BadRequestException(
      `${label} must be one of ${PRIORITIES.join(", ")}`,
    );
  }
  return v as Priority;
}

/** Validate + normalize a trigger against the automation's space. */
export async function validateTrigger(
  client: PoolClient,
  spaceId: string,
  input: unknown,
): Promise<AutomationTrigger> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new BadRequestException("trigger must be an object");
  }
  const t = input as Record<string, unknown>;
  if (!TRIGGER_TYPES.includes(t.type as TriggerType)) {
    throw new BadRequestException(
      `trigger.type must be one of ${TRIGGER_TYPES.join(", ")}`,
    );
  }
  const out: AutomationTrigger = { type: t.type as TriggerType };
  if (out.type === "status.changed" && t.toStatusId !== undefined && t.toStatusId !== null) {
    const statusId = requireUuid(t.toStatusId, "trigger.toStatusId");
    await assertStatusInSpace(client, statusId, spaceId);
    out.toStatusId = statusId;
  }
  if (out.type === "priority.changed" && t.toPriority !== undefined && t.toPriority !== null) {
    out.toPriority = requirePriority(t.toPriority, "trigger.toPriority");
  }
  return out;
}

/** Validate + normalize the actions array against the automation's space. */
export async function validateActions(
  client: PoolClient,
  spaceId: string,
  input: unknown,
): Promise<AutomationAction[]> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestException("actions must be a non-empty array");
  }
  if (input.length > MAX_ACTIONS) {
    throw new BadRequestException(`actions is limited to ${MAX_ACTIONS}`);
  }
  const actions: AutomationAction[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new BadRequestException("each action must be an object");
    }
    const a = raw as Record<string, unknown>;
    switch (a.type as ActionType) {
      case "set.status": {
        const statusId = requireUuid(a.statusId, "action.statusId");
        await assertStatusInSpace(client, statusId, spaceId);
        actions.push({ type: "set.status", statusId });
        break;
      }
      case "set.priority":
        actions.push({
          type: "set.priority",
          priority: requirePriority(a.priority, "action.priority"),
        });
        break;
      case "add.assignee": {
        const userId = requireUuid(a.userId, "action.userId");
        const m = await client.query(
          `SELECT 1 FROM memberships WHERE user_id = $1`,
          [userId],
        );
        if (!m.rows[0]) {
          throw new BadRequestException(
            "action.userId must be a member of this workspace",
          );
        }
        actions.push({ type: "add.assignee", userId });
        break;
      }
      case "add.tag": {
        const tagId = requireUuid(a.tagId, "action.tagId");
        const tag = await client.query(
          `SELECT 1 FROM tags WHERE id = $1 AND space_id = $2`,
          [tagId, spaceId],
        );
        if (!tag.rows[0]) {
          throw new BadRequestException(
            "action.tagId must reference a tag in this space",
          );
        }
        actions.push({ type: "add.tag", tagId });
        break;
      }
      case "post.comment": {
        if (typeof a.body !== "string" || !a.body.trim()) {
          throw new BadRequestException("action.body is required");
        }
        if (a.body.length > MAX_COMMENT_LEN) {
          throw new BadRequestException(
            `action.body is limited to ${MAX_COMMENT_LEN} characters`,
          );
        }
        actions.push({ type: "post.comment", body: a.body.trim() });
        break;
      }
      default:
        throw new BadRequestException(
          `action.type must be one of ${ACTION_TYPES.join(", ")}`,
        );
    }
  }
  return actions;
}
