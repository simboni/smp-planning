"use client";

/**
 * TimelineView (Module 19) — a resource timeline: one horizontal swimlane per
 * assignee (plus an "Unassigned" lane), with each task drawn as a bar spanning
 * its start→due across a shared day grid. Where Gantt answers "how do these
 * tasks depend on each other over time", Timeline answers "who is working on
 * what, when" — the classic ClickUp Timeline. Read-only: click a bar to open
 * the task. A task with several assignees appears in each of their lanes.
 */

import { useMemo, useRef } from "react";
import type { TaskCard, TaskUser } from "@/lib/api";
import { Avatar } from "@/components/Avatar";
import { addDays, atMidnight, diffDays, startOfWeekMonday } from "@/lib/viewUtils";
import { MilestoneMark } from "@/components/TaskBits";
import type { ViewProps } from "@/components/views/types";

const DAY_W = 30;
const ROW_H = 44;
const RAIL_W = 180;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDay(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : atMidnight(d);
}

/** A task's [start, end] as midnight dates; a one-ended task spans a single day. */
function span(t: TaskCard): { start: Date; end: Date } | null {
  const s = parseDay(t.startDate);
  const e = parseDay(t.dueDate);
  if (!s && !e) return null;
  const start = s ?? (e as Date);
  const end = e ?? (s as Date);
  return end < start ? { start: end, end: start } : { start, end };
}

const UNASSIGNED = "__unassigned__";

export function TimelineView({ tasks, canEdit: _canEdit, onOpenTask }: ViewProps) {
  const scheduled = useMemo(() => tasks.filter((t) => span(t)), [tasks]);
  const unscheduled = useMemo(() => tasks.filter((t) => !span(t)), [tasks]);

  const today = atMidnight(new Date());

  // Grid range: a week before the earliest date (or 2 weeks ago) to the latest
  // (or 6 weeks out), snapped to whole weeks so month headers align.
  const { rangeStart, days } = useMemo(() => {
    let min = addDays(today, -14);
    let max = addDays(today, 42);
    for (const t of scheduled) {
      const sp = span(t)!;
      if (sp.start < min) min = sp.start;
      if (sp.end > max) max = sp.end;
    }
    const start = startOfWeekMonday(addDays(min, -3));
    const end = addDays(startOfWeekMonday(addDays(max, 7)), 6);
    // diffDays(a, b) = b − a, so pass the earlier date first.
    return { rangeStart: start, days: diffDays(start, end) + 1 };
  }, [scheduled, today]);

  // Lanes: assignee -> their scheduled tasks. Unassigned collects the rest.
  const lanes = useMemo(() => {
    const byUser = new Map<string, { user: TaskUser | null; tasks: TaskCard[] }>();
    const ensure = (key: string, user: TaskUser | null) => {
      if (!byUser.has(key)) byUser.set(key, { user, tasks: [] });
      return byUser.get(key)!;
    };
    for (const t of scheduled) {
      if (t.assignees.length === 0) {
        ensure(UNASSIGNED, null).tasks.push(t);
      } else {
        for (const a of t.assignees) ensure(a.id, a).tasks.push(t);
      }
    }
    const arr = [...byUser.entries()].map(([key, v]) => ({ key, ...v }));
    arr.sort((a, b) => {
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      return (a.user?.fullName ?? "").localeCompare(b.user?.fullName ?? "");
    });
    return arr;
  }, [scheduled]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridW = days * DAY_W;

  // Month header segments across the range.
  const months = useMemo(() => {
    const segs: { label: string; span: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(rangeStart, i);
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const last = segs[segs.length - 1];
      if (last && last.label === label) last.span += 1;
      else segs.push({ label, span: 1 });
    }
    return segs;
  }, [rangeStart, days]);

  const todayOffset = diffDays(rangeStart, today);

  if (scheduled.length === 0) {
    return (
      <div className="empty-hint" style={{ textAlign: "center" }}>
        No scheduled tasks yet. Give tasks a start or due date to see them on the
        timeline.
        {unscheduled.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {unscheduled.length} unscheduled task{unscheduled.length === 1 ? "" : "s"}.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tl-wrap">
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-grid" style={{ width: RAIL_W + gridW }}>
          {/* Header: months + days */}
          <div className="tl-head" style={{ height: 46 }}>
            <div className="tl-rail tl-head-rail" style={{ width: RAIL_W }}>
              Assignee
            </div>
            <div className="tl-cols" style={{ width: gridW }}>
              <div className="tl-months">
                {months.map((m, i) => (
                  <div key={i} className="tl-month" style={{ width: m.span * DAY_W }}>
                    {m.label}
                  </div>
                ))}
              </div>
              <div className="tl-days">
                {Array.from({ length: days }, (_, i) => {
                  const d = addDays(rangeStart, i);
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  const isToday = i === todayOffset;
                  return (
                    <div
                      key={i}
                      className={`tl-day${weekend ? " weekend" : ""}${isToday ? " today" : ""}`}
                      style={{ width: DAY_W }}
                    >
                      {d.getDate()}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Today marker line */}
          {todayOffset >= 0 && todayOffset < days && (
            <div
              className="tl-today-line"
              style={{ left: RAIL_W + todayOffset * DAY_W + DAY_W / 2 }}
            />
          )}

          {/* Lanes */}
          {lanes.map((lane) => (
            <div className="tl-lane" key={lane.key} style={{ minHeight: ROW_H }}>
              <div className="tl-rail" style={{ width: RAIL_W }}>
                {lane.user ? (
                  <>
                    <Avatar
                      name={lane.user.fullName}
                      id={lane.user.id}
                      avatarUrl={lane.user.avatarUrl}
                      className="tl-av"
                    />
                    <span className="tl-rail-name">{lane.user.fullName}</span>
                  </>
                ) : (
                  <>
                    <span className="tl-av tl-av-none">?</span>
                    <span className="tl-rail-name">Unassigned</span>
                  </>
                )}
                <span className="tl-rail-count">{lane.tasks.length}</span>
              </div>
              <div className="tl-track" style={{ width: gridW }}>
                {lane.tasks.map((t) => {
                  const sp = span(t)!;
                  const offset = diffDays(rangeStart, sp.start);
                  const len = diffDays(sp.start, sp.end) + 1;
                  const milestone = t.startDate == null && t.dueDate != null && len === 1;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="tl-bar"
                      title={`${t.name} — ${t.status.name}`}
                      style={{
                        left: offset * DAY_W + 2,
                        width: len * DAY_W - 4,
                        background: t.status.color,
                      }}
                      onClick={() => onOpenTask(t.id)}
                    >
                      {milestone && <MilestoneMark size={12} />}
                      <span className="tl-bar-label">{t.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="tl-unscheduled">
          {unscheduled.length} unscheduled task{unscheduled.length === 1 ? "" : "s"} not
          shown — add a start or due date to place them.
        </div>
      )}
    </div>
  );
}
