import { BadRequestException } from "@nestjs/common";

/**
 * Shared helpers for Module 8 (Time tracking, Timesheets & Workload): week
 * handling is UTC-only and Monday-anchored — a `weekStart` is always a plain
 * `YYYY-MM-DD` string naming a Monday, and all day-bucketing of timestamps
 * happens at UTC so the API is deterministic regardless of server timezone.
 */

/** Hard cap for a single (manual or edited) entry: 24 hours. */
export const MAX_ENTRY_SECONDS = 24 * 60 * 60;

/** Fixed per-member weekly capacity for the workload view: 8h x 5 days. */
export const WEEK_CAPACITY_SECONDS = 8 * 60 * 60 * 5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate `weekStart`: a well-formed YYYY-MM-DD that falls on a Monday. */
export function requireMonday(v: unknown): string {
  if (typeof v !== "string" || !DATE_RE.test(v)) {
    throw new BadRequestException("weekStart must be a YYYY-MM-DD date");
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new BadRequestException("weekStart must be a valid date");
  }
  if (d.getUTCDay() !== 1) {
    throw new BadRequestException("weekStart must be a Monday");
  }
  return v;
}

/** The 7 dates (YYYY-MM-DD) of the week starting at `weekStart`. */
export function weekDays(weekStart: string): string[] {
  const base = new Date(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** note is optional; when present it must be a string (stored verbatim). */
export function validNote(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") {
    throw new BadRequestException("note must be a string");
  }
  return v;
}

/** billable is optional; when present it must be a boolean. */
export function validBillable(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") {
    throw new BadRequestException("billable must be a boolean");
  }
  return v;
}
