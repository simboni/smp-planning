"use client";

/**
 * Space-level task views — every task in a space, across all its lists, in
 * the same six views the List page offers (List / Board / Calendar / Table /
 * Gantt / Timeline) plus a space-only "Group: List" so you can see the whole
 * space organized by its lists.
 *
 * Deliberately reuses the List page's view components and view utils, so a
 * fix to a view lands in both places. Edits (status, dates, assignees…) go
 * through the same task endpoints — a task keeps living in its own list, this
 * is purely a wider lens on the same data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  statusesApi,
  tagsApi,
  tasksApi,
  workspacesApi,
  type Member,
  type Status,
  type Tag,
  type TaskCard,
  type ViewConfig,
  type ViewKind,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { FilterBar } from "@/components/views/FilterBar";
import { ListView } from "@/components/views/ListView";
import { BoardView } from "@/components/views/BoardView";
import { CalendarView } from "@/components/views/CalendarView";
import { TableView } from "@/components/views/TableView";
import { GanttView } from "@/components/views/GanttView";
import { TimelineView } from "@/components/views/TimelineView";
import { TaskPanel } from "@/components/TaskPanel";
import { activeFilterCount, applyView } from "@/lib/viewUtils";

const KINDS: { kind: ViewKind; label: string; icon: keyof typeof Icons }[] = [
  { kind: "list", label: "List", icon: "list" },
  { kind: "board", label: "Board", icon: "board" },
  { kind: "calendar", label: "Calendar", icon: "calendar" },
  { kind: "table", label: "Table", icon: "table" },
  { kind: "gantt", label: "Gantt", icon: "gantt" },
  { kind: "timeline", label: "Timeline", icon: "clock" },
];

const VIEW_KEY = "stackup.spaceView";

export function SpaceTasks({
  spaceId,
  lists,
  canEdit,
}: {
  spaceId: string;
  /** Every list in the space (incl. those inside folders) — for grouping. */
  lists: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ViewKind>("list");
  const [config, setConfig] = useState<ViewConfig>({ groupBy: "list" });
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  // Remember the last view kind used at space level.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY) as ViewKind | null;
      if (saved && KINDS.some((k) => k.kind === saved)) setKind(saved);
    } catch {
      /* private mode */
    }
  }, []);
  const pickKind = (k: ViewKind): void => {
    setKind(k);
    try {
      localStorage.setItem(VIEW_KEY, k);
    } catch {
      /* ignore */
    }
  };

  const loadTasks = useCallback((): void => {
    tasksApi
      .listForSpace(spaceId)
      .then((r) => {
        setTasks(r.tasks);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load tasks."),
      );
  }, [spaceId]);

  useEffect(() => {
    setTasks(null);
    loadTasks();
    statusesApi
      .list(spaceId)
      .then((r) => setStatuses(r.statuses))
      .catch(() => undefined);
    tagsApi
      .list(spaceId)
      .then((r) => setTags(r.tags))
      .catch(() => undefined);
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, [spaceId, loadTasks]);

  const listNames = useMemo(
    () => new Map(lists.map((l) => [l.id, l.name])),
    [lists],
  );
  const visibleTasks = useMemo(
    () => (tasks === null ? [] : applyView(tasks, config)),
    [tasks, config],
  );
  const filtersActive = activeFilterCount(config.filters) > 0;

  /** Optimistic PATCH used by the table/gantt/calendar views. */
  const updateTask = (
    task: TaskCard,
    patch: Parameters<typeof tasksApi.update>[1],
    optimistic?: Partial<TaskCard>,
  ): void => {
    if (optimistic) {
      setTasks((prev) =>
        prev
          ? prev.map((t) => (t.id === task.id ? { ...t, ...optimistic } : t))
          : prev,
      );
    }
    tasksApi
      .update(task.id, patch)
      .then(() => loadTasks())
      .catch(() => loadTasks());
  };

  const viewProps = {
    tasks: visibleTasks,
    statuses,
    members,
    canEdit,
    onOpenTask: (id: string) => setSelectedTask(id),
    onChanged: loadTasks,
    // A space view spans many lists; quick-add targets the first list so the
    // views' "+" affordances stay meaningful (a task must live in a list).
    listId: lists[0]?.id ?? "",
  };

  const noop = (): void => undefined;

  return (
    <div className="sp-tasks">
      <div className="sp-tasks-head">
        <div className="chips sp-view-chips" role="tablist" aria-label="View">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="tab"
              aria-selected={kind === k.kind}
              className={`chip${kind === k.kind ? " active" : ""}`}
              onClick={() => pickKind(k.kind)}
            >
              {Icons[k.icon]} {k.label}
            </button>
          ))}
        </div>
        <span className="sp-tasks-count muted">
          {tasks === null
            ? "…"
            : `${visibleTasks.length}${
                filtersActive ? ` of ${tasks.length}` : ""
              } ${visibleTasks.length === 1 ? "task" : "tasks"}`}
        </span>
      </div>

      <FilterBar
        statuses={statuses}
        members={members}
        tags={tags}
        config={config}
        onChange={setConfig}
        showGroup={kind === "list" || kind === "board"}
        showListGroup
      />

      {error && <div className="form-error">{error}</div>}

      {tasks === null ? (
        <div className="task-groups">
          <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
          <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
          <span className="skel" style={{ width: "100%", height: 44 }} />
        </div>
      ) : tasks.length === 0 ? (
        <div className="card task-placeholder">
          <div className="empty-state">
            <span className="empty-ic">{Icons.tasks}</span>
            <h3>No tasks in this space yet</h3>
            <p>Open a list below and add the first one.</p>
          </div>
        </div>
      ) : kind === "list" ? (
        <ListView
          {...viewProps}
          groupBy={config.groupBy ?? "list"}
          listNames={listNames}
          onChangeStatus={(task, statusId) =>
            updateTask(task, { statusId }, { statusId })
          }
          onDelete={(task) => {
            if (!window.confirm(`Delete “${task.name}”? This can't be undone.`)) return;
            setTasks((prev) => (prev ?? []).filter((t) => t.id !== task.id));
            tasksApi.remove(task.id).catch(() => loadTasks());
          }}
          onQuickAdd={noop}
          addSignal={0}
          filtersActive={filtersActive}
        />
      ) : kind === "board" ? (
        <BoardView
          {...viewProps}
          groupBy={config.groupBy ?? "status"}
          listNames={listNames}
          onQuickAdd={noop}
          onMoveTask={(taskId, statusId) => {
            setTasks((prev) =>
              prev
                ? prev.map((t) => (t.id === taskId ? { ...t, statusId } : t))
                : prev,
            );
            tasksApi
              .update(taskId, { statusId })
              .then(() => loadTasks())
              .catch(() => loadTasks());
          }}
          onManageStatuses={noop}
          addSignal={0}
        />
      ) : kind === "calendar" ? (
        <CalendarView
          {...viewProps}
          onQuickAddDate={noop}
          onSetDueDate={(task, due) =>
            updateTask(task, { dueDate: due }, { dueDate: due })
          }
        />
      ) : kind === "table" ? (
        <TableView
          {...viewProps}
          tags={tags}
          sort={config.sort ?? null}
          onSortChange={(s) => setConfig({ ...config, sort: s })}
          onUpdateTask={updateTask}
          onToggleAssignee={(task, userId, on) => {
            (on
              ? tasksApi.addAssignee(task.id, userId)
              : tasksApi.removeAssignee(task.id, userId)
            )
              .then(() => loadTasks())
              .catch(() => loadTasks());
          }}
          onToggleTag={(task, tagId, on) => {
            (on
              ? tasksApi.addTag(task.id, tagId)
              : tasksApi.removeTag(task.id, tagId)
            )
              .then(() => loadTasks())
              .catch(() => loadTasks());
          }}
          onQuickAdd={noop}
        />
      ) : kind === "gantt" ? (
        <GanttView
          {...viewProps}
          onShiftDates={(task, s, d) =>
            updateTask(task, { startDate: s, dueDate: d }, { startDate: s, dueDate: d })
          }
        />
      ) : (
        <TimelineView {...viewProps} />
      )}

      {selectedTask && (
        <TaskPanel
          taskId={selectedTask}
          statuses={statuses}
          members={members}
          canEdit={canEdit}
          canComment={canEdit}
          onClose={() => setSelectedTask(null)}
          onChanged={loadTasks}
          onOpenTask={(tid) => setSelectedTask(tid)}
        />
      )}
    </div>
  );
}
