"use client";

/**
 * TimelineView (Module 19) — a resource timeline: one horizontal swimlane per
 * assignee (plus an "Unassigned" lane), with each task drawn as a bar spanning
 * its start→due across a shared day grid. Where Gantt answers "how do these
 * tasks depend on each other over time", Timeline answers "who is working on
 * what, when" — the classic ClickUp Timeline. Read-only: click a bar to open
 * the task. A task with several assignees appears in each of their lanes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TimeScaleBar, dayWidth, useNarrow, useZoom } from "@/components/views/TimeScale";
import type { TaskCard, TaskUser } from "@/lib/api";
import { Avatar } from "@/components/Avatar";
import { addDays, atMidnight, dayKey, diffDays, startOfWeekMonday } from "@/lib/viewUtils";
import { MilestoneMark } from "@/components/TaskBits";
import type { ViewProps } from "@/components/views/types";

const DAY_W = 30;
const ROW_H = 44;
/** Vertical distance between stacked bars in one lane. */
const BAR_STEP = 32;
const laneHeight = (rows: number): number => Math.max(ROW_H, 14 + rows * BAR_STEP - 6);
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

type DragMode = "move" | "resize-l" | "resize-r";
interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  delta: number; // whole days
  moved: boolean;
}
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d: Date): string => `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;

export interface TimelineViewProps extends ViewProps {
  /** Save new start/due dates after a drag (optimistic in the shell). */
  onShiftDates?: (task: TaskCard, startDate: string | null, dueDate: string | null) => void;
}

export function TimelineView({ tasks, canEdit, onOpenTask, onShiftDates }: TimelineViewProps) {
  // Drag a bar to move it; drag either end to change start / due (like the
  // Gantt). A click without movement still opens the task.
  const canDrag = canEdit && !!onShiftDates;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [zoom, setZoom] = useZoom("timeline");
  const dayW = dayWidth(zoom, DAY_W);
  // Phones: a slimmer name rail leaves room for the chart.
  const railW = useNarrow() ? 112 : RAIL_W;
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
    // Stack overlapping bars into sub-rows (M6): first-fit by start date, so
    // tasks whose dates overlap never draw over each other.
    const arr = [...byUser.entries()].map(([key, v]) => {
      const sorted = [...v.tasks].sort(
        (a, b) => span(a)!.start.getTime() - span(b)!.start.getTime(),
      );
      const rowEnds: number[] = [];
      const rowOf = new Map<string, number>();
      for (const t of sorted) {
        const sp = span(t)!;
        let r = rowEnds.findIndex((end) => end < sp.start.getTime());
        if (r === -1) {
          r = rowEnds.length;
          rowEnds.push(0);
        }
        rowEnds[r] = sp.end.getTime();
        rowOf.set(t.id, r);
      }
      return { key, ...v, tasks: sorted, rowOf, rows: Math.max(1, rowEnds.length) };
    });
    arr.sort((a, b) => {
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      return (a.user?.fullName ?? "").localeCompare(b.user?.fullName ?? "");
    });
    return arr;
  }, [scheduled]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridW = days * dayW;

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

  // Open on today (it used to open weeks in the past), and keep today in view
  // when the zoom changes. The rail is inside the scroller, so subtract it.
  const scrollToToday = useCallback(
    (smooth = false) => {
      const el = scrollRef.current;
      if (!el || todayOffset < 0) return;
      const visible = el.clientWidth - railW;
      el.scrollTo({ left: Math.max(0, todayOffset * dayW - visible * 0.3), behavior: smooth ? "smooth" : "auto" });
    },
    [todayOffset, dayW, railW],
  );
  useEffect(() => {
    scrollToToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayW, railW, scheduled.length > 0]);

  const startDrag = (e: React.PointerEvent<HTMLElement>, task: TaskCard, mode: DragMode): void => {
    if (!canDrag) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const st: DragState = { taskId: task.id, mode, startX: e.clientX, delta: 0, moved: false };
    dragRef.current = st;
    setDrag(st);
  };
  const moveDrag = (e: React.PointerEvent<HTMLElement>): void => {
    const st = dragRef.current;
    if (!st) return;
    const px = e.clientX - st.startX;
    const delta = Math.round(px / dayW);
    const moved = st.moved || Math.abs(px) > 4;
    if (delta !== st.delta || moved !== st.moved) {
      const next = { ...st, delta, moved };
      dragRef.current = next;
      setDrag(next);
    }
  };
  /** The dates a task would get from the current drag. */
  const draggedDates = (t: TaskCard, st: DragState): { s: Date | null; d: Date | null } => {
    const s0 = parseDay(t.startDate);
    const d0 = parseDay(t.dueDate);
    if (st.mode === "move") {
      return { s: s0 ? addDays(s0, st.delta) : null, d: d0 ? addDays(d0, st.delta) : null };
    }
    if (st.mode === "resize-l" && s0 && d0) {
      const ns = addDays(s0, st.delta);
      return { s: ns > d0 ? d0 : ns, d: d0 };
    }
    if (st.mode === "resize-r" && s0 && d0) {
      const nd = addDays(d0, st.delta);
      return { s: s0, d: nd < s0 ? s0 : nd };
    }
    return { s: s0, d: d0 };
  };
  const endDrag = (task: TaskCard): void => {
    const st = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!st || st.taskId !== task.id) return;
    if (!st.moved) {
      onOpenTask(task.id);
      return;
    }
    if (st.delta === 0 || !onShiftDates) return;
    const { s, d } = draggedDates(task, st);
    onShiftDates(task, s ? dayKey(s) : null, d ? dayKey(d) : null);
  };

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
      <TimeScaleBar zoom={zoom} onZoom={setZoom} onToday={() => scrollToToday(true)} />
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-grid" style={{ width: railW + gridW }}>
          {/* Header: months + days */}
          <div className="tl-head" style={{ height: 46 }}>
            <div className="tl-rail tl-head-rail" style={{ width: railW }}>
              Assignee
            </div>
            <div className="tl-cols" style={{ width: gridW }}>
              <div className="tl-months">
                {months.map((m, i) => (
                  <div key={i} className="tl-month" style={{ width: m.span * dayW }}>
                    {m.span * dayW >= 56 ? m.label : ""}
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
                      style={{ width: dayW }}
                    >
                      {/* Weeks zoom: label Mondays only. */}
                      {zoom === "days" || d.getDay() === 1 ? d.getDate() : ""}
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
              style={{ left: railW + todayOffset * dayW + dayW / 2 }}
            />
          )}

          {/* Lanes */}
          {lanes.map((lane) => (
            <div className="tl-lane" key={lane.key} style={{ minHeight: laneHeight(lane.rows) }}>
              <div className="tl-rail" style={{ width: railW }}>
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
              <div className="tl-track" style={{ width: gridW, height: laneHeight(lane.rows) }}>
                {lane.tasks.map((t) => {
                  const sp = span(t)!;
                  const isDragging = drag?.taskId === t.id && drag.moved;
                  let from = sp.start;
                  let to = sp.end;
                  if (isDragging && drag) {
                    const dd = draggedDates(t, drag);
                    from = dd.s ?? dd.d ?? from;
                    to = dd.d ?? dd.s ?? to;
                    if (to < from) [from, to] = [to, from];
                  }
                  const offset = diffDays(rangeStart, from);
                  const len = diffDays(from, to) + 1;
                  const milestone = t.startDate == null && t.dueDate != null && len === 1;
                  const canResize = canDrag && t.startDate != null && t.dueDate != null;
                  const dateHint = len === 1 ? fmt(from) : `${fmt(from)} → ${fmt(to)}`;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      className={`tl-bar${canDrag ? " draggable" : ""}${isDragging ? " dragging" : ""}`}
                      title={`${t.name} — ${t.status.name}${canDrag ? " · drag to reschedule" : ""}`}
                      style={{
                        top: 7 + (lane.rowOf.get(t.id) ?? 0) * BAR_STEP,
                        left: offset * dayW + 2,
                        width: len * dayW - 4,
                        background: t.status.color,
                      }}
                      onPointerDown={canDrag ? (e) => startDrag(e, t, "move") : undefined}
                      onPointerMove={canDrag ? moveDrag : undefined}
                      onPointerUp={canDrag ? () => endDrag(t) : undefined}
                      onClick={canDrag ? undefined : () => onOpenTask(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenTask(t.id);
                        }
                      }}
                    >
                      {canResize && (
                        <span
                          className="tl-handle l"
                          onPointerDown={(e) => startDrag(e, t, "resize-l")}
                          onPointerMove={moveDrag}
                          onPointerUp={() => endDrag(t)}
                        />
                      )}
                      {milestone && <MilestoneMark size={12} />}
                      <span className="tl-bar-label">{isDragging ? dateHint : t.name}</span>
                      {canResize && (
                        <span
                          className="tl-handle r"
                          onPointerDown={(e) => startDrag(e, t, "resize-r")}
                          onPointerMove={moveDrag}
                          onPointerUp={() => endDrag(t)}
                        />
                      )}
                    </div>
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
