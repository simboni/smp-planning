"use client";

/**
 * Small shared presentational pieces for Tasks Core (Module 3) — used by both
 * the List view rows and the Task detail panel so the two stay visually
 * identical: the clickable status circle (with its picker popover), assignee
 * avatar stacks, priority flags, due-date chips and tag chips.
 */

import { useEffect, useRef, useState } from "react";
import type { Priority, Status, Tag, TaskStatusRef, TaskTypeRef, TaskUser } from "@/lib/api";
import { PRIORITY_META } from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor, formatDueDate, initials, isOverdue } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * Status circle + inline status picker popover.
 * ------------------------------------------------------------------ */
export function StatusCircle({
  status,
  statuses,
  canEdit,
  onPick,
  size = 20,
}: {
  status: TaskStatusRef;
  statuses: Status[];
  canEdit: boolean;
  onPick: (statusId: string) => void;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const done = status.type === "done";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="status-circle-wrap" ref={ref}>
      <button
        type="button"
        className={`status-circle${done ? " done" : ""}`}
        style={{ color: status.color || colorFor(status.id), width: size, height: size }}
        title={canEdit ? `${status.name} — change status` : status.name}
        aria-label={`Status: ${status.name}`}
        disabled={!canEdit}
        onClick={(e) => {
          e.stopPropagation();
          if (canEdit) setOpen((v) => !v);
        }}
      >
        {done ? Icons.checkCircle : Icons.circle}
      </button>
      {open && (
        <div className="status-pop" onClick={(e) => e.stopPropagation()}>
          <div className="status-pop-title">Set status</div>
          {statuses.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`status-pop-opt${s.id === status.id ? " on" : ""}`}
              onClick={() => {
                setOpen(false);
                if (s.id !== status.id) onPick(s.id);
              }}
            >
              <span className="status-dot" style={{ background: s.color || colorFor(s.id) }} />
              <span className="status-pop-name">{s.name}</span>
              {s.id === status.id && <span className="status-pop-check">{Icons.check}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Avatar stack — overlapping circles with a +N overflow.
 * ------------------------------------------------------------------ */
export function AvatarStack({
  users,
  max = 3,
  size = 24,
}: {
  users: TaskUser[];
  max?: number;
  size?: number;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((u) => (
        <span
          key={u.id}
          className="avatar-stack-item"
          style={{ background: colorFor(u.id), width: size, height: size }}
          title={u.fullName}
        >
          {initials(u.fullName)}
        </span>
      ))}
      {extra > 0 && (
        <span
          className="avatar-stack-item avatar-stack-more"
          style={{ width: size, height: size }}
          title={users.slice(max).map((u) => u.fullName).join(", ")}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Priority flag (colored).
 * ------------------------------------------------------------------ */
export function PriorityFlag({
  priority,
  withLabel = false,
}: {
  priority: Priority | null;
  withLabel?: boolean;
}) {
  if (!priority) return null;
  const meta = PRIORITY_META[priority];
  return (
    <span
      className="prio-flag"
      style={{ color: meta.color }}
      title={`Priority: ${meta.label}`}
    >
      {Icons.flag}
      {withLabel && <span className="prio-flag-label">{meta.label}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Due-date chip (red when overdue).
 * ------------------------------------------------------------------ */
export function DueChip({ due }: { due: string | null }) {
  if (!due) return null;
  const overdue = isOverdue(due);
  return (
    <span className={`due-chip${overdue ? " overdue" : ""}`} title={overdue ? "Overdue" : "Due date"}>
      {Icons.calendar}
      {formatDueDate(due)}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Milestone diamond — the purple ◆ marking milestone tasks (Module 4).
 * ------------------------------------------------------------------ */
export function MilestoneMark({ size = 13 }: { size?: number }) {
  return (
    <span className="milestone-mark" style={{ width: size, height: size }} title="Milestone">
      {Icons.diamondFill}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Task-type icon — emoji when the type defines one, else a bolt glyph.
 * Milestone types get the diamond instead (Module 4).
 * ------------------------------------------------------------------ */
export function TypeIcon({ type, size = 14 }: { type: TaskTypeRef; size?: number }) {
  return (
    <span
      className="task-type-ic"
      style={{ width: size, height: size, fontSize: size - 1 }}
      title={`Type: ${type.name}`}
    >
      {type.icon ? type.icon : type.isMilestone ? Icons.diamond : Icons.bolt}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Blocked chip — shown when a task is waiting on unresolved tasks.
 * ------------------------------------------------------------------ */
export function BlockedChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="blocked-chip"
      title={`Waiting on ${count} task${count === 1 ? "" : "s"}`}
    >
      {Icons.ban}
      Blocked
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Tag chip.
 * ------------------------------------------------------------------ */
export function TagChip({
  tag,
  onRemove,
}: {
  tag: Tag;
  onRemove?: () => void;
}) {
  const color = tag.color || colorFor(tag.id);
  return (
    <span
      className="tag-chip"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {Icons.tag}
      <span className="tag-chip-name">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          className="tag-chip-x"
          aria-label={`Remove ${tag.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          {Icons.close}
        </button>
      )}
    </span>
  );
}
