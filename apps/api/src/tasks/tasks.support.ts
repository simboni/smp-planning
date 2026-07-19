import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import {
  AccessService,
  Permission,
  permAtLeast,
} from "../access/access.service";

/**
 * Shared building blocks for the Tasks module: permission gates keyed off the
 * owning Space (reusing AccessService), plus small validators. Every Tasks
 * service funnels its space checks through here so visibility (404) and
 * write-gating (403) can never diverge across statuses / tags / tasks /
 * checklists.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Default statuses provisioned for a Space that has none (ClickUp-style). */
export const DEFAULT_STATUSES = [
  { name: "To Do", color: "#8A8F98", type: "not_started", position: 0 },
  { name: "In Progress", color: "#7B68EE", type: "active", position: 1 },
  { name: "Complete", color: "#22C55E", type: "done", position: 2 },
] as const;

/**
 * Resolve the caller's permission on a space; a space the caller cannot see
 * reads as 'none' -> 404 (never leak its existence). Returns the permission.
 */
export async function requireSpaceVisible(
  access: AccessService,
  client: PoolClient,
  userId: string,
  role: Role,
  spaceId: string,
): Promise<Permission> {
  const perm = await access.spacePermission(client, userId, role, spaceId);
  if (perm === "none") throw new NotFoundException("Not found");
  return perm;
}

/** Require >= edit on the space (404 if not visible, 403 if too weak). */
export async function requireSpaceEdit(
  access: AccessService,
  client: PoolClient,
  userId: string,
  role: Role,
  spaceId: string,
): Promise<void> {
  const perm = await requireSpaceVisible(access, client, userId, role, spaceId);
  if (!permAtLeast(perm, "edit")) {
    throw new ForbiddenException("You need edit access on this space");
  }
}

export function requireName(name: unknown, label = "name"): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new BadRequestException(`${label} is required`);
  }
  return name.trim();
}

export function optionalName(name: unknown, label = "name"): string | undefined {
  if (name === undefined) return undefined;
  return requireName(name, label);
}

export function validColor(color: unknown, field = "color"): string {
  if (typeof color !== "string" || !HEX_COLOR.test(color)) {
    throw new BadRequestException(`${field} must be a hex color like #7B68EE`);
  }
  return color;
}

export function validStatusType(type: unknown): "not_started" | "active" | "done" {
  if (type !== "not_started" && type !== "active" && type !== "done") {
    throw new BadRequestException(
      "type must be one of not_started, active, done",
    );
  }
  return type;
}

/** Priority must be in the allowed set or null. Returns the value or null. */
export function validPriority(p: unknown): Priority | null {
  if (p === undefined || p === null) return null;
  if (!PRIORITIES.includes(p as Priority)) {
    throw new BadRequestException(
      "priority must be one of urgent, high, normal, low or null",
    );
  }
  return p as Priority;
}

/** Parse a client date to a value pg accepts as timestamptz, or null. */
export function parseDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`${field} must be an ISO date string`);
  }
  return value;
}

export function assertIdArray(ids: unknown): asserts ids is string[] {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    throw new BadRequestException("ids must be an array of strings");
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Require a well-formed uuid (guards raw ids that reach SQL casts). */
export function requireUuid(v: unknown, label: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new BadRequestException(`${label} must be a uuid`);
  }
  return v.toLowerCase();
}

// --- Recurrence (M4) --------------------------------------------------------

export const RECURRENCE_FREQS = ["daily", "weekly", "monthly"] as const;

export interface RecurrenceRule {
  freq: (typeof RECURRENCE_FREQS)[number];
  interval: number;
  mode: "on_complete";
}

/**
 * Validate a recurrence rule `{freq,interval,mode:'on_complete'}` (M4 supports
 * only on_complete). Returns the normalized rule, or null to clear.
 */
export function validRecurrence(v: unknown): RecurrenceRule | null {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new BadRequestException("recurrence must be an object or null");
  }
  const r = v as Record<string, unknown>;
  if (!RECURRENCE_FREQS.includes(r.freq as RecurrenceRule["freq"])) {
    throw new BadRequestException(
      "recurrence.freq must be one of daily, weekly, monthly",
    );
  }
  if (
    typeof r.interval !== "number" ||
    !Number.isInteger(r.interval) ||
    r.interval < 1
  ) {
    throw new BadRequestException("recurrence.interval must be an integer >= 1");
  }
  if (r.mode !== "on_complete") {
    throw new BadRequestException("recurrence.mode must be 'on_complete'");
  }
  return {
    freq: r.freq as RecurrenceRule["freq"],
    interval: r.interval,
    mode: "on_complete",
  };
}

/** Advance a date by one recurrence step (daily/weekly in days, monthly in months). */
export function advanceByRule(base: Date, rule: RecurrenceRule): Date {
  const d = new Date(base.getTime());
  if (rule.freq === "daily") d.setUTCDate(d.getUTCDate() + rule.interval);
  else if (rule.freq === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7 * rule.interval);
  } else d.setUTCMonth(d.getUTCMonth() + rule.interval);
  return d;
}
