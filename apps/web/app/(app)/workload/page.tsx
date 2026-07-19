"use client";

/**
 * Workload (Module 8) — ClickUp-style team capacity for one week.
 *
 * One row per member: avatar + name, a horizontal capacity bar comparing
 * assigned estimate against weekly capacity (green under 70%, amber
 * 70–100%, red over), a thin secondary bar for tracked time, and an
 * expandable list of the member's tasks for the week (name → list link,
 * estimate, due day). Week navigation matches the Timesheet page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, timeApi, type WorkloadMember, type WorkloadWeek } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { WeekNav } from "@/components/WeekNav";
import {
  colorFor,
  formatDueDate,
  formatDuration,
  formatHours,
  initials,
  mondayOf,
} from "@/lib/format";

/** green <70% · amber 70–100% · red >100% of capacity. */
function loadClass(assigned: number, capacity: number): string {
  if (capacity <= 0) return assigned > 0 ? "over" : "ok";
  const ratio = assigned / capacity;
  if (ratio > 1) return "over";
  if (ratio >= 0.7) return "warm";
  return "ok";
}

function MemberRow({ member }: { member: WorkloadMember }) {
  const [open, setOpen] = useState(false);
  const { user, capacitySeconds, assignedSeconds, trackedSeconds, tasks } = member;

  const cls = loadClass(assignedSeconds, capacitySeconds);
  const assignedPct =
    capacitySeconds > 0
      ? Math.min(100, (assignedSeconds / capacitySeconds) * 100)
      : assignedSeconds > 0
        ? 100
        : 0;
  const trackedPct =
    capacitySeconds > 0 ? Math.min(100, (trackedSeconds / capacitySeconds) * 100) : 0;

  return (
    <div className={`wl-row${open ? " open" : ""}`}>
      <button
        type="button"
        className="wl-row-main"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`wl-caret${open ? " open" : ""}`}>{Icons.chevronRight}</span>
        <span className="avatar avatar-sm" style={{ background: colorFor(user.id) }}>
          {initials(user.fullName)}
        </span>
        <span className="wl-name">{user.fullName}</span>

        <span className="wl-bars">
          <span
            className={`wl-bar ${cls}`}
            title={`Assigned ${formatHours(assignedSeconds)} of ${formatHours(capacitySeconds)} capacity`}
          >
            <span className="wl-bar-fill" style={{ width: `${assignedPct}%` }} />
          </span>
          <span
            className="wl-bar wl-bar-tracked"
            title={`Tracked ${formatHours(trackedSeconds)}`}
          >
            <span className="wl-bar-fill" style={{ width: `${trackedPct}%` }} />
          </span>
        </span>

        <span className={`wl-label ${cls}`}>
          {formatHours(assignedSeconds)} / {formatHours(capacitySeconds)}
        </span>
        <span className="wl-tracked-label" title="Tracked this week">
          {Icons.timer}
          {formatHours(trackedSeconds)}
        </span>
      </button>

      {open && (
        <div className="wl-tasks">
          {tasks.length === 0 ? (
            <div className="tp-empty tp-empty-pad">No tasks scheduled this week.</div>
          ) : (
            tasks.map((t) => (
              <div className="wl-task" key={t.id}>
                <Link
                  href={`/list?id=${t.listId}&task=${t.id}`}
                  className="wl-task-name"
                >
                  {t.name}
                </Link>
                <span className="wl-task-meta">
                  {t.estimateSeconds !== null && t.estimateSeconds > 0 && (
                    <span className="task-count" title="Estimate">
                      {Icons.clock}
                      {formatDuration(t.estimateSeconds)}
                    </span>
                  )}
                  {t.dueDate && (
                    <span className="task-count" title="Due">
                      {Icons.calendar}
                      {formatDueDate(t.dueDate)}
                    </span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkloadPage() {
  const [weekStart, setWeekStart] = useState("");
  const [week, setWeek] = useState<WorkloadWeek | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setWeekStart(mondayOf(new Date()));
  }, []);

  const load = (ws: string): void => {
    timeApi
      .workload(ws)
      .then((r) => {
        setWeek(r);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the workload."),
      );
  };

  useEffect(() => {
    if (!weekStart) return;
    setWeek(null);
    load(weekStart);
  }, [weekStart]);

  useRealtime(
    (e) => {
      if ((e.type === "time.changed" || e.type === "task.changed") && weekStart) {
        load(weekStart);
      }
    },
    [weekStart],
  );

  return (
    <div className="page page-wide">
      <div className="page-head page-head-row">
        <div>
          <h1>Workload</h1>
          <p className="sub">Who has capacity this week — assigned vs. tracked.</p>
        </div>
        {weekStart && <WeekNav weekStart={weekStart} onChange={setWeekStart} />}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="wl-legend">
        <span className="wl-legend-item">
          <span className="wl-legend-swatch ok" /> Under 70%
        </span>
        <span className="wl-legend-item">
          <span className="wl-legend-swatch warm" /> 70–100%
        </span>
        <span className="wl-legend-item">
          <span className="wl-legend-swatch over" /> Overloaded
        </span>
        <span className="wl-legend-item">
          <span className="wl-legend-swatch tracked" /> Tracked
        </span>
      </div>

      <div className="card wl-card">
        {week === null ? (
          <>
            <span className="skel" style={{ width: "100%", height: 56, marginBottom: 8 }} />
            <span className="skel" style={{ width: "100%", height: 56, marginBottom: 8 }} />
            <span className="skel" style={{ width: "100%", height: 56 }} />
          </>
        ) : week.members.length === 0 ? (
          <div className="empty-state">
            <span className="empty-ic">{Icons.workload}</span>
            <h3>No members to plan</h3>
            <p>Invite teammates and assign estimated tasks to see capacity here.</p>
          </div>
        ) : (
          week.members.map((m) => <MemberRow key={m.user.id} member={m} />)
        )}
      </div>
    </div>
  );
}
