"use client";

/**
 * List page (Module 5) — the view-switching shell. Owns task/status/tag/
 * member loading, the saved-view state, filter/sort/group config and the
 * Task panel, then renders one of the five live views (List, Board,
 * Calendar, Table, Gantt). Filters and sort are applied centrally
 * (lib/viewUtils) so every view sees the same task set.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  getUser,
  hierarchyApi,
  permissionAtLeast,
  statusesApi,
  tagsApi,
  tasksApi,
  viewsApi,
  workspacesApi,
  type List,
  type Member,
  type Status,
  type Tag,
  type TaskCard,
  type TaskUpdateBody,
  type View,
  type ViewConfig,
  type ViewKind,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { useRealtime } from "@/lib/realtime";
import { colorFor } from "@/lib/format";
import { activeFilterCount, applyView } from "@/lib/viewUtils";
import { useHierarchy } from "@/components/HierarchyProvider";
import { TaskPanel } from "@/components/TaskPanel";
import { StatusManager } from "@/components/StatusManager";
import { ViewTabs, type ActiveTab } from "@/components/views/ViewTabs";
import { FilterBar } from "@/components/views/FilterBar";
import { ListView } from "@/components/views/ListView";
import { BoardView } from "@/components/views/BoardView";
import { CalendarView } from "@/components/views/CalendarView";
import { TableView } from "@/components/views/TableView";
import { GanttView } from "@/components/views/GanttView";

interface ListMeta {
  list: List;
  space: { id: string; name: string; color: string; icon: string | null };
  folder: { id: string; name: string } | null;
}

const KINDS: ViewKind[] = ["list", "board", "calendar", "table", "gantt"];
const DEFAULT_CONFIG: ViewConfig = { filters: {}, sort: null, groupBy: "status" };

/* localStorage helpers (guarded for the static export). */
function readStoredTab(listId: string): string | null {
  try {
    return localStorage.getItem(`stackup.view.${listId}`);
  } catch {
    return null;
  }
}
function storeTab(listId: string, tab: string): void {
  try {
    localStorage.setItem(`stackup.view.${listId}`, tab);
  } catch {
    /* ignore */
  }
}

function normalizeConfig(c: ViewConfig | null | undefined): ViewConfig {
  return {
    filters: c?.filters ?? {},
    sort: c?.sort ?? null,
    groupBy: c?.groupBy ?? "status",
  };
}

