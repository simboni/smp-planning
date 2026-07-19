"use client";

/**
 * GanttView (Module 5) — a day-grid timeline. Left rail lists task names;
 * the right side scrolls horizontally across a range spanning from two
 * weeks before today (or the earliest task date) to eight weeks after (or
 * the latest). Bars use the status color; milestones render as diamonds on
 * their due date. Bars can be dragged to shift both dates and their edges
 * resized (pointer events → optimistic PATCH). Dependency arrows are
 * future work (Module 6+).
 */

import { useMemo, useRef, useState } from "react";
import type { TaskCard } from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { addDays, atMidnight, dayKey, diffDays, startOfWeekMonday } from "@/lib/viewUtils";
import { MilestoneMark, PriorityFlag } from "@/components/TaskBits";
import type { ViewProps } from "@/components/views/types";

export interface GanttViewProps extends ViewProps {
  /** PATCH start/due after a drag (optimistic in the shell). */
  onShiftDates: (task: TaskCard, startDate: string | null, dueDate: string | null) => void;
}

const DAY_W = 28;
const ROW_H = 40;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type DragMode = "move" | "resize-l" | "resize-r";

interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  delta: number; // whole days
  moved: boolean;
}

function parseDay(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : atMidnight(d);
}

export function GanttView({ tasks, canEdit, onOpenTask, onShiftDates }: GanttViewProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const scheduled = useMemo(
    () => tasks.filter((t) => parseDay(t.startDate) || parseDay(t.dueDate)),
    [tasks],
  );
  const unscheduled = useMemo(
    () => tasks.filter((t) => !parseDay(t.startDate) && !parseDay(t.dueDate)),
    [tasks],
  );

  const today = atMidnight(new Date());

  const { rangeStart, totalDays, months } = useMemo(() => {
    let min = addDays(today, -14);
    let max = addDays(today, 56);
    for (const t of scheduled) {
      const s = parseDay(t.startDate);
      const d = parseDay(t.dueDate);
      if (s && s < min) min = s;
      if (d && d < min) min = d;
      if (s && s > max) max = s;
      if (d && d > max) max = d;
    }
    const start = startOfWeekMonday(addDays(min, -2));
    const end = addDays(max, 7);
    const total = diffDays(start, end) + 1;
    // Month header segments.
    const segs: { label: string; days: number }[] = [];
    for (let i = 0; i < total; i++) {
      const d = addDays(start, i);
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const last = segs[segs.length - 1];
      if (last && last.label === label) last.days++;
      else segs.push({ label, days: 1 });
    }
    return { rangeStart: start, totalDays: total, months: segs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduled]);

  const todayIdx = diffDays(rangeStart, today);
  const chartW = totalDays * DAY_W;

  const startDrag = (
    e: React.PointerEvent<HTMLElement>,
    task: TaskCard,
    mode: DragMode,
  ): void => {
    if (!canEdit) return;
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
    const delta = Math.round(px / DAY_W);
    const moved = st.moved || Math.abs(px) > 4;
    if (delta !== st.delta || moved !== st.moved) {
      const next = { ...st, delta, moved };
      dragRef.current = next;
      setDrag(next);
    }
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
    if (st.delta === 0) return;
    const s = parseDay(task.startDate);
    const d = parseDay(task.dueDate);
    let ns = s;
    let nd = d;
    if (st.mode === "move") {
      ns = s ? addDays(s, st.delta) : null;
      nd = d ? addDays(d, st.delta) : null;
    } else if (st.mode === "resize-l" && s && d) {
      ns = addDays(s, st.delta);
      if (ns > d) ns = d;
    } else if (st.mode === "resize-r" && s && d) {
      nd = addDays(d, st.delta);
      if (nd < s) nd = s;
    }
    onShiftDates(task, ns ? dayKey(ns) : null, nd ? dayKey(nd) : null);
  };

  return (
    <div className="gantt">
      <div className="gantt-main">
        {/* left rail */}
        <div className="gantt-rail">
          <div className="gantt-rail-head">Task</div>
          {scheduled.map((t) => (
            <button
              key={t.id}
              type="button"
              className="gantt-rail-row"
              onClick={() => onOpenTask(t.id)}
              title={t.name}
            >
              <span
                className="status-dot"
                style={{ background: t.status.color || colorFor(t.statusId) }}
              />
              {t.isMilestone && <MilestoneMark size={11} />}
              <span className="gantt-rail-name">{t.name}</span>
              <PriorityFlag priority={t.priority} />
            </button>
          ))}
          {scheduled.length === 0 && <div className="gantt-rail-row empty">No scheduled tasks</div>}
        </div>

        {/* timeline */}
        <div className="gantt-scroll">
          <div className="gantt-chart" style={{ width: chartW }}>
            <div className="gantt-months">
              {months.map((m, i) => (
                <span key={i} className="gantt-month" style={{ width: m.days * DAY_W }}>
                  {m.days >= 3 ? m.label : ""}
                </span>
              ))}
            </div>
            <div className="gantt-days">
              {Array.from({ length: totalDays }, (_, i) => {
                const d = addDays(rangeStart, i);
                return (
                  <span
                    key={i}
                    className={`gantt-day${i % 7 >= 5 ? " weekend" : ""}${i === todayIdx ? " today" : ""}`}
                  >
                    {d.getDate()}
                  </span>
                );
              })}
            </div>

            <div
              className="gantt-rows"
              style={{ height: Math.max(scheduled.length, 1) * ROW_H }}
            >
              {/* today line */}
              {todayIdx >= 0 && todayIdx < totalDays && (
                <span className="gantt-today-line" style={{ left: todayIdx * DAY_W + DAY_W / 2 }} />
              )}

              {scheduled.map((t, row) => {
                const s = parseDay(t.startDate);
                const d = parseDay(t.dueDate);
                const anchor = d ?? s!;
                let from = s ?? anchor;
                let to = d ?? anchor;
                if (to < from) [from, to] = [to, from];

                const isDragging = drag?.taskId === t.id;
                let startIdx = diffDays(rangeStart, from);
                let endIdx = diffDays(rangeStart, to);
                if (isDragging && drag) {
                  if (drag.mode === "move") {
                    startIdx += drag.delta;
                    endIdx += drag.delta;
                  } else if (drag.mode === "resize-l") {
                    startIdx = Math.min(startIdx + drag.delta, endIdx);
                  } else {
                    endIdx = Math.max(endIdx + drag.delta, startIdx);
                  }
                }
                const color = t.status.color || colorFor(t.statusId);
                const canResize = canEdit && s !== null && d !== null && !t.isMilestone;

                if (t.isMilestone) {
                  const mIdx = isDragging && drag ? diffDays(rangeStart, anchor) + drag.delta : diffDays(rangeStart, anchor);
                  return (
                    <span
                      key={t.id}
                      className={`gantt-milestone${isDragging ? " dragging" : ""}`}
                      style={{ left: mIdx * DAY_W + DAY_W / 2, top: row * ROW_H + ROW_H / 2 }}
                      title={t.name}
                      onPointerDown={(e) => startDrag(e, t, "move")}
                      onPointerMove={moveDrag}
                      onPointerUp={() => endDrag(t)}
                      onClick={() => {
                        if (!canEdit) onOpenTask(t.id);
                      }}
                    >
                      {Icons.diamondFill}
                    </span>
                  );
                }

                return (
                  <div
                    key={t.id}
                    className={`gantt-bar${isDragging ? " dragging" : ""}${t.status.type === "done" ? " done" : ""}`}
                    style={{
                      left: startIdx * DAY_W + 2,
                      width: Math.max((endIdx - startIdx + 1) * DAY_W - 4, DAY_W - 4),
                      top: row * ROW_H + 7,
                      background: `color-mix(in srgb, ${color} 24%, var(--card))`,
                      borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
                    }}
                    title={t.name}
                    onPointerDown={(e) => startDrag(e, t, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={() => endDrag(t)}
                    onClick={() => {
                      if (!canEdit) onOpenTask(t.id);
                    }}
                  >
                    {canResize && (
                      <span
                        className="gantt-handle l"
                        onPointerDown={(e) => startDrag(e, t, "resize-l")}
                        onPointerMove={moveDrag}
                        onPointerUp={() => endDrag(t)}
                      />
                    )}
                    <span className="gantt-bar-name" style={{ color }}>
                      {t.name}
                    </span>
                    {canResize && (
                      <span
                        className="gantt-handle r"
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
        </div>
      </div>

      {/* unscheduled */}
      {unscheduled.length > 0 && (
        <div className="gantt-unscheduled">
          <div className="tp-section-title">
            Unscheduled <span className="tp-count-badge">{unscheduled.length}</span>
          </div>
          <div className="cal-tray-body">
            {unscheduled.map((t) => (
              <button key={t.id} type="button" className="cal-tray-row" onClick={() => onOpenTask(t.id)}>
                <span
                  className="status-dot"
                  style={{ background: t.status.color || colorFor(t.statusId) }}
                />
                {t.isMilestone && <MilestoneMark size={11} />}
                <span className="cal-tray-name">{t.name}</span>
                <PriorityFlag priority={t.priority} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
