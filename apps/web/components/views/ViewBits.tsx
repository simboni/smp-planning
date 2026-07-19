"use client";

/**
 * Module 5 — tiny shared pieces for the view components: an outside-click
 * popover shell (mirrors TaskPanel's) and a compact board-style task card
 * used by BoardView. Kept here so Board/Table/Calendar/FilterBar stay lean.
 */

import { useEffect, useRef } from "react";
import type { TaskCard } from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor, formatDuration, formatEstimate } from "@/lib/format";
import {
  AvatarStack,
  BlockedChip,
  DueChip,
  MilestoneMark,
  PriorityFlag,
  TagChip,
  TypeIcon,
} from "@/components/TaskBits";

/* ------------------------------------------------------------------ *
 * Popover — closes on outside click / Escape. Same contract as the
 * TaskPanel one; duplicated here so views don't import the heavy panel.
 * ------------------------------------------------------------------ */
export function Popover({
  onClose,
  children,
  className = "",
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className={`tp-pop ${className}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * BoardCard — the Kanban card body (no DnD wiring; BoardView owns that).
 * ------------------------------------------------------------------ */
export function BoardCard({ task, onOpen }: { task: TaskCard; onOpen: () => void }) {
  const est = formatEstimate(task.timeEstimateMinutes);
  const done = task.status.type === "done";
  return (
    <div
      className={`bv-card-inner${done ? " done" : ""}`}
      onClick={onOpen}
      style={{ borderLeftColor: task.status.color || colorFor(task.statusId) }}
    >
      <div className="bv-card-top">
        {task.isMilestone ? (
          <MilestoneMark />
        ) : task.taskType ? (
          <TypeIcon type={task.taskType} />
        ) : null}
        <span className={`bv-card-name${task.isMilestone ? " milestone" : ""}`}>{task.name}</span>
      </div>
      {task.tags.length > 0 && (
        <div className="bv-card-tags">
          {task.tags.slice(0, 3).map((t) => (
            <TagChip key={t.id} tag={t} />
          ))}
          {task.tags.length > 3 && <span className="task-tags-more">+{task.tags.length - 3}</span>}
        </div>
      )}
      <div className="bv-card-meta">
        <BlockedChip count={task.blockedCount} />
        <PriorityFlag priority={task.priority} />
        <DueChip due={task.dueDate} />
        {task.subtaskCount > 0 && (
          <span className="task-count" title={`${task.subtaskCount} subtasks`}>
            {Icons.subtask}
            {task.subtaskCount}
          </span>
        )}
        {task.checklistTotal > 0 && (
          <span
            className={`task-count${task.checklistDone === task.checklistTotal ? " complete" : ""}`}
            title={`Checklist ${task.checklistDone}/${task.checklistTotal}`}
          >
            {Icons.checkSquare}
            {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        {est && (
          <span className="task-count" title="Time estimate">
            {Icons.clock}
            {est}
          </span>
        )}
        {task.trackedSeconds > 0 && (
          <span className="task-count tracked" title="Time tracked">
            {Icons.timer}
            {formatDuration(task.trackedSeconds)}
          </span>
        )}
        <span className="bv-card-spacer" />
        <AvatarStack users={task.assignees} size={20} />
      </div>
    </div>
  );
}