function ListShell() {
  const search = useSearchParams();
  const id = search.get("id");
  const { tree } = useHierarchy();

  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [active, setActive] = useState<ActiveTab>({ kind: "list", viewId: null });
  const [config, setConfig] = useState<ViewConfig>(DEFAULT_CONFIG);
  const [addSignal, setAddSignal] = useState(0);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [managingStatuses, setManagingStatuses] = useState(false);
  const pendingViewTab = useRef<string | null>(null);

  const spaceId = meta?.space.id;
  const me = getUser();

  // Edit gating from the space's effective permission (from the shared tree).
  const canEdit = useMemo(() => {
    if (!spaceId) return false;
    const s = tree.find((sp) => sp.id === spaceId);
    // Unknown (private/not-yet-loaded) → optimistic; the API still enforces.
    return s ? permissionAtLeast(s.myPermission, "edit") : true;
  }, [tree, spaceId]);

  // Comment gating (Module 6): 'comment' or better shows the composer.
  const canComment = useMemo(() => {
    if (!spaceId) return false;
    const s = tree.find((sp) => sp.id === spaceId);
    return s ? permissionAtLeast(s.myPermission, "comment") : true;
  }, [tree, spaceId]);

  /* -- loading ------------------------------------------------------- */
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

  const loadTags = useCallback((sid: string): Promise<void> => {
    return tagsApi
      .list(sid)
      .then((r) => setTags(r.tags))
      .catch(() => undefined);
  }, []);

  const loadViews = useCallback((): Promise<void> => {
    if (!id) return Promise.resolve();
    return viewsApi
      .list(id)
      .then((r) => setViews([...r.views].sort((a, b) => a.position - b.position)))
      .catch(() => undefined); // degrade gracefully if the API isn't there yet
  }, [id]);

  // List meta first (gives us the space); then statuses + tags + tasks + views.
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setTasks(null);
    setViews([]);
    setConfig(DEFAULT_CONFIG);
    setSelectedTask(null);

    // Restore the last-used tab for this list.
    const stored = readStoredTab(id);
    if (stored && stored.startsWith("view:")) {
      pendingViewTab.current = stored.slice(5);
      setActive({ kind: "list", viewId: null });
    } else if (stored && (KINDS as string[]).includes(stored)) {
      pendingViewTab.current = null;
      setActive({ kind: stored as ViewKind, viewId: null });
    } else {
      pendingViewTab.current = null;
      setActive({ kind: "list", viewId: null });
    }

    hierarchyApi
      .getList(id)
      .then(async (r) => {
        setMeta(r);
        setError("");
        await Promise.all([
          loadStatuses(r.space.id),
          loadTags(r.space.id),
          loadTasks(),
          loadViews(),
        ]);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this list."),
      )
      .finally(() => setLoading(false));
  }, [id, loadStatuses, loadTags, loadTasks, loadViews]);

  // Once views arrive, re-select a stored saved-view tab.
  useEffect(() => {
    const vid = pendingViewTab.current;
    if (!vid || views.length === 0) return;
    const v = views.find((x) => x.id === vid);
    if (v) {
      pendingViewTab.current = null;
      setActive({ kind: v.kind, viewId: v.id });
      setConfig(normalizeConfig(v.config));
    }
  }, [views]);

  useEffect(() => {
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, []);

  // Deep link (Inbox → task): /list?id=<listId>&task=<taskId> opens the panel.
  const taskParam = search.get("task");
  useEffect(() => {
    if (taskParam) setSelectedTask(taskParam);
  }, [taskParam]);

  // Module 6 — live: another session changed a task in THIS list →
  // debounce 400ms, then refetch quietly (no spinner: loadTasks keeps
  // the current rows until the fresh set lands).
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(
    (e) => {
      if (e.type === "task.changed" && id && e.payload.listId === id) {
        if (liveTimer.current) clearTimeout(liveTimer.current);
        liveTimer.current = setTimeout(() => {
          liveTimer.current = null;
          void loadTasks();
        }, 400);
      }
    },
    [id, loadTasks],
  );
  useEffect(
    () => () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    [],
  );

  /* -- view/tab state ------------------------------------------------ */
  const selectBuiltin = (kind: ViewKind): void => {
    setActive({ kind, viewId: null });
    if (id) storeTab(id, kind);
  };

  const selectView = (v: View): void => {
    setActive({ kind: v.kind, viewId: v.id });
    setConfig(normalizeConfig(v.config));
    if (id) storeTab(id, `view:${v.id}`);
  };

  const canManageView = (v: View): boolean =>
    v.createdBy === me?.id || (v.isShared && canEdit);

  const changeConfig = (next: ViewConfig): void => {
    setConfig(next);
    // Autosave into the active saved view when the user may edit it.
    if (active.viewId) {
      const v = views.find((x) => x.id === active.viewId);
      if (v && canManageView(v)) {
        setViews((prev) => prev.map((x) => (x.id === v.id ? { ...x, config: next } : x)));
        viewsApi.update(v.id, { config: next }).catch(() => undefined);
      }
    }
  };

  const saveView = (name: string, isShared: boolean): void => {
    if (!id) return;
    viewsApi
      .create(id, { name, kind: active.kind, config, isShared })
      .then((r) => {
        setViews((prev) => [...prev, r.view]);
        setActive({ kind: r.view.kind, viewId: r.view.id });
        storeTab(id, `view:${r.view.id}`);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't save the view."),
      );
  };

  const renameView = (v: View, name: string): void => {
    setViews((prev) => prev.map((x) => (x.id === v.id ? { ...x, name } : x)));
    viewsApi.update(v.id, { name }).catch(() => void loadViews());
  };

  const deleteView = (v: View): void => {
    if (!window.confirm(`Delete the view “${v.name}”?`)) return;
    setViews((prev) => prev.filter((x) => x.id !== v.id));
    if (active.viewId === v.id) {
      setActive({ kind: v.kind, viewId: null });
      if (id) storeTab(id, v.kind);
    }
    viewsApi.remove(v.id).catch(() => void loadViews());
  };

  /* -- task mutations ------------------------------------------------ */
  const changeStatus = (task: TaskCard, statusId: string): void => {
    const target = statuses.find((s) => s.id === statusId);
    if (!target) return;
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

  const quickAddDate = (dueDate: string, name: string): void => {
    const trimmed = name.trim();
    if (!id || !trimmed) return;
    tasksApi
      .create(id, { name: trimmed, statusId: statuses[0]?.id, dueDate })
      .then(() => loadTasks())
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't create the task."),
      );
  };

  /** Optimistic PATCH used by the Table/Calendar/Gantt inline edits. */
  const updateTask = (
    task: TaskCard,
    body: TaskUpdateBody,
    optimistic?: Partial<TaskCard>,
  ): void => {
    if (optimistic) {
      setTasks((prev) =>
        (prev ?? []).map((t) => (t.id === task.id ? { ...t, ...optimistic } : t)),
      );
    }
    tasksApi
      .update(task.id, body)
      .then(() => {
        if (!optimistic) void loadTasks();
      })
      .catch(() => void loadTasks());
  };

  const toggleAssignee = (task: TaskCard, userId: string, on: boolean): void => {
    const call = on
      ? tasksApi.addAssignee(task.id, userId)
      : tasksApi.removeAssignee(task.id, userId);
    // Optimistic avatar update from the workspace member list.
    setTasks((prev) =>
      (prev ?? []).map((t) => {
        if (t.id !== task.id) return t;
        if (on) {
          const m = members.find((x) => x.id === userId);
          if (!m || t.assignees.some((a) => a.id === userId)) return t;
          return {
            ...t,
            assignees: [...t.assignees, { id: m.id, fullName: m.fullName, avatarUrl: m.avatarUrl }],
          };
        }
        return { ...t, assignees: t.assignees.filter((a) => a.id !== userId) };
      }),
    );
    call.catch(() => void loadTasks());
  };

  const toggleTag = (task: TaskCard, tagId: string, on: boolean): void => {
    const call = on ? tasksApi.addTag(task.id, tagId) : tasksApi.removeTag(task.id, tagId);
    setTasks((prev) =>
      (prev ?? []).map((t) => {
        if (t.id !== task.id) return t;
        if (on) {
          const tag = tags.find((x) => x.id === tagId);
          if (!tag || t.tags.some((x) => x.id === tagId)) return t;
          return { ...t, tags: [...t.tags, tag] };
        }
        return { ...t, tags: t.tags.filter((x) => x.id !== tagId) };
      }),
    );
    call.catch(() => void loadTasks());
  };

  /** Board DnD drop: move `taskId` into `statusId` with the column's id order. */
  const moveTask = (taskId: string, statusId: string, orderedIds: string[]): void => {
    if (!id) return;
    const target = statuses.find((s) => s.id === statusId);
    const pos = new Map(orderedIds.map((tid, i) => [tid, i]));
    setTasks((prev) =>
      (prev ?? []).map((t) => {
        let next = t;
        if (t.id === taskId && target) {
          next = {
            ...t,
            statusId,
            status: { id: target.id, name: target.name, color: target.color, type: target.type },
          };
        }
        const p = pos.get(t.id);
        if (p !== undefined) next = { ...next, position: p };
        return next;
      }),
    );
    tasksApi.reorder(id, statusId, orderedIds).catch(() => void loadTasks());
  };

  /* -- derived ------------------------------------------------------- */
  const visibleTasks = useMemo(
    () => (tasks === null ? [] : applyView(tasks, config)),
    [tasks, config],
  );
  const filtersActive = activeFilterCount(config.filters) > 0;

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
  const kind = active.kind;

  const viewProps = {
    tasks: visibleTasks,
    statuses,
    members,
    canEdit,
    onOpenTask: (tid: string) => setSelectedTask(tid),
    onChanged: () => void loadTasks(),
    listId: id,
  };

  const showNoStatuses = statuses.length === 0 && (kind === "list" || kind === "board");

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
              {(kind === "list" || kind === "board") && statuses.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setAddSignal((n) => n + 1)}
                >
                  {Icons.plus} New Task
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* view tabs */}
      <ViewTabs
        active={active}
        savedViews={views}
        canEdit={canEdit}
        currentUserId={me?.id ?? null}
        onSelectBuiltin={selectBuiltin}
        onSelectView={selectView}
        onSaveView={saveView}
        onRenameView={renameView}
        onDeleteView={deleteView}
      />

      {/* filter / sort / group */}
      <FilterBar
        statuses={statuses}
        members={members}
        tags={tags}
        config={config}
        onChange={changeConfig}
        showGroup={kind === "list" || kind === "board"}
      />

      {error && <div className="form-error">{error}</div>}

      {/* the active view */}
      {tasks === null ? (
        <div className="task-groups">
          <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
          <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
          <span className="skel" style={{ width: "100%", height: 44 }} />
        </div>
      ) : showNoStatuses ? (
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
      ) : kind === "list" ? (
        <ListView
          {...viewProps}
          groupBy={config.groupBy ?? "status"}
          onChangeStatus={changeStatus}
          onDelete={deleteTask}
          onQuickAdd={quickAdd}
          addSignal={addSignal}
          filtersActive={filtersActive}
        />
      ) : kind === "board" ? (
        <BoardView
          {...viewProps}
          groupBy={config.groupBy ?? "status"}
          onQuickAdd={quickAdd}
          onMoveTask={moveTask}
          onManageStatuses={() => setManagingStatuses(true)}
          addSignal={addSignal}
        />
      ) : kind === "calendar" ? (
        <CalendarView
          {...viewProps}
          onQuickAddDate={quickAddDate}
          onSetDueDate={(task, due) => updateTask(task, { dueDate: due }, { dueDate: due })}
        />
      ) : kind === "table" ? (
        <TableView
          {...viewProps}
          tags={tags}
          sort={config.sort ?? null}
          onSortChange={(s) => changeConfig({ ...config, sort: s })}
          onUpdateTask={updateTask}
          onToggleAssignee={toggleAssignee}
          onToggleTag={toggleTag}
          onQuickAdd={quickAdd}
        />
      ) : (
        <GanttView
          {...viewProps}
          onShiftDates={(task, s, d) =>
            updateTask(task, { startDate: s, dueDate: d }, { startDate: s, dueDate: d })
          }
        />
      )}

      {selectedTask && (
        <TaskPanel
          taskId={selectedTask}
          statuses={statuses}
          members={members}
          canEdit={canEdit}
          canComment={canComment}
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

export default function ListPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 16 }} />
        </div>
      }
    >
      <ListShell />
    </Suspense>
  );
}
