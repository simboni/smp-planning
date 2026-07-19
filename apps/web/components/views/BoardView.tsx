"use client";

/**
 * BoardView (Module 5) — the Kanban board. Columns are the statuses (or
 * the active group key), cards are compact task tiles. HTML5 drag & drop:
 * reorder within a column and move across columns (status change) with an
 * optimistic update followed by `tasksApi.reorder`. Cross-column DnD is a
 * status mutation, so dragging is only enabled when grouping by status.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskCard, ViewGroupBy } from "@/lib/api";
import { Icons } from "@/components/icons";
import { groupTasks } from "@/lib/viewUtils";
import { BoardCard } from "@/components/views/ViewBits";
import type { ViewProps } from "@/components/views/types";

export interface BoardViewProps extends ViewProps {
  groupBy: ViewGroupBy;
  onQuickAdd: (statusId: string, name: string) => void;
  /** Persist a drop: the moved task, its (new) status column, the column's full id order. */
  onMoveTask: (taskId: string, statusId: string, orderedIds: string[]) => void;
  onManageStatuses: () => void;
  /** Increment to open the quick-add input in the first column. */
  addSignal: number;
}

interface DragState {
  taskId: string;
  fromKey: string;
}

interface OverState {
  colKey: string;
  /** Insertion index among the column's cards excluding the dragged one. */
  index: number;
}

export function BoardView({
  tasks,
  statuses,
  canEdit,
  onOpenTask,
  groupBy,
  onQuickAdd,
  onMoveTask,
  onManageStatuses,
  addSignal,
}: BoardViewProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [over, setOver] = useState<OverState | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);

  const groups = useMemo(() => groupTasks(tasks, groupBy, statuses), [tasks, groupBy, statuses]);
  const statusGrouping = (groupBy ?? "status") === "status";
  const dndEnabled = canEdit && statusGrouping;

  // Header "New Task" → open the first column's quick-add. The ref guard
  // ignores the stale signal value on mount (view switches).
  const seenSignal = useRef(addSignal);
  useEffect(() => {
    if (addSignal === seenSignal.current) return;
    seenSignal.current = addSignal;
    const first = statuses[0];
    if (first) setAddingIn(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal]);

  const endDrag = (): void => {
    setDrag(null);
    setOver(null);
  };

  const handleDrop = (colKey: string, statusId: string | null): void => {
    if (!drag || !statusId) return endDrag();
    const col = groups.find((g) => g.key === colKey);
    if (!col) return endDrag();
    const rest = col.tasks.map((t) => t.id).filter((id) => id !== drag.taskId);
    const index = Math.min(over?.colKey === colKey ? over.index : rest.length, rest.length);
    const ids = [...rest.slice(0, index), drag.taskId, ...rest.slice(index)];
    // No-op when nothing actually moved.
    const before = col.tasks.map((t) => t.id);
    const unchanged =
      drag.fromKey === colKey && before.length === ids.length && before.every((id, i) => id === ids[i]);
    endDrag();
    if (!unchanged) onMoveTask(drag.taskId, statusId, ids);
  };

  return (
    <div className="board" role="list" aria-label="Board columns">
      {groups.map((g) => {
        const isOver = drag !== null && over?.colKey === g.key;
        const nonDragged = g.tasks.filter((t) => t.id !== drag?.taskId);
        return (
          <div
            className={`bv-col${isOver ? " over" : ""}`}
            key={g.key}
            role="listitem"
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              // Hovering the column shell (below the cards) → append.
              if (over?.colKey !== g.key) setOver({ colKey: g.key, index: nonDragged.length });
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(g.key, g.statusId);
            }}
          >
            <div className="bv-col-head">
              <span className="status-dot lg" style={{ background: g.color }} />
              <span className="bv-col-name">{g.label}</span>
              <span className="task-group-count">{g.tasks.length}</span>
            </div>

            <div
              className="bv-col-body"
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                setOver({ colKey: g.key, index: nonDragged.length });
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDrop(g.key, g.statusId);
              }}
            >
              {g.tasks.map((t) => {
                const idx = nonDragged.findIndex((n) => n.id === t.id);
                const dragging = drag?.taskId === t.id;
                return (
                  <div
                    key={t.id}
                    className={`bv-card${dragging ? " dragging" : ""}`}
                    draggable={dndEnabled}
                    onDragStart={(e) => {
                      if (!dndEnabled) return;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.id);
                      setDrag({ taskId: t.id, fromKey: g.key });
                    }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => {
                      if (!drag || dragging) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      const rect = e.currentTarget.getBoundingClientRect();
                      const below = e.clientY > rect.top + rect.height / 2;
                      setOver({ colKey: g.key, index: idx + (below ? 1 : 0) });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDrop(g.key, g.statusId);
                    }}
                  >
                    {isOver && over.index === idx && !dragging && <div className="bv-drop" />}
                    <BoardCard task={t} onOpen={() => onOpenTask(t.id)} />
                  </div>
                );
              })}
              {isOver && over.index >= nonDragged.length && <div className="bv-drop" />}
              {g.tasks.length === 0 && !isOver && addingIn !== g.key && (
                <div className="bv-empty">Drop tasks here</div>
              )}
            </div>

            {canEdit && g.statusId !== null && (
              <div className="bv-col-foot">
                {addingIn === g.key ? (
                  <BoardQuickAdd
                    onCommit={(name) => onQuickAdd(g.statusId!, name)}
                    onClose={() => setAddingIn(null)}
                  />
                ) : (
                  <button type="button" className="bv-add" onClick={() => setAddingIn(g.key)}>
                    {Icons.plus} Add task
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {canEdit && statusGrouping && (
        <button type="button" className="bv-col-add" onClick={onManageStatuses}>
          {Icons.plus} Add group
        </button>
      )}
    </div>
  );
}

/* Compact quick-add for a column's foot — Enter adds, stays open. */
function BoardQuickAdd({
  onCommit,
  onClose,
}: {
  onCommit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <input
      autoFocus
      className="bv-add-input"
      placeholder="Task name…"
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
  );
}
