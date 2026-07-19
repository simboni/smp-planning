"use client";

/**
 * WeekNav (Module 8) — ‹ Today › week switcher shared by the Timesheet
 * and Workload pages. Weeks are Monday-start YYYY-MM-DD strings.
 */

import { Icons } from "@/components/icons";
import { formatWeekRange, mondayOf, shiftYmd } from "@/lib/format";

export function WeekNav({
  weekStart,
  onChange,
}: {
  weekStart: string;
  onChange: (weekStart: string) => void;
}) {
  const thisWeek = mondayOf(new Date());
  return (
    <div className="week-nav" role="group" aria-label="Week">
      <button
        type="button"
        className="icon-btn"
        aria-label="Previous week"
        onClick={() => onChange(shiftYmd(weekStart, -7))}
      >
        {Icons.chevronLeft}
      </button>
      <button
        type="button"
        className={`btn btn-ghost btn-sm week-nav-today${weekStart === thisWeek ? " on" : ""}`}
        onClick={() => onChange(thisWeek)}
      >
        Today
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Next week"
        onClick={() => onChange(shiftYmd(weekStart, 7))}
      >
        {Icons.chevronRight}
      </button>
      <span className="week-nav-range">{formatWeekRange(weekStart)}</span>
    </div>
  );
}
