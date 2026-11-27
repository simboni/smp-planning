/**
 * One definition of "overdue" for the whole API (Copilot, My Work, goals,
 * dashboards, automations). Due dates are calendar days — a task due today is
 * NOT overdue until today is over — judged in the workspace's timezone, and a
 * task in a done status is never overdue.
 *
 * Date-only due dates are stored as midnight UTC; reading them in a timezone
 * east of UTC (Nairobi is UTC+3) keeps the same calendar day.
 */
const TZ_RE = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)*$/;
function pickTimezone(): string {
  const tz = process.env.APP_TIMEZONE || "Africa/Nairobi";
  try {
    if (!TZ_RE.test(tz)) throw new Error("bad tz");
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "Africa/Nairobi";
  }
}
export const APP_TIMEZONE = pickTimezone();

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" of an instant, in the app timezone. */
export function localDateKey(at: Date | string | number = new Date()): string {
  return dayFmt.format(new Date(at));
}

/** `key` moved by `days` calendar days ("YYYY-MM-DD" in, "YYYY-MM-DD" out). */
export function shiftDateKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Overdue = an open task whose due day is before today. */
export function isOverdue(
  due: Date | string | null | undefined,
  done: boolean,
  now: Date = new Date(),
): boolean {
  if (!due || done) return false;
  return localDateKey(due) < localDateKey(now);
}

/** Weekday name of today in the app timezone (for Copilot's date line). */
export function localWeekday(at: Date = new Date()): string {
  return at.toLocaleDateString("en-US", { weekday: "long", timeZone: APP_TIMEZONE });
}

/**
 * SQL: the due day of `col` is before today (both in the app timezone). Pair
 * it with a "not done" condition. The timezone is validated above, so it is
 * safe to inline.
 */
export function sqlDueBeforeToday(col: string): string {
  return `(${col} AT TIME ZONE '${APP_TIMEZONE}')::date < (now() AT TIME ZONE '${APP_TIMEZONE}')::date`;
}
