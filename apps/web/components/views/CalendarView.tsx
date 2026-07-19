"use client";

/**
 * CalendarView (Module 5) — a Monday-start month grid. Tasks land on their
 * due date as colored pills; clicking a pill opens the Task panel; clicking
 * an empty day starts an inline quick-add that creates the task with that
 * due date. Pills are draggable to another day (HTML5 DnD → PATCH dueDate,
 * optimistic). Tasks without a due date sit in a collapsible tray below.
 */

import { useMemo, useState } from "react";
import type { TaskCard } from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { dayKeyOf, monthGrid, monthLabel } from "@/lib/viewUtils";
import { MilestoneMark, PriorityFlag } from "@/components/TaskBits";
import type { ViewProps } from "@/components/views/types";

export interface CalendarViewProps extends ViewProps {
  /** Create a task due on the given day ("yyyy-mm-dd"). */
  onQuickAddDate: (dueDate: string, name: string) => void;
  /** Reschedule (drag) a task to a day; optimistic PATCH in the shell. */
  onSetDueDate: (task: TaskCard, dueDate: string) => void;
}

const MAX_PILLS = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView({
  tasks,
  canEdit,
  onOpenTask,
  onQuickAddDate,
  onSetDueDate,
}: CalendarViewProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [adding, setAdding] = useState<string | null>(null); // day key
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [trayOpen, setTrayOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const cells = useMemo(() => monthGrid(year, month), [year, month]);

  const byDay = useMemo(() => {
    const map = new Map<string, TaskCard[]>();
    for (const t of tasks) {
      const key = dayKeyOf(t.dueDate);
      if (!key) continue;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [tasks]);

  const unscheduled = useMemo(() => tasks.filter((t) => !dayKeyOf(t.dueDate)), [tasks]);

  const shift = (delta: number): void => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const goToday = (): void => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const commitAdd = (): void => {
    const v = draft.trim();
    if (adding && v) {
      onQuickAddDate(adding, v);
      setDraft("");
    }
  };

  return (
    <div className="calview">
      <div className="cal-toolbar">
        <h2 className="cal-title">{monthLabel(year, month)}</h2>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>
            {Icons.chevronLeft}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={goToday}>
            Today
          </button>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>
            {Icons.chevronRight}
          </button>
        </div>
      </div>

      <div className="cal-scroll">
        <div className="cal-grid-head">
          {WEEKDAYS.map((d) => (
            <span key={d} className="cal-dow">{d}</span>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((cell) => {
            const dayTasks = byDay.get(cell.key) ?? [];
            const isExpanded = expanded.has(cell.key);
            const shown = isExpanded ? dayTasks : dayTasks.slice(0, MAX_PILLS);
            const hidden = dayTasks.length - shown.length;
            return (
              <div
                key={cell.key}
                className={[
                  "cal-cell",
                  cell.inMonth ? "" : "off",
                  cell.isToday ? "today" : "",
                  dragOverDay === cell.key && dragId ? "dropping" : "",
                ].join(" ").trim()}
                onClick={() => {
                  if (canEdit && adding !== cell.key) {
                    setAdding(cell.key);
                    setDraft("");
                  }
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverDay(cell.key);
                }}
                onDragLeave={() => {
                  setDragOverDay((prev) => (prev === cell.key ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragId) return;
                  const task = tasks.find((t) => t.id === dragId);
                  setDragId(null);
                  setDragOverDay(null);
                  if (task && dayKeyOf(task.dueDate) !== cell.key) onSetDueDate(task, cell.key);
                }}
              >
                <span className="cal-daynum">{cell.date.getDate()}</span>
                <div className="cal-pills">
                  {shown.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`cal-pill${t.status.type === "done" ? " done" : ""}`}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                        setDragId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOverDay(null);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTask(t.id);
                      }}
                      title={t.name}
                    >
                      <span
                        className="status-dot"
                        style={{ background: t.status.color || colorFor(t.statusId) }}
                      />
                      {t.isMilestone && <MilestoneMark size={10} />}
                      <span className="cal-pill-name">{t.name}</span>
                      <PriorityFlag priority={t.priority} />
                    </button>
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      className="cal-more"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded((prev) => new Set(prev).add(cell.key));
                      }}
                    >
                      +{hidden} more
                    </button>
                  )}
                  {adding === cell.key && (
                    <input
                      autoFocus
                      className="cal-add-input"
                      placeholder="Task name…"
                      value={draft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitAdd();
                        else if (e.key === "Escape") setAdding(null);
                      }}
                      onBlur={() => {
                        if (!draft.trim()) setAdding(null);
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unscheduled tray */}
      <div className="cal-tray">
        <button type="button" className="cal-tray-head" onClick={() => setTrayOpen((v) => !v)}>
          <span className={`task-group-caret${trayOpen ? " open" : ""}`}>{Icons.chevronRight}</span>
          <span className="task-group-name">Unscheduled</span>
          <span className="task-group-count">{unscheduled.length}</span>
        </button>
        {trayOpen && (
          <div className="cal-tray-body">
            {unscheduled.length === 0 && <div className="task-group-empty">Everything has a date.</div>}
            {unscheduled.map((t) => (
              <button
                key={t.id}
                type="button"
                className="cal-tray-row"
                draggable={canEdit}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", t.id);
                  setDragId(t.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverDay(null);
                }}
                onClick={() => onOpenTask(t.id)}
              >
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
        )}
      </div>
    </div>
  );
}
