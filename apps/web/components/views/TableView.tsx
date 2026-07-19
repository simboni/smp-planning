"use client";

/**
 * TableView (Module 5) — a dense spreadsheet of tasks. Name is sticky on
 * the left; Status / Assignees / Due / Priority / Tags edit inline via the
 * same popover patterns as the Task panel and PATCH immediately. Column
 * headers sort (asc/desc indicator) through the shell's central sort state.
 */

import { useState } from "react";
import type {
  Member,
  Priority,
  Tag,
  TaskCard,
  TaskUpdateBody,
  ViewSort,
  ViewSortKey,
} from "@/lib/api";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor, formatDueDate, formatEstimate, initials, isOverdue, toDateInputValue } from "@/lib/format";
import { AvatarStack, MilestoneMark, TagChip, TypeIcon } from "@/components/TaskBits";
import { Popover } from "@/components/views/ViewBits";
import { QuickAdd } from "@/components/views/ListView";
import type { ViewProps } from "@/components/views/types";

export interface TableViewProps extends ViewProps {
  tags: Tag[];
  sort: ViewSort | null;
  onSortChange: (sort: ViewSort | null) => void;
  onUpdateTask: (task: TaskCard, body: TaskUpdateBody, optimistic?: Partial<TaskCard>) => void;
  onToggleAssignee: (task: TaskCard, userId: string, on: boolean) => void;
  onToggleTag: (task: TaskCard, tagId: string, on: boolean) => void;
  onQuickAdd: (statusId: string, name: string) => void;
}

const SORTABLE: Partial<Record<string, ViewSortKey>> = {
  Name: "name",
  "Due date": "dueDate",
  Priority: "priority",
  Created: "created",
};

const COLUMNS = ["Name", "Status", "Assignees", "Due date", "Priority", "Tags", "Estimate", "Created"];

