"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  hierarchyApi,
  permissionAtLeast,
  statusesApi,
  tasksApi,
  workspacesApi,
  type List,
  type Member,
  type Status,
  type TaskCard,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { useHierarchy } from "@/components/HierarchyProvider";
import { TaskRow } from "@/components/TaskRow";
import { TaskPanel } from "@/components/TaskPanel";
import { StatusManager } from "@/components/StatusManager";

interface ListMeta {
  list: List;
  space: { id: string; name: string; color: string; icon: string | null };
  folder: { id: string; name: string } | null;
}

const VIEWS = ["List", "Board", "Calendar"] as const;

function ListView() {
  const search = useSearchParams();
  const id = search.get("id");
  const { tree } = useHierarchy();

  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<(typeof VIEWS)[number]>("List");

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [managingStatuses, setManagingStatuses] = useState(false);

  const spaceId = meta?.space.id;

  // Edit gating from the space's effective permission (from the shared tree).
  const canEdit = useMemo(() => {
    if (!spaceId) return false;
    const s = tree.find((sp) => sp.id === spaceId);
    // Unknown (private/not-yet-loaded) → optimistic; the API still enforces.
    return s ? permissionAtLeast(s.myPermission, "edit") : true;
  }, [tree, spaceId]);

  const loadTasks = useCallback((): Promise<void> => {
    if (!id) return Promise.resolve();
    return tasksApi
      .listForList(id)
      .then((r) => setTasks(r.tasks))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load tasks."),
      );
  }, [id]);

  const loadStatuses = useCallback((sid: string): Promise<void> => {
    return statusesApi
      .list(sid)
      .then((r) => setStatuses([...r.statuses].sort((a, b) => a.position - b.position)))
      .catch(() => undefined);
  }, []);

  // List meta first (gives us the space); then statuses + tasks.
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setTasks(null);
    hierarchyApi
      .getList(id)
      .then(async (r) => {
        setMeta(r);
        setError("");
        await Promise.all([loadStatuses(r.space.id), loadTasks()]);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this list."),
      )
      .finally(() => setLoading(false));
  }, [id, loadStatuses, loadTasks]);

  useEffect(() => {
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, []);

  const toggleGroup = (statusId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(statusId)) next.delete(statusId);
      else next.add(statusId);
      return next;
    });
  };

  // Group tasks by status, in status position order.
  const grouped = useMemo(() => {
    const byStatus = new Map<string, TaskCard[]>();
    for (const s of statuses) byStatus.set(s.id, []);
    for (const t of tasks ?? []) {
      if (!byStatus.has(t.statusId)) byStatus.set(t.statusId, []);
      byStatus.get(t.statusId)!.push(t);
    }
    for (const arr of byStatus.values()) arr.sort((a, b) => a.position - b.position);
    return byStatus;
  }, [statuses, tasks]);

  /* -- mutations ----------------------------------------------------- */
  const changeStatus = (task: TaskCard, statusId: string): void => {
    const target = statuses.find((s) => s.id === statusId);
    if (!target) return;
    // Optimistic move between groups.
    setTasks((prev) =>
      (prev ?? []).map((t) =>
        t.id === task.id
          ? {
              ...t,
              statusId,
              status: { id: target.id, name: target.name, color: target.color, type: target.type },
            }
          : t,
      ),
    );
    tasksApi.update(task.id, { statusId }).catch(() => void loadTasks());
  };

  const deleteTask = (task: TaskCard): void => {
    if (!window.confirm(`Delete “${task.name}”? This can't be undone.`)) return;
    setTasks((prev) => (prev ?? []).filter((t) => t.id !== task.id));
    tasksApi.remove(task.id).catch(() => void loadTasks());
  };

  const quickAdd = (statusId: string, name: string): void => {
    const trimmed = name.trim();
    if (!id || !trimmed) return;
    tasksApi
      .create(id, { name: trimmed, statusId })
      .then(() => loadTasks())
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't create the task."),
      );
  };

  const startNewTask = (): void => {
    if (statuses.length > 0) {
      const first = statuses[0].id;
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(first);
        return next;
      });
      setAddingIn(first);
    }
  };

  /* -- guards -------------------------------------------------------- */
  if (!id) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.list}</span>
          <h3>No list selected</h3>
          <p>Choose a list from the sidebar to open it.</p>
        </div>
      </div>
    );
  }

  if (loading && !meta) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 16, marginBottom: 14 }} />
        <span className="skel" style={{ width: 200, height: 30, marginBottom: 18 }} />
        <span className="skel" style={{ width: "100%", height: 180 }} />
      </div>
    );
  }

  if ((error && !meta) || !meta) {
    return (
      <div className="page">
        <div className="form-error">{error || "List not found."}</div>
        <Link href="/everything" className="btn btn-soft">Back to Everything</Link>
      </div>
    );
  }

  const { list, space, folder } = meta;
  const spaceColor = space.color || colorFor(space.id);
  const listColor = list.color || colorFor(list.id);
  const totalTasks = tasks?.length ?? 0;

  return (
    <div className="page">
      {/* breadcrumb */}
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href={`/space?id=${space.id}`} className="crumb">
          <span className="crumb-dot" style={{ background: spaceColor }} />
          {space.icon ? <span className="crumb-emoji">{space.icon}</span> : null}
          {space.name}
        </Link>
        {folder && (
          <>
            <span className="crumb-sep">{Icons.chevronRight}</span>
            <span className="crumb muted">{Icons.folder} {folder.name}</span>
          </>
        )}
        <span className="crumb-sep">{Icons.chevronRight}</span>
        <span className="crumb current">{list.name}</span>
      </nav>

      {/* header */}
      <div className="list-head">
        <span className="list-head-dot" style={{ background: listColor }} />
        <h1>{list.name}</h1>
        <div className="list-head-actions">
          {canEdit && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManagingStatuses(true)}>
                {Icons.settings} Statuses
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={startNewTask}>
                {Icons.plus} New Task
              </button>
            </>
          )}
        </div>
      </div>

      {/* view switcher */}
      <div className="view-tabs" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={`view-tab${view === v ? " active" : ""}`}
            onClick={() => setView(v)}
            title={v === "List" ? undefined : `${v} view — coming soon`}
          >
            {v}
            {v !== "List" && <span className="view-tab-soon">Soon</span>}
          </button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* tasks */}
      {view !== "List" ? (
        <div className="card task-placeholder">
          <div className="empty-state">
            <span className="empty-ic">{Icons.tasks}</span>
            <h3>{view} view is coming soon</h3>
            <p>The List view is live — {view} arrives in a later module.</p>
            <span className="badge badge-soon">{view} · soon</span>
          </div>
        </div>
      ) : tasks === null ? (
        <div className="task-groups">
          <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
          <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
          <span className="skel" style={{ width: "100%", height: 44 }} />
        </div>
      ) : statuses.length === 0 ? (
        <div className="card task-placeholder">
          <div className="empty-state">
            <span className="empty-ic">{Icons.circle}</span>
            <h3>No statuses yet</h3>
            <p>Add a status or two to start tracking work in this space.</p>
            {canEdit && (
              <button type="button" className="btn btn-primary" onClick={() => setManagingStatuses(true)}>
                {Icons.plus} Set up statuses
              </button>
            )}
          </div>
        </div>
      ) : totalTasks === 0 && addingIn === null ? (
        <div className="card task-placeholder">
          <div className="empty-state">
            <span className="empty-ic">{Icons.tasks}</span>
            <h3>No tasks yet</h3>
            <p>This list is a blank canvas. Add your first task to get going.</p>
            {canEdit && (
              <button type="button" className="btn btn-primary" onClick={startNewTask}>
                {Icons.plus} Add a task
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="task-groups">
          {statuses.map((s) => {
            const rows = grouped.get(s.id) ?? [];
            const isCollapsed = collapsed.has(s.id);
            const dot = s.color || colorFor(s.id);
            return (
              <div className="task-group" key={s.id}>
                <div className="task-group-head" onClick={() => toggleGroup(s.id)}>
                  <span className={`task-group-caret${isCollapsed ? "" : " open"}`}>
                    {Icons.chevronRight}
                  </span>
                  <span className="status-dot lg" style={{ background: dot }} />
                  <span className="task-group-name">{s.name}</span>
                  <span className="task-group-count">{rows.length}</span>
                </div>
                {!isCollapsed && (
                  <div className="task-group-body">
                    {rows.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        statuses={statuses}
                        canEdit={canEdit}
                        onOpen={() => setSelectedTask(t.id)}
                        onChangeStatus={(sid) => changeStatus(t, sid)}
                        onDelete={() => deleteTask(t)}
                      />
                    ))}
                    {rows.length === 0 && addingIn !== s.id && (
                      <div className="task-group-empty">No tasks</div>
                    )}
                    {canEdit &&
                      (addingIn === s.id ? (
                        <QuickAdd
                          onCommit={(name) => quickAdd(s.id, name)}
                          onClose={() => setAddingIn(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="task-add"
                          onClick={() => setAddingIn(s.id)}
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
      )}

      {selectedTask && (
        <TaskPanel
          taskId={selectedTask}
          statuses={statuses}
          members={members}
          canEdit={canEdit}
          onClose={() => setSelectedTask(null)}
          onChanged={() => void loadTasks()}
          onOpenTask={(tid) => setSelectedTask(tid)}
        />
      )}

      {managingStatuses && spaceId && (
        <StatusManager
          spaceId={spaceId}
          spaceName={space.name}
          onClose={() => setManagingStatuses(false)}
          onChanged={() => void loadStatuses(spaceId)}
        />
      )}
    </div>
  );
}

/* Inline quick-add: keeps focus so several tasks can be added in a row. */
function QuickAdd({
  onCommit,
  onClose,
}: {
  onCommit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="task-quickadd">
      <span className="status-circle-ghost">{Icons.circle}</span>
      <input
        autoFocus
        className="task-quickadd-input"
        placeholder="Task name — Enter to add, Esc to close"
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

export default function ListPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 16 }} />
        </div>
      }
    >
      <ListView />
    </Suspense>
  );
}
