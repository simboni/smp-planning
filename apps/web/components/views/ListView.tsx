"use client";

/**
 * ListView (Module 5) — the classic grouped list extracted from the old
 * List page, now group-aware: status (default, keeps every status group
 * and quick-add), assignee or priority. Behavior for the default status
 * grouping is identical to the pre-M5 page.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskCard, ViewGroupBy } from "@/lib/api";
import { Icons } from "@/components/icons";
import { groupTasks } from "@/lib/viewUtils";
import { TaskRow } from "@/components/TaskRow";
import type { ViewProps } from "@/components/views/types";

export interface ListViewProps extends ViewProps {
  groupBy: ViewGroupBy;
  /** id → name, for space-level "list" grouping. */
  listNames?: Map<string, string>;
  onChangeStatus: (task: TaskCard, statusId: string) => void;
  onDelete: (task: TaskCard) => void;
  onQuickAdd: (statusId: string, name: string) => void;
  /** Increment to open the quick-add input in the first status group. */
  addSignal: number;
  /** True when the FilterBar is hiding tasks (changes the empty copy). */
  filtersActive: boolean;
}

export function ListView({
  tasks,
  statuses,
  canEdit,
  onOpenTask,
  groupBy,
  listNames,
  onChangeStatus,
  onDelete,
  onQuickAdd,
  addSignal,
  filtersActive,
}: ListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingIn, setAddingIn] = useState<string | null>(null);

  const groups = useMemo(
    () => groupTasks(tasks, groupBy, statuses, listNames),
    [tasks, groupBy, statuses, listNames],
  );
  const statusGrouping = (groupBy ?? "status") === "status";

  // Header "New Task" → open quick-add in the first status group. The ref
  // guard ignores the stale signal value on mount (view switches).
  const seenSignal = useRef(addSignal);
  useEffect(() => {
    if (addSignal === seenSignal.current) return;
    seenSignal.current = addSignal;
    const first = statuses[0];
    if (!first) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(first.id);
      return next;
    });
    setAddingIn(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  const toggleGroup = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (tasks.length === 0 && addingIn === null) {
    if (!statusGrouping || filtersActive) {
      return (
        <div className="card task-placeholder">
          <div className="empty-state">
            <span className="empty-ic">{Icons.tasks}</span>
            <h3>Nothing here</h3>
            <p>No tasks match the current filters.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="card task-placeholder">
        <div className="empty-state">
          <span className="empty-ic">{Icons.tasks}</span>
          <h3>No tasks yet</h3>
          <p>This list is a blank canvas. Add your first task to get going.</p>
          {canEdit && statuses.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAddingIn(statuses[0].id)}
            >
              {Icons.plus} Add a task
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="task-groups">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        return (
          <div className="task-group" key={g.key}>
            <div className="task-group-head" onClick={() => toggleGroup(g.key)}>
              <span className={`task-group-caret${isCollapsed ? "" : " open"}`}>
                {Icons.chevronRight}
              </span>
              <span className="status-dot lg" style={{ background: g.color }} />
              <span className="task-group-name">{g.label}</span>
              <span className="task-group-count">{g.tasks.length}</span>
            </div>
            {!isCollapsed && (
              <div className="task-group-body">
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    statuses={statuses}
                    canEdit={canEdit}
                    onOpen={() => onOpenTask(t.id)}
                    onChangeStatus={(sid) => onChangeStatus(t, sid)}
                    onDelete={() => onDelete(t)}
                  />
                ))}
                {g.tasks.length === 0 && addingIn !== g.key && (
                  <div className="task-group-empty">No tasks</div>
                )}
                {canEdit &&
                  g.statusId !== null &&
                  (addingIn === g.key ? (
                    <QuickAdd
                      onCommit={(name) => onQuickAdd(g.statusId!, name)}
                      onClose={() => setAddingIn(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="task-add"
                      onClick={() => setAddingIn(g.key)}
                    >
                      {Icons.plus} Add task
                    </button>
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Inline quick-add: keeps focus so several tasks can be added in a row. */
export function QuickAdd({
  onCommit,
  onClose,
  placeholder = "Task name — Enter to add, Esc to close",
}: {
  onCommit: (name: string) => void;
  onClose: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="task-quickadd">
      <span className="status-circle-ghost">{Icons.circle}</span>
      <input
        autoFocus
        className="task-quickadd-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = value.trim();
            if (v) {
              onCommit(v);
              setValue("");
            }
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        onBlur={() => {
          if (!value.trim()) onClose();
        }}
      />
    </div>
  );
}