export function TableView({
  tasks,
  statuses,
  members,
  tags,
  canEdit,
  onOpenTask,
  sort,
  onSortChange,
  onUpdateTask,
  onToggleAssignee,
  onToggleTag,
  onQuickAdd,
}: TableViewProps) {
  // One open popover at a time: "<kind>:<taskId>".
  const [pop, setPop] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const headerClick = (col: string): void => {
    const key = SORTABLE[col];
    if (!key) return;
    if (sort?.key === key) {
      onSortChange(sort.dir === "asc" ? { key, dir: "desc" } : null);
    } else {
      onSortChange({ key, dir: "asc" });
    }
  };

  return (
    <div className="tableview">
      <table className="tv-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const key = SORTABLE[col];
              const active = key !== undefined && sort?.key === key;
              return (
                <th
                  key={col}
                  className={[
                    col === "Name" ? "tv-sticky" : "",
                    key ? "tv-sortable" : "",
                    active ? "tv-sorted" : "",
                  ].join(" ").trim() || undefined}
                  onClick={() => headerClick(col)}
                >
                  <span className="tv-th">
                    {col}
                    {active && (
                      <span className="tv-sort-ind">
                        {sort!.dir === "asc" ? Icons.arrowUp : Icons.arrowDown}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={t.status.type === "done" ? "tv-done" : undefined}>
              {/* Name */}
              <td className="tv-sticky tv-name-cell" onClick={() => onOpenTask(t.id)}>
                <span className="tv-name">
                  {t.isMilestone ? (
                    <MilestoneMark />
                  ) : t.taskType ? (
                    <TypeIcon type={t.taskType} />
                  ) : null}
                  <span className="tv-name-text">{t.name}</span>
                </span>
              </td>

              {/* Status */}
              <td>
                <span className="tp-pop-anchor">
                  <button
                    type="button"
                    className="tv-status-pill"
                    disabled={!canEdit}
                    style={{
                      color: t.status.color || colorFor(t.statusId),
                      borderColor: `color-mix(in srgb, ${t.status.color || colorFor(t.statusId)} 45%, transparent)`,
                      background: `color-mix(in srgb, ${t.status.color || colorFor(t.statusId)} 12%, transparent)`,
                    }}
                    onClick={() => setPop(pop === `status:${t.id}` ? null : `status:${t.id}`)}
                  >
                    {t.status.name}
                  </button>
                  {pop === `status:${t.id}` && (
                    <Popover onClose={() => setPop(null)} className="tp-pop-menu">
                      {statuses.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`tp-menu-opt${s.id === t.statusId ? " on" : ""}`}
                          onClick={() => {
                            setPop(null);
                            if (s.id !== t.statusId)
                              onUpdateTask(
                                t,
                                { statusId: s.id },
                                {
                                  statusId: s.id,
                                  status: { id: s.id, name: s.name, color: s.color, type: s.type },
                                },
                              );
                          }}
                        >
                          <span className="status-dot" style={{ background: s.color || colorFor(s.id) }} />
                          <span>{s.name}</span>
                          {s.id === t.statusId && <span className="tp-menu-check">{Icons.check}</span>}
                        </button>
                      ))}
                    </Popover>
                  )}
                </span>
              </td>

              {/* Assignees */}
              <td>
                <span className="tp-pop-anchor">
                  <button
                    type="button"
                    className="tv-cell-btn"
                    disabled={!canEdit}
                    onClick={() => setPop(pop === `people:${t.id}` ? null : `people:${t.id}`)}
                  >
                    {t.assignees.length > 0 ? (
                      <AvatarStack users={t.assignees} size={22} />
                    ) : (
                      <span className="tv-unset">{canEdit ? "Assign" : "—"}</span>
                    )}
                  </button>
                  {pop === `people:${t.id}` && (
                    <MemberTogglePop
                      members={members}
                      selected={new Set(t.assignees.map((a) => a.id))}
                      onToggle={(userId, on) => onToggleAssignee(t, userId, on)}
                      onClose={() => setPop(null)}
                    />
                  )}
                </span>
              </td>

              {/* Due date */}
              <td>
                {canEdit ? (
                  <input
                    type="date"
                    className={`tv-date${isOverdue(t.dueDate) ? " overdue" : ""}`}
                    value={toDateInputValue(t.dueDate)}
                    onChange={(e) =>
                      onUpdateTask(
                        t,
                        { dueDate: e.target.value || null },
                        { dueDate: e.target.value || null },
                      )
                    }
                  />
                ) : (
                  <span className={`tv-date-ro${isOverdue(t.dueDate) ? " overdue" : ""}`}>
                    {t.dueDate ? formatDueDate(t.dueDate) : "—"}
                  </span>
                )}
              </td>

              {/* Priority */}
              <td>
                <span className="tp-pop-anchor">
                  <button
                    type="button"
                    className="tv-cell-btn"
                    disabled={!canEdit}
                    onClick={() => setPop(pop === `prio:${t.id}` ? null : `prio:${t.id}`)}
                  >
                    {t.priority ? (
                      <span className="prio-flag" style={{ color: PRIORITY_META[t.priority].color }}>
                        {Icons.flag}
                        <span className="prio-flag-label">{PRIORITY_META[t.priority].label}</span>
                      </span>
                    ) : (
                      <span className="tv-unset">{canEdit ? "Set" : "—"}</span>
                    )}
                  </button>
                  {pop === `prio:${t.id}` && (
                    <Popover onClose={() => setPop(null)} className="tp-pop-menu">
                      {PRIORITY_ORDER.map((p: Priority) => (
                        <button
                          key={p}
                          type="button"
                          className={`tp-menu-opt${t.priority === p ? " on" : ""}`}
                          onClick={() => {
                            setPop(null);
                            onUpdateTask(t, { priority: p }, { priority: p });
                          }}
                        >
                          <span className="prio-flag" style={{ color: PRIORITY_META[p].color }}>
                            {Icons.flag}
                          </span>
                          <span>{PRIORITY_META[p].label}</span>
                          {t.priority === p && <span className="tp-menu-check">{Icons.check}</span>}
                        </button>
                      ))}
                      {t.priority && (
                        <button
                          type="button"
                          className="tp-menu-opt"
                          onClick={() => {
                            setPop(null);
                            onUpdateTask(t, { priority: null }, { priority: null });
                          }}
                        >
                          <span className="prio-flag muted">{Icons.close}</span>
                          <span>Clear</span>
                        </button>
                      )}
                    </Popover>
                  )}
                </span>
              </td>

              {/* Tags */}
              <td>
                <span className="tp-pop-anchor">
                  <button
                    type="button"
                    className="tv-cell-btn"
                    disabled={!canEdit}
                    onClick={() => setPop(pop === `tags:${t.id}` ? null : `tags:${t.id}`)}
                  >
                    {t.tags.length > 0 ? (
                      <span className="tv-tags">
                        {t.tags.slice(0, 2).map((tag) => (
                          <TagChip key={tag.id} tag={tag} />
                        ))}
                        {t.tags.length > 2 && (
                          <span className="task-tags-more">+{t.tags.length - 2}</span>
                        )}
                      </span>
                    ) : (
                      <span className="tv-unset">{canEdit ? "Add" : "—"}</span>
                    )}
                  </button>
                  {pop === `tags:${t.id}` && (
                    <TagTogglePop
                      tags={tags}
                      selected={new Set(t.tags.map((x) => x.id))}
                      onToggle={(tagId, on) => onToggleTag(t, tagId, on)}
                      onClose={() => setPop(null)}
                    />
                  )}
                </span>
              </td>

              {/* Estimate */}
              <td>
                <span className="tv-ro">{formatEstimate(t.timeEstimateMinutes) || "—"}</span>
              </td>

              {/* Created */}
              <td>
                <span className="tv-ro">{formatDueDate(t.createdAt) || "—"}</span>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td className="tv-sticky" colSpan={COLUMNS.length}>
                <span className="tv-empty">No tasks match the current filters.</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canEdit && statuses.length > 0 && (
        <div className="tv-foot">
          {adding ? (
            <QuickAdd
              onCommit={(name) => onQuickAdd(statuses[0].id, name)}
              onClose={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="task-add" onClick={() => setAdding(true)}>
              {Icons.plus} New task
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- multi-toggle popovers ---------------------------------------- */
function MemberTogglePop({
  members,
  selected,
  onToggle,
  onClose,
}: {
  members: Member[];
  selected: Set<string>;
  onToggle: (userId: string, on: boolean) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hits = members.filter((m) =>
    !needle ? true : `${m.fullName} ${m.email}`.toLowerCase().includes(needle),
  );
  return (
    <Popover onClose={onClose} className="tp-pop-people">
      <div className="tp-pop-search">
        {Icons.search}
        <input
          autoFocus
          className="tp-pop-input"
          placeholder="Search people…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="tp-pop-list">
        {hits.length === 0 ? (
          <div className="tp-pop-empty">No people match.</div>
        ) : (
          hits.map((m) => {
            const on = selected.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={`tp-pop-opt${on ? " on" : ""}`}
                onClick={() => onToggle(m.id, !on)}
              >
                <span className="avatar avatar-sm" style={{ background: colorFor(m.id) }}>
                  {initials(m.fullName || m.email)}
                </span>
                <span className="tp-pop-opt-body">
                  <span className="tp-pop-opt-name">{m.fullName || m.email}</span>
                  <span className="tp-pop-opt-sub">{m.email}</span>
                </span>
                <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
              </button>
            );
          })
        )}
      </div>
    </Popover>
  );
}

function TagTogglePop({
  tags,
  selected,
  onToggle,
  onClose,
}: {
  tags: Tag[];
  selected: Set<string>;
  onToggle: (tagId: string, on: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Popover onClose={onClose} className="tp-pop-people">
      <div className="tp-pop-list">
        {tags.length === 0 && <div className="tp-pop-empty">No tags in this space yet.</div>}
        {tags.map((tag) => {
          const on = selected.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className={`tp-pop-opt${on ? " on" : ""}`}
              onClick={() => onToggle(tag.id, !on)}
            >
              <span className="status-dot" style={{ background: tag.color || colorFor(tag.id) }} />
              <span className="tp-pop-opt-body">
                <span className="tp-pop-opt-name">{tag.name}</span>
              </span>
              <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
