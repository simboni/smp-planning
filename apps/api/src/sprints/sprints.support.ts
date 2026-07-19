import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";

/**
 * Shared sprint math (Module 10). Pure helpers + small batched queries used
 * by BOTH SprintsService (the /sprints/:id/report endpoint) and
 * DashboardsService (the sprintBurndown card), so the burndown/velocity
 * numbers can never diverge between the two surfaces.
 */

export interface BurndownDay {
  date: string;
  /** Points still open at end of this day; null for days after today. */
  remainingPoints: number | null;
  idealRemaining: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Require a 'YYYY-MM-DD' calendar date (also accepts a full ISO string). */
export function validDateOnly(v: unknown, field: string): string {
  if (typeof v === "string") {
    const day = v.length > 10 ? v.slice(0, 10) : v;
    if (DATE_ONLY.test(day) && !Number.isNaN(Date.parse(day))) return day;
  }
  throw new BadRequestException(`${field} must be a date like 2026-07-19`);
}

/** Today's date in UTC as 'YYYY-MM-DD' (the DB runs in UTC too). */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Every date from start..end inclusive as 'YYYY-MM-DD' strings. */
export function eachDate(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (
    let t = Date.parse(`${startDate}T00:00:00Z`);
    t <= end;
    t += 24 * 60 * 60 * 1000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Batched per-list points rollup over NON-ARCHIVED tasks (NULL points = 0):
 * total = sum of all sprint_points; completed = the completed_at slice.
 */
export async function sprintPointsForLists(
  client: PoolClient,
  listIds: string[],
): Promise<Map<string, { total: number; completed: number }>> {
  const map = new Map<string, { total: number; completed: number }>();
  if (listIds.length === 0) return map;
  const res = await client.query(
    `SELECT list_id,
            COALESCE(SUM(COALESCE(sprint_points, 0)), 0)::int AS total,
            COALESCE(SUM(COALESCE(sprint_points, 0))
              FILTER (WHERE completed_at IS NOT NULL), 0)::int AS completed
     FROM tasks
     WHERE archived = false AND list_id = ANY($1::uuid[])
     GROUP BY list_id`,
    [listIds],
  );
  for (const r of res.rows) {
    map.set(r.list_id as string, {
      total: r.total as number,
      completed: r.completed as number,
    });
  }
  return map;
}

/** Points completed per calendar day ('YYYY-MM-DD' -> points) for one list. */
export async function completedPointsByDay(
  client: PoolClient,
  listId: string,
): Promise<Map<string, number>> {
  const res = await client.query(
    `SELECT completed_at::date::text AS day,
            SUM(COALESCE(sprint_points, 0))::int AS pts
     FROM tasks
     WHERE archived = false AND list_id = $1 AND completed_at IS NOT NULL
     GROUP BY 1`,
    [listId],
  );
  const map = new Map<string, number>();
  for (const r of res.rows) map.set(r.day as string, r.pts as number);
  return map;
}

/**
 * Burndown series for start..end (inclusive):
 *  - remainingPoints on day D = totalPoints - points completed on any date
 *    <= D (completions before the window count against the first day);
 *  - idealRemaining falls linearly from totalPoints to 0 across the window;
 *  - days after `today` get remainingPoints null so charts stop there.
 */
export function computeBurndown(
  totalPoints: number,
  byDay: Map<string, number>,
  startDate: string,
  endDate: string,
  today: string = utcToday(),
): BurndownDay[] {
  const dates = eachDate(startDate, endDate);
  // Completions strictly before the window already count on day one.
  let done = 0;
  for (const [day, pts] of byDay) if (day < startDate) done += pts;
  const n = dates.length;
  return dates.map((date, i) => {
    done += byDay.get(date) ?? 0;
    return {
      date,
      remainingPoints: date > today ? null : Math.max(0, totalPoints - done),
      idealRemaining: n > 1 ? (totalPoints * (n - 1 - i)) / (n - 1) : 0,
    };
  });
}
