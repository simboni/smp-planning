"use client";

/**
 * TaskRow — one task in the List view. A clickable status circle (opens the
 * status picker), the task name, and compact meta on the right: assignee
 * avatars, a due-date chip, a priority flag, tag chips and a subtask /
 * checklist progress indicator. Hovering reveals a ⋯ menu (Open, Delete).
 * Clicking the row body (not the circle or menu) opens the Task panel.
 *
 * The row is presentational: status changes, deletes and opens are delegated
 * to callbacks so the List page owns the data and optimistic updates.
 */

import { useEffect, useRef, useState } from "react";
import type { Status, TaskCard } from "@/lib/api";
import { Icons } from "@/components/icons";
import { formatDuration, formatEstimate } from "@/lib/format";
import {
  AvatarStack,
  BlockedChip,
  DueChip,
  MilestoneMark,
  PriorityFlag,
  StatusCircle,
  TagChip,
  TypeIcon,
} from "@/components/TaskBits";

export function TaskRow({
  task,
  statuses,
  canEdit,
  onOpen,
  onChangeStatus,
  onDelete,
}: {
  task: TaskCard;
  statuses: Status[];
  canEdit: boolean;
  onOpen: () => void;
  onChangeStatus: (statusId: string) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const done = task.status.type === "done";
  const est = formatEstimate(task.timeEstimateMinutes);

  return (
    <div className={`task-row${done ? " task-done" : ""}`} onClick={onOpen}>
      <StatusCircle
        status={task.status}
        statuses={statuses}
        canEdit={canEdit}
        onPick={onChangeStatus}
      />

      {task.isMilestone ? (
        <MilestoneMark />
      ) : task.taskType ? (
        <TypeIcon type={task.taskType} />
      ) : null}

      <span className={`task-name${task.isMilestone ? " milestone" : ""}`}>{task.name}</span>

      <span className="task-meta">
        <BlockedChip count={task.blockedCount} />
        {task.tags.length > 0 && (
          <span className="task-tags">
            {task.tags.slice(0, 3).map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
            {task.tags.length > 3 && (
              <span className="task-tags-more">+{task.tags.length - 3}</span>
            )}
          </span>
        )}

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

        <PriorityFlag priority={task.priority} />
        <DueChip due={task.dueDate} />
        <AvatarStack users={task.assignees} />
      </span>

      {canEdit && (
        <div className="task-row-actions" ref={menuRef}>
          <button
            type="button"
            className="task-row-more"
            aria-label="Task actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((v) => !v);
            }}
          >
            {Icons.more}
          </button>
          {menu && (
            <div className="tree-menu task-row-menu" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onOpen();
                }}
              >
                {Icons.arrowRight} Open
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
              >
                {Icons.trash} Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
