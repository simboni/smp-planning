"use client";

/**
 * TaskPanel — the ClickUp-style right-side slide-over for a single task.
 *
 * Opened with a taskId, it fetches `GET /tasks/:id` and renders every editable
 * facet of a task: status pill, title, assignees, dates, priority, time
 * estimate, tags, description, subtasks, checklists, watchers, and a
 * placeholder for comments/activity (Module 6). Each edit PATCHes immediately,
 * the panel reloads its own detail, and `onChanged` fires so the List view
 * underneath refetches. Read-only when `canEdit` is false.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  fieldsApi,
  getUser,
  relationsApi,
  tagsApi,
  tasksApi,
  taskTypesApi,
  type Checklist,
  type CustomFieldType,
  type FieldValue,
  type Member,
  type Priority,
  type Recurrence,
  type RecurrenceFreq,
  type Status,
  type Tag,
  type TaskCard,
  type TaskDetail,
  type TaskFieldEntry,
  type TaskRef,
  type TaskType,
} from "@/lib/api";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor, formatEstimate, initials, toDateInputValue } from "@/lib/format";
import { AvatarStack, DueChip, MilestoneMark, PriorityFlag, StatusCircle, TagChip, TypeIcon } from "@/components/TaskBits";
import { FieldManager } from "@/components/FieldManager";
import { CommentsActivity } from "@/components/CommentsActivity";
import { Attachments } from "@/components/Attachments";
import { TaskEmail } from "@/components/TaskEmail";
import { TimeTracking } from "@/components/TimeTracking";
import { saveEntityAsTemplate } from "@/lib/toast";
import { useRealtime } from "@/lib/realtime";

/* ------------------------------------------------------------------ *
 * A small popover shell that closes on outside click / Esc.
 * ------------------------------------------------------------------ */
function Popover({
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
 * Member picker — used by assignees & watchers.
 * ------------------------------------------------------------------ */
function MemberPicker({
  members,
  selectedIds,
  onToggle,
  onClose,
}: {
  members: Member[];
  selectedIds: Set<string>;
  onToggle: (userId: string) => void;
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
            const on = selectedIds.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={`tp-pop-opt${on ? " on" : ""}`}
                onClick={() => onToggle(m.id)}
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

/* ------------------------------------------------------------------ *
 * The panel.
 * ------------------------------------------------------------------ */
export function TaskPanel({
  taskId,
  statuses,
  members,
  canEdit,
  canComment,
  onClose,
  onChanged,
  onOpenTask,
}: {
  taskId: string;
  statuses: Status[];
  members: Member[];
  canEdit: boolean;
  /** Space permission ≥ 'comment' — gates the comment composer. */
  canComment: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [managingFields, setManagingFields] = useState(false);

  // Local editable drafts.
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);

  // Popover open-state (single-open at a time keyed by name).
  const [pop, setPop] = useState<string | null>(null);
  const [subInput, setSubInput] = useState(false);
  const [addingChecklist, setAddingChecklist] = useState(false);

  const me = getUser();

  const reload = async (): Promise<void> => {
    try {
      const r = await tasksApi.get(taskId);
      setDetail(r.task);
      setTitleDraft(r.task.name);
      if (!editingDesc) setDescDraft(r.task.description ?? "");
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this task.");
    }
  };

  useEffect(() => {
    setDetail(null);
    setError("");
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Module 6 — live: another session changed this task → quiet refetch.
  useRealtime(
    (e) => {
      if (e.type === "task.changed" && e.payload.taskId === taskId) void reload();
    },
    [taskId],
  );

  // Load the space's tags + task types once we know which space the task is in.
  useEffect(() => {
    if (!detail) return;
    tagsApi
      .list(detail.spaceId)
      .then((r) => setTags(r.tags))
      .catch(() => undefined);
    taskTypesApi
      .list(detail.spaceId)
      .then((r) => setTaskTypes(r.taskTypes))
      .catch(() => undefined);
  }, [detail?.spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Run a mutation, then reload detail + notify the list. */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const assignedIds = useMemo(
    () => new Set((detail?.assignees ?? []).map((a) => a.id)),
    [detail],
  );
  const watcherIds = useMemo(
    () => new Set((detail?.watchers ?? []).map((w) => w.id)),
    [detail],
  );
  const tagIds = useMemo(
    () => new Set((detail?.tags ?? []).map((t) => t.id)),
    [detail],
  );

  /* -- field mutations ----------------------------------------------- */
  const saveTitle = (): void => {
    const v = titleDraft.trim();
    if (!detail || !v || v === detail.name) return;
    void run(() => tasksApi.update(detail.id, { name: v }));
  };
  const saveDesc = (): void => {
    setEditingDesc(false);
    if (!detail || descDraft === (detail.description ?? "")) return;
    void run(() => tasksApi.update(detail.id, { description: descDraft }));
  };
  const setStatus = (statusId: string): void => {
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { statusId }));
  };
  const setPriority = (priority: Priority | null): void => {
    setPop(null);
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { priority }));
  };
  const setDate = (field: "startDate" | "dueDate", value: string): void => {
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { [field]: value || null }));
  };
  const setEstimate = (minutes: number | null): void => {
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { timeEstimateMinutes: minutes }));
  };
  const setSprintPoints = (points: number | null): void => {
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { sprintPoints: points }));
  };

  /* -- Module 4 mutations -------------------------------------------- */
  const setTaskType = (taskTypeId: string | null): void => {
    setPop(null);
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { taskTypeId }));
  };
  const toggleMilestone = (): void => {
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { isMilestone: !detail.isMilestone }));
  };
  const setRecurrence = (recurrence: Recurrence | null): void => {
    if (!detail) return;
    void run(() => tasksApi.update(detail.id, { recurrence }));
  };
  const saveField = (fieldId: string, value: FieldValue | null): void => {
    if (!detail) return;
    void run(() => fieldsApi.setTaskField(detail.id, fieldId, value));
  };
  const addDependency = (depTaskId: string): void => {
    setPop(null);
    if (!detail) return;
    void run(() => relationsApi.addDependency(detail.id, depTaskId));
  };
  const removeDependency = (taskId: string, depId: string): void => {
    void run(() => relationsApi.removeDependency(taskId, depId));
  };
  const addLink = (otherTaskId: string): void => {
    setPop(null);
    if (!detail) return;
    void run(() => relationsApi.addLink(detail.id, otherTaskId));
  };
  const removeLink = (otherTaskId: string): void => {
    if (!detail) return;
    void run(() => relationsApi.removeLink(detail.id, otherTaskId));
  };

  const toggleAssignee = (userId: string): void => {
    if (!detail) return;
    void run(() =>
      assignedIds.has(userId)
        ? tasksApi.removeAssignee(detail.id, userId)
        : tasksApi.addAssignee(detail.id, userId),
    );
  };
  const toggleTag = (tagId: string): void => {
    if (!detail) return;
    void run(() =>
      tagIds.has(tagId)
        ? tasksApi.removeTag(detail.id, tagId)
        : tasksApi.addTag(detail.id, tagId),
    );
  };
  const createAndAddTag = (name: string): void => {
    if (!detail || !name.trim()) return;
    void run(async () => {
      const r = await tagsApi.create(detail.spaceId, { name: name.trim() });
      setTags((prev) => [...prev, r.tag]);
      await tasksApi.addTag(detail.id, r.tag.id);
    });
  };
  const toggleWatch = (): void => {
    if (!detail || !me) return;
    void run(() =>
      watcherIds.has(me.id)
        ? tasksApi.removeWatcher(detail.id, me.id)
        : tasksApi.addWatcher(detail.id, me.id),
    );
  };

  const addSubtask = (name: string): void => {
    setSubInput(false);
    if (!detail || !name.trim()) return;
    void run(() => tasksApi.createSubtask(detail.id, { name: name.trim() }));
  };
  const deleteTask = (): void => {
    if (!detail || busy) return;
    if (!window.confirm(`Delete “${detail.name}”? This can't be undone.`)) return;
    setBusy(true);
    tasksApi
      .remove(detail.id)
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't delete this task.");
        setBusy(false);
      });
  };

  /* -- checklist mutations ------------------------------------------- */
  const addChecklist = (name: string): void => {
    setAddingChecklist(false);
    if (!detail) return;
    const n = name.trim();
    void run(() => tasksApi.createChecklist(detail.id, n ? { name: n } : {}));
  };
  const renameChecklist = (cl: Checklist, name: string): void => {
    const v = name.trim();
    if (!v || v === cl.name) return;
    void run(() => tasksApi.updateChecklist(cl.id, { name: v }));
  };
  const deleteChecklist = (cl: Checklist): void => {
    if (!window.confirm(`Delete checklist “${cl.name}”?`)) return;
    void run(() => tasksApi.removeChecklist(cl.id));
  };
  const addItem = (checklistId: string, name: string): void => {
    if (!name.trim()) return;
    void run(() => tasksApi.createChecklistItem(checklistId, { name: name.trim() }));
  };
  const toggleItem = (itemId: string, resolved: boolean): void => {
    void run(() => tasksApi.updateChecklistItem(itemId, { resolved }));
  };
  const renameItem = (itemId: string, name: string, prev: string): void => {
    const v = name.trim();
    if (!v || v === prev) return;
    void run(() => tasksApi.updateChecklistItem(itemId, { name: v }));
  };
  const assignItem = (itemId: string, userId: string | null): void => {
    void run(() => tasksApi.updateChecklistItem(itemId, { assigneeUserId: userId }));
  };
  const deleteItem = (itemId: string): void => {
    void run(() => tasksApi.removeChecklistItem(itemId));
  };

  /* -- render -------------------------------------------------------- */
  const bc = detail?.breadcrumb;
  // Blocked = waiting on tasks that aren't done yet.
  const unresolvedCount = useMemo(
    () => (detail?.waitingOn ?? []).filter((t) => t.status?.type !== "done").length,
    [detail],
  );
  const depExclude = useMemo(
    () =>
      new Set([
        ...(detail ? [detail.id] : []),
        ...(detail?.waitingOn ?? []).map((t) => t.id),
        ...(detail?.blocking ?? []).map((t) => t.id),
      ]),
    [detail],
  );
  const linkExclude = useMemo(
    () => new Set([...(detail ? [detail.id] : []), ...(detail?.linked ?? []).map((t) => t.id)]),
    [detail],
  );

  return (
    <div className="tp-scrim" onClick={onClose}>
      <aside
        className="tp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="tp-head">
          <div className="tp-crumbs">
            {bc ? (
              <>
                <span className="tp-crumb">
                  <span
                    className="crumb-dot"
                    style={{ background: bc.space.color || colorFor(bc.space.id) }}
                  />
                  {bc.space.icon ? <span className="crumb-emoji">{bc.space.icon}</span> : null}
                  {bc.space.name}
                </span>
                {bc.folder && (
                  <>
                    <span className="crumb-sep">{Icons.chevronRight}</span>
                    <span className="tp-crumb muted">{bc.folder.name}</span>
                  </>
                )}
                <span className="crumb-sep">{Icons.chevronRight}</span>
                <span className="tp-crumb">{bc.list.name}</span>
              </>
            ) : (
              <span className="muted">Task</span>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        {error && !detail ? (
          <div className="tp-body">
            <div className="form-error">{error}</div>
          </div>
        ) : !detail ? (
          <div className="tp-body">
            <span className="skel" style={{ width: "60%", height: 28, marginBottom: 18 }} />
            <span className="skel" style={{ width: "100%", height: 40, marginBottom: 10 }} />
            <span className="skel" style={{ width: "100%", height: 40, marginBottom: 10 }} />
            <span className="skel" style={{ width: "100%", height: 120 }} />
          </div>
        ) : (
          <div className="tp-body">
            {error && <div className="form-error">{error}</div>}

            {/* status pill + parent link */}
            <div className="tp-top">
              <StatusPill
                status={detail.status}
                statuses={statuses}
                canEdit={canEdit}
                open={pop === "status"}
                onOpen={() => setPop(pop === "status" ? null : "status")}
                onPick={(id) => {
                  setPop(null);
                  setStatus(id);
                }}
              />
              <TypeSelector
                taskType={detail.taskType}
                taskTypes={taskTypes}
                canEdit={canEdit}
                open={pop === "tasktype"}
                onOpen={() => setPop(pop === "tasktype" ? null : "tasktype")}
                onPick={setTaskType}
              />
              {canEdit ? (
                <button
                  type="button"
                  className={`tp-mile-btn${detail.isMilestone ? " on" : ""}`}
                  title={detail.isMilestone ? "Unmark milestone" : "Mark as milestone"}
                  onClick={toggleMilestone}
                >
                  {Icons.diamondFill} Milestone
                </button>
              ) : (
                detail.isMilestone && (
                  <span className="tp-mile-btn on ro">{Icons.diamondFill} Milestone</span>
                )
              )}
              {detail.parentTaskId && (
                <button
                  type="button"
                  className="tp-parent-link"
                  onClick={() => onOpenTask(detail.parentTaskId!)}
                >
                  {Icons.subtask} Parent task
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Save as template"
                  aria-label="Save task as template"
                  onClick={() => void saveEntityAsTemplate("task", detail.id, `${detail.name} template`)}
                >
                  {Icons.copy}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="icon-btn tp-del"
                  title="Delete task"
                  onClick={deleteTask}
                >
                  {Icons.trash}
                </button>
              )}
            </div>

            {/* blocked warning */}
            {unresolvedCount > 0 && (
              <div className="tp-blocked-banner">
                {Icons.ban}
                <span>
                  Blocked by {unresolvedCount} task{unresolvedCount === 1 ? "" : "s"} — this task
                  is waiting on unresolved work.
                </span>
              </div>
            )}

            {/* title */}
            <div className="tp-title-row">
              {detail.isMilestone && <MilestoneMark size={16} />}
              {canEdit ? (
                <textarea
                  className="tp-title-input"
                  rows={1}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                    }
                  }}
                  placeholder="Task name"
                />
              ) : (
                <h1 className="tp-title-ro">{detail.name}</h1>
              )}
            </div>

            {/* properties */}
            <div className="tp-props">
              {/* Assignees */}
              <div className="tp-prop">
                <span className="tp-prop-label">{Icons.members} Assignees</span>
                <div className="tp-prop-val">
                  {detail.assignees.length > 0 ? (
                    <AvatarStack users={detail.assignees} max={5} size={26} />
                  ) : (
                    <span className="tp-empty">Unassigned</span>
                  )}
                  {canEdit && (
                    <div className="tp-pop-anchor">
                      <button
                        type="button"
                        className="tp-add-btn"
                        aria-label="Edit assignees"
                        onClick={() => setPop(pop === "assignees" ? null : "assignees")}
                      >
                        {Icons.userPlus}
                      </button>
                      {pop === "assignees" && (
                        <MemberPicker
                          members={members}
                          selectedIds={assignedIds}
                          onToggle={toggleAssignee}
                          onClose={() => setPop(null)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Dates */}
              <div className="tp-prop">
                <span className="tp-prop-label">{Icons.calendar} Dates</span>
                <div className="tp-prop-val tp-dates">
                  <label className="tp-date">
                    <span>Start</span>
                    <input
                      type="date"
                      className="input tp-date-input"
                      value={toDateInputValue(detail.startDate)}
                      disabled={!canEdit}
                      onChange={(e) => setDate("startDate", e.target.value)}
                    />
                  </label>
                  <label className="tp-date">
                    <span>Due</span>
                    <input
                      type="date"
                      className="input tp-date-input"
                      value={toDateInputValue(detail.dueDate)}
                      disabled={!canEdit}
                      onChange={(e) => setDate("dueDate", e.target.value)}
                    />
                  </label>
                  <DueChip due={detail.dueDate} />
                </div>
              </div>

              {/* Priority */}
              <div className="tp-prop">
                <span className="tp-prop-label">{Icons.flag} Priority</span>
                <div className="tp-prop-val">
                  <div className="tp-pop-anchor">
                    <button
                      type="button"
                      className="tp-select-btn"
                      disabled={!canEdit}
                      onClick={() => canEdit && setPop(pop === "priority" ? null : "priority")}
                    >
                      {detail.priority ? (
                        <PriorityFlag priority={detail.priority} withLabel />
                      ) : (
                        <span className="tp-empty">None</span>
                      )}
                      {canEdit && <span className="tp-caret">{Icons.chevronDown}</span>}
                    </button>
                    {pop === "priority" && (
                      <Popover onClose={() => setPop(null)} className="tp-pop-menu">
                        {PRIORITY_ORDER.map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`tp-menu-opt${detail.priority === p ? " on" : ""}`}
                            onClick={() => setPriority(p)}
                          >
                            <PriorityFlag priority={p} />
                            <span>{PRIORITY_META[p].label}</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`tp-menu-opt${!detail.priority ? " on" : ""}`}
                          onClick={() => setPriority(null)}
                        >
                          <span className="tp-empty">None</span>
                        </button>
                      </Popover>
                    )}
                  </div>
                </div>
              </div>

              {/* Time estimate */}
              <div className="tp-prop">
                <span className="tp-prop-label">{Icons.clock} Estimate</span>
                <div className="tp-prop-val">
                  <EstimateInput
                    minutes={detail.timeEstimateMinutes}
                    canEdit={canEdit}
                    onSave={setEstimate}
                  />
                </div>
              </div>

              {/* Sprint points (Module 10) */}
              <div className="tp-prop">
                <span className="tp-prop-label">{Icons.bolt} Sprint points</span>
                <div className="tp-prop-val">
                  <SprintPointsInput
                    points={detail.sprintPoints}
                    canEdit={canEdit}
                    onSave={setSprintPoints}
                  />
                </div>
              </div>

              {/* Recurrence */}
              <div className="tp-prop">
                <span className="tp-prop-label">{Icons.repeat} Repeat</span>
                <div className="tp-prop-val">
                  <RecurrenceControl
                    value={detail.recurrence}
                    canEdit={canEdit}
                    onSave={setRecurrence}
                  />
                </div>
              </div>

              {/* Tags */}
              <div className="tp-prop">
                <span className="tp-prop-label">{Icons.tag} Tags</span>
                <div className="tp-prop-val tp-tags">
                  {detail.tags.map((t) => (
                    <TagChip key={t.id} tag={t} onRemove={canEdit ? () => toggleTag(t.id) : undefined} />
                  ))}
                  {detail.tags.length === 0 && !canEdit && <span className="tp-empty">None</span>}
                  {canEdit && (
                    <div className="tp-pop-anchor">
                      <button
                        type="button"
                        className="tp-add-btn"
                        aria-label="Add tag"
                        onClick={() => setPop(pop === "tags" ? null : "tags")}
                      >
                        {Icons.plus}
                      </button>
                      {pop === "tags" && (
                        <TagPicker
                          tags={tags}
                          selectedIds={tagIds}
                          onToggle={toggleTag}
                          onCreate={createAndAddTag}
                          onClose={() => setPop(null)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Time tracking (Module 8) */}
            <TimeTracking
              taskId={detail.id}
              estimateMinutes={detail.timeEstimateMinutes}
              canTrack={canEdit || canComment}
              onChanged={onChanged}
            />

            {/* Custom fields */}
            <section className="tp-section">
              <div className="tp-section-head">
                <h3 className="tp-section-title">
                  Custom Fields
                  {detail.fields.length > 0 && (
                    <span className="tp-count-badge">{detail.fields.length}</span>
                  )}
                </h3>
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setManagingFields(true)}
                  >
                    {Icons.sliders} Manage fields
                  </button>
                )}
              </div>
              {detail.fields.length === 0 ? (
                <div className="tp-empty tp-empty-pad">No custom fields in this space yet.</div>
              ) : (
                <div className="tp-field-list">
                  {detail.fields.map((f) => (
                    <FieldRow
                      key={f.fieldId}
                      entry={f}
                      canEdit={canEdit}
                      onSave={(v) => saveField(f.fieldId, v)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Description */}
            <section className="tp-section">
              <h3 className="tp-section-title">Description</h3>
              {canEdit ? (
                <textarea
                  className="tp-desc"
                  placeholder="Add a description…"
                  value={descDraft}
                  onFocus={() => setEditingDesc(true)}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={saveDesc}
                />
              ) : detail.description ? (
                <p className="tp-desc-ro">{detail.description}</p>
              ) : (
                <p className="tp-empty">No description.</p>
              )}
            </section>

            {/* Subtasks */}
            <section className="tp-section">
              <div className="tp-section-head">
                <h3 className="tp-section-title">
                  Subtasks
                  {detail.subtasks.length > 0 && (
                    <span className="tp-count-badge">{detail.subtasks.length}</span>
                  )}
                </h3>
              </div>
              <div className="tp-subtasks">
                {detail.subtasks.map((st: TaskCard) => (
                  <button
                    key={st.id}
                    type="button"
                    className={`tp-subtask${st.status.type === "done" ? " done" : ""}`}
                    onClick={() => onOpenTask(st.id)}
                  >
                    <span
                      className="status-dot lg"
                      style={{ background: st.status.color || colorFor(st.status.id) }}
                    />
                    <span className="tp-subtask-name">{st.name}</span>
                    {st.assignees.length > 0 && <AvatarStack users={st.assignees} size={20} />}
                    {Icons.chevronRight}
                  </button>
                ))}
                {detail.subtasks.length === 0 && !subInput && (
                  <div className="tp-empty tp-empty-pad">No subtasks yet.</div>
                )}
                {canEdit && subInput && (
                  <InlineAdd
                    placeholder="Subtask name…"
                    onCommit={addSubtask}
                    onCancel={() => setSubInput(false)}
                  />
                )}
                {canEdit && !subInput && (
                  <button type="button" className="tp-add-row" onClick={() => setSubInput(true)}>
                    {Icons.plus} Add subtask
                  </button>
                )}
              </div>
            </section>

            {/* Dependencies */}
            <section className="tp-section">
              <div className="tp-section-head">
                <h3 className="tp-section-title">
                  Dependencies
                  {detail.waitingOn.length + detail.blocking.length > 0 && (
                    <span className="tp-count-badge">
                      {detail.waitingOn.length + detail.blocking.length}
                    </span>
                  )}
                </h3>
                {canEdit && (
                  <div className="tp-pop-anchor">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPop(pop === "dep" ? null : "dep")}
                    >
                      {Icons.plus} Add
                    </button>
                    {pop === "dep" && (
                      <TaskPickerPop
                        listId={detail.listId}
                        excludeIds={depExclude}
                        placeholder="Wait on a task in this list…"
                        onPick={addDependency}
                        onClose={() => setPop(null)}
                      />
                    )}
                  </div>
                )}
              </div>
              {detail.waitingOn.length === 0 && detail.blocking.length === 0 ? (
                <div className="tp-empty tp-empty-pad">No dependencies.</div>
              ) : (
                <>
                  {detail.waitingOn.length > 0 && (
                    <div className="tp-dep-group">
                      <div className="tp-dep-title">{Icons.ban} Waiting on</div>
                      {detail.waitingOn.map((r) => (
                        <RefRow
                          key={r.id}
                          r={r}
                          onOpen={() => onOpenTask(r.id)}
                          onRemove={
                            canEdit ? () => removeDependency(detail.id, r.id) : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                  {detail.blocking.length > 0 && (
                    <div className="tp-dep-group">
                      <div className="tp-dep-title">{Icons.bolt} Blocking</div>
                      {detail.blocking.map((r) => (
                        <RefRow
                          key={r.id}
                          r={r}
                          onOpen={() => onOpenTask(r.id)}
                          onRemove={
                            canEdit ? () => removeDependency(r.id, detail.id) : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Linked tasks */}
            <section className="tp-section">
              <div className="tp-section-head">
                <h3 className="tp-section-title">
                  Linked tasks
                  {detail.linked.length > 0 && (
                    <span className="tp-count-badge">{detail.linked.length}</span>
                  )}
                </h3>
                {canEdit && (
                  <div className="tp-pop-anchor">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPop(pop === "link" ? null : "link")}
                    >
                      {Icons.link} Link
                    </button>
                    {pop === "link" && (
                      <TaskPickerPop
                        listId={detail.listId}
                        excludeIds={linkExclude}
                        placeholder="Link a task in this list…"
                        onPick={addLink}
                        onClose={() => setPop(null)}
                      />
                    )}
                  </div>
                )}
              </div>
              {detail.linked.length === 0 ? (
                <div className="tp-empty tp-empty-pad">No linked tasks.</div>
              ) : (
                <div className="tp-dep-group">
                  {detail.linked.map((r) => (
                    <RefRow
                      key={r.id}
                      r={r}
                      onOpen={() => onOpenTask(r.id)}
                      onRemove={canEdit ? () => removeLink(r.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Checklists */}
            <section className="tp-section">
              <div className="tp-section-head">
                <h3 className="tp-section-title">Checklists</h3>
              </div>
              {detail.checklists.map((cl) => {
                const total = cl.items.length;
                const done = cl.items.filter((i) => i.resolved).length;
                return (
                  <div className="tp-checklist" key={cl.id}>
                    <div className="tp-checklist-head">
                      {canEdit ? (
                        <input
                          className="tp-checklist-name"
                          defaultValue={cl.name}
                          onBlur={(e) => renameChecklist(cl, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      ) : (
                        <span className="tp-checklist-name-ro">{cl.name}</span>
                      )}
                      <span className="tp-checklist-prog">
                        {done}/{total}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Delete checklist"
                          onClick={() => deleteChecklist(cl)}
                        >
                          {Icons.trash}
                        </button>
                      )}
                    </div>
                    {total > 0 && (
                      <div className="progress tp-checklist-bar">
                        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                      </div>
                    )}
                    <div className="tp-items">
                      {cl.items
                        .slice()
                        .sort((a, b) => a.position - b.position)
                        .map((it) => (
                          <div className={`tp-item${it.resolved ? " done" : ""}`} key={it.id}>
                            <button
                              type="button"
                              className={`tp-item-check${it.resolved ? " on" : ""}`}
                              aria-label={it.resolved ? "Mark undone" : "Mark done"}
                              disabled={!canEdit}
                              onClick={() => toggleItem(it.id, !it.resolved)}
                            >
                              {it.resolved && Icons.check}
                            </button>
                            {canEdit ? (
                              <input
                                className="tp-item-name"
                                defaultValue={it.name}
                                onBlur={(e) => renameItem(it.id, e.target.value, it.name)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                              />
                            ) : (
                              <span className="tp-item-name-ro">{it.name}</span>
                            )}
                            {canEdit && (
                              <select
                                className="tp-item-assignee"
                                value={it.assigneeUserId ?? ""}
                                title="Assign"
                                onChange={(e) => assignItem(it.id, e.target.value || null)}
                              >
                                <option value="">—</option>
                                {members.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.fullName || m.email}
                                  </option>
                                ))}
                              </select>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                className="icon-btn tp-item-del"
                                title="Delete item"
                                onClick={() => deleteItem(it.id)}
                              >
                                {Icons.close}
                              </button>
                            )}
                          </div>
                        ))}
                      {canEdit && (
                        <InlineAdd
                          placeholder="Add an item…"
                          keepFocus
                          onCommit={(v) => addItem(cl.id, v)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              {canEdit &&
                (addingChecklist ? (
                  <InlineAdd
                    placeholder="Checklist name…"
                    onCommit={addChecklist}
                    onCancel={() => setAddingChecklist(false)}
                  />
                ) : (
                  <button
                    type="button"
                    className="tp-add-row"
                    onClick={() => setAddingChecklist(true)}
                  >
                    {Icons.plus} Add checklist
                  </button>
                ))}
              {!canEdit && detail.checklists.length === 0 && (
                <div className="tp-empty tp-empty-pad">No checklists.</div>
              )}
            </section>

            {/* Watchers */}
            <section className="tp-section">
              <div className="tp-section-head">
                <h3 className="tp-section-title">Watchers</h3>
                {me && (
                  <button
                    type="button"
                    className={`btn btn-sm ${watcherIds.has(me.id) ? "btn-soft" : "btn-ghost"}`}
                    onClick={toggleWatch}
                    disabled={busy}
                  >
                    {Icons.eye}
                    {watcherIds.has(me.id) ? "Watching" : "Watch"}
                  </button>
                )}
              </div>
              {detail.watchers.length > 0 ? (
                <AvatarStack users={detail.watchers} max={8} size={26} />
              ) : (
                <span className="tp-empty">No watchers yet.</span>
              )}
            </section>

            {/* Attachments & proofing (Module 12) */}
            <Attachments taskId={detail.id} canEdit={canEdit} />

            {/* Email log & compose (Module 13) */}
            <TaskEmail taskId={detail.id} canEdit={canEdit} />

            {/* Comments & activity (Module 6) */}
            <CommentsActivity
              taskId={detail.id}
              members={members}
              canComment={canComment}
            />
          </div>
        )}

        {managingFields && detail && (
          <FieldManager
            spaceId={detail.spaceId}
            spaceName={bc?.space.name}
            onClose={() => setManagingFields(false)}
            onChanged={() => {
              void reload();
              onChanged();
            }}
          />
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Status pill (header dropdown) — colored chip listing space statuses.
 * ------------------------------------------------------------------ */
function StatusPill({
  status,
  statuses,
  canEdit,
  open,
  onOpen,
  onPick,
}: {
  status: TaskDetail["status"];
  statuses: Status[];
  canEdit: boolean;
  open: boolean;
  onOpen: () => void;
  onPick: (id: string) => void;
}) {
  const color = status.color || colorFor(status.id);
  return (
    <div className="tp-pop-anchor">
      <button
        type="button"
        className="tp-status-pill"
        style={{
          color,
          borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
        }}
        disabled={!canEdit}
        onClick={onOpen}
      >
        <span className="status-dot" style={{ background: color }} />
        {status.name}
        {canEdit && <span className="tp-caret">{Icons.chevronDown}</span>}
      </button>
      {open && (
        <Popover onClose={onOpen} className="tp-pop-menu">
          {statuses.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`tp-menu-opt${s.id === status.id ? " on" : ""}`}
              onClick={() => onPick(s.id)}
            >
              <span className="status-dot" style={{ background: s.color || colorFor(s.id) }} />
              <span>{s.name}</span>
              {s.id === status.id && <span className="tp-menu-check">{Icons.check}</span>}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tag picker — toggle existing tags, or create a new one from the query.
 * ------------------------------------------------------------------ */
function TagPicker({
  tags,
  selectedIds,
  onToggle,
  onCreate,
  onClose,
}: {
  tags: Tag[];
  selectedIds: Set<string>;
  onToggle: (tagId: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hits = tags.filter((t) => (!needle ? true : t.name.toLowerCase().includes(needle)));
  const exact = tags.some((t) => t.name.toLowerCase() === needle);
  return (
    <Popover onClose={onClose} className="tp-pop-people">
      <div className="tp-pop-search">
        {Icons.tag}
        <input
          autoFocus
          className="tp-pop-input"
          placeholder="Find or create a tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && needle && !exact) {
              onCreate(q);
              setQ("");
            }
          }}
        />
      </div>
      <div className="tp-pop-list">
        {hits.map((t) => {
          const on = selectedIds.has(t.id);
          const color = t.color || colorFor(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={`tp-pop-opt${on ? " on" : ""}`}
              onClick={() => onToggle(t.id)}
            >
              <span className="status-dot lg" style={{ background: color }} />
              <span className="tp-pop-opt-body">
                <span className="tp-pop-opt-name">{t.name}</span>
              </span>
              <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
            </button>
          );
        })}
        {needle && !exact && (
          <button
            type="button"
            className="tp-pop-opt tp-pop-create"
            onClick={() => {
              onCreate(q);
              setQ("");
            }}
          >
            {Icons.plus}
            <span>
              Create “<strong>{q.trim()}</strong>”
            </span>
          </button>
        )}
        {hits.length === 0 && !needle && <div className="tp-pop-empty">No tags yet.</div>}
      </div>
    </Popover>
  );
}

/* ------------------------------------------------------------------ *
 * Time-estimate input (hours + minutes → total minutes).
 * ------------------------------------------------------------------ */
function EstimateInput({
  minutes,
  canEdit,
  onSave,
}: {
  minutes: number | null;
  canEdit: boolean;
  onSave: (minutes: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [h, setH] = useState("");
  const [m, setM] = useState("");

  const begin = (): void => {
    setH(minutes ? String(Math.floor(minutes / 60)) : "");
    setM(minutes ? String(minutes % 60) : "");
    setEditing(true);
  };
  const commit = (): void => {
    setEditing(false);
    const total = (parseInt(h || "0", 10) || 0) * 60 + (parseInt(m || "0", 10) || 0);
    onSave(total > 0 ? total : null);
  };

  if (!canEdit) {
    return minutes ? (
      <span className="tp-est-val">{formatEstimate(minutes)}</span>
    ) : (
      <span className="tp-empty">None</span>
    );
  }
  if (!editing) {
    return (
      <button type="button" className="tp-select-btn" onClick={begin}>
        {minutes ? formatEstimate(minutes) : <span className="tp-empty">Add estimate</span>}
      </button>
    );
  }
  return (
    <span className="tp-est-edit" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) commit();
    }}>
      <input
        type="number"
        min={0}
        className="input tp-est-num"
        placeholder="0"
        value={h}
        autoFocus
        onChange={(e) => setH(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="tp-est-unit">h</span>
      <input
        type="number"
        min={0}
        max={59}
        className="input tp-est-num"
        placeholder="0"
        value={m}
        onChange={(e) => setM(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="tp-est-unit">m</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Sprint-points input (Module 10) — a small 0..999 number field.
 * ------------------------------------------------------------------ */
function SprintPointsInput({
  points,
  canEdit,
  onSave,
}: {
  points: number | null;
  canEdit: boolean;
  onSave: (points: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");

  const begin = (): void => {
    setVal(points === null ? "" : String(points));
    setEditing(true);
  };
  const commit = (): void => {
    setEditing(false);
    const trimmed = val.trim();
    if (trimmed === "") {
      if (points !== null) onSave(null);
      return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(Math.max(n, 0), 999);
    if (clamped !== points) onSave(clamped);
  };

  if (!canEdit) {
    return points !== null ? (
      <span className="tp-est-val">{points} pts</span>
    ) : (
      <span className="tp-empty">None</span>
    );
  }
  if (!editing) {
    return (
      <button type="button" className="tp-select-btn" onClick={begin}>
        {points !== null ? `${points} pts` : <span className="tp-empty">Add points</span>}
      </button>
    );
  }
  return (
    <span className="tp-est-edit">
      <input
        type="number"
        min={0}
        max={999}
        className="input tp-est-num"
        placeholder="0"
        value={val}
        autoFocus
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <span className="tp-est-unit">pts</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Task-type selector — a pill next to the status ("Task" when null).
 * ------------------------------------------------------------------ */
function TypeSelector({
  taskType,
  taskTypes,
  canEdit,
  open,
  onOpen,
  onPick,
}: {
  taskType: TaskDetail["taskType"];
  taskTypes: TaskType[];
  canEdit: boolean;
  open: boolean;
  onOpen: () => void;
  onPick: (taskTypeId: string | null) => void;
}) {
  return (
    <div className="tp-pop-anchor">
      <button
        type="button"
        className="tp-type-btn"
        title="Task type"
        disabled={!canEdit}
        onClick={onOpen}
      >
        {taskType ? <TypeIcon type={taskType} /> : <span className="tp-type-default">{Icons.checkSquare}</span>}
        {taskType ? taskType.name : "Task"}
        {canEdit && <span className="tp-caret">{Icons.chevronDown}</span>}
      </button>
      {open && (
        <Popover onClose={onOpen} className="tp-pop-menu">
          <button
            type="button"
            className={`tp-menu-opt${!taskType ? " on" : ""}`}
            onClick={() => onPick(null)}
          >
            <span className="tp-type-default">{Icons.checkSquare}</span>
            <span>Task</span>
            {!taskType && <span className="tp-menu-check">{Icons.check}</span>}
          </button>
          {taskTypes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tp-menu-opt${taskType?.id === t.id ? " on" : ""}`}
              onClick={() => onPick(t.id)}
            >
              <TypeIcon type={t} />
              <span>{t.name}</span>
              {taskType?.id === t.id && <span className="tp-menu-check">{Icons.check}</span>}
            </button>
          ))}
          {taskTypes.length === 0 && (
            <div className="tp-pop-empty">No custom types in this space yet.</div>
          )}
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Recurrence control — None / Daily / Weekly / Monthly + "every N".
 * Always saves mode "on_complete": completing the task spawns a clone.
 * ------------------------------------------------------------------ */
const FREQ_UNIT: Record<RecurrenceFreq, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

function RecurrenceControl({
  value,
  canEdit,
  onSave,
}: {
  value: Recurrence | null;
  canEdit: boolean;
  onSave: (r: Recurrence | null) => void;
}) {
  if (!canEdit) {
    if (!value) return <span className="tp-empty">None</span>;
    const [one, many] = FREQ_UNIT[value.freq];
    return (
      <span className="tp-repeat-ro">
        {Icons.repeat} Every {value.interval > 1 ? `${value.interval} ${many}` : one}
      </span>
    );
  }
  const interval = value?.interval ?? 1;
  return (
    <span className="tp-repeat">
      <select
        className="input tp-repeat-sel"
        value={value?.freq ?? ""}
        aria-label="Repeat frequency"
        onChange={(e) => {
          const f = e.target.value as RecurrenceFreq | "";
          onSave(f ? { freq: f, interval, mode: "on_complete" } : null);
        }}
      >
        <option value="">None</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      {value && (
        <>
          <span className="tp-repeat-lbl">every</span>
          <input
            type="number"
            min={1}
            max={99}
            className="input tp-repeat-num"
            key={interval}
            defaultValue={interval}
            aria-label="Repeat interval"
            onBlur={(e) => {
              const n = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1));
              if (n !== interval) onSave({ freq: value.freq, interval: n, mode: "on_complete" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="tp-repeat-lbl">
            {interval > 1 ? FREQ_UNIT[value.freq][1] : FREQ_UNIT[value.freq][0]}
          </span>
          <span className="tp-repeat-hint">on complete</span>
        </>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Custom field row — a type-appropriate inline editor per field.
 * ------------------------------------------------------------------ */
const FIELD_ICON: Record<CustomFieldType, React.ReactNode> = {
  text: Icons.edit,
  number: Icons.hash,
  money: Icons.coin,
  date: Icons.calendar,
  dropdown: Icons.list,
  labels: Icons.tag,
  checkbox: Icons.checkSquare,
  url: Icons.link,
  email: Icons.mail,
  phone: Icons.phone,
  rating: Icons.star,
  progress: Icons.goals,
};

function FieldRow({
  entry,
  canEdit,
  onSave,
}: {
  entry: TaskFieldEntry;
  canEdit: boolean;
  onSave: (value: FieldValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const v = entry.value;
  const text = v && "text" in v ? v.text : "";
  const num = v && "number" in v ? v.number : null;
  const date = v && "date" in v ? v.date : null;
  const checked = v !== null && v !== undefined && "checked" in v ? v.checked : false;
  const optionId = v && "optionId" in v ? v.optionId : null;
  const optionIds = v && "optionIds" in v ? v.optionIds : [];
  const opts = entry.config.options ?? [];

  let control: React.ReactNode;
  switch (entry.type) {
    case "text":
    case "url":
    case "email":
    case "phone": {
      const inputType =
        entry.type === "text" ? "text" : entry.type === "phone" ? "tel" : entry.type;
      control = (
        <input
          type={inputType}
          className="input tp-field-input"
          key={text}
          defaultValue={text}
          placeholder="Empty"
          disabled={!canEdit}
          onBlur={(e) => {
            const nv = e.target.value.trim();
            if (nv !== text) onSave(nv ? { text: nv } : null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      );
      break;
    }
    case "number":
    case "money":
      control = (
        <span className="tp-field-money">
          {entry.type === "money" && (
            <span className="tp-field-cur">{entry.config.currency ?? "USD"}</span>
          )}
          <input
            type="number"
            className="input tp-field-input tp-field-num"
            key={num ?? "unset"}
            defaultValue={num ?? ""}
            placeholder="Empty"
            disabled={!canEdit}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const nv = raw === "" ? null : Number(raw);
              if (nv !== null && Number.isNaN(nv)) return;
              if (nv !== num) onSave(nv === null ? null : { number: nv });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </span>
      );
      break;
    case "date":
      control = (
        <input
          type="date"
          className="input tp-date-input"
          value={toDateInputValue(date)}
          disabled={!canEdit}
          onChange={(e) => onSave(e.target.value ? { date: e.target.value } : null)}
        />
      );
      break;
    case "checkbox":
      control = (
        <button
          type="button"
          className={`tp-item-check${checked ? " on" : ""}`}
          aria-label={checked ? "Uncheck" : "Check"}
          disabled={!canEdit}
          onClick={() => onSave({ checked: !checked })}
        >
          {checked && Icons.check}
        </button>
      );
      break;
    case "dropdown": {
      const cur = opts.find((o) => o.id === optionId) ?? null;
      control = (
        <div className="tp-pop-anchor">
          <button
            type="button"
            className="tp-select-btn"
            disabled={!canEdit}
            onClick={() => canEdit && setOpen((x) => !x)}
          >
            {cur ? (
              <>
                <span className="status-dot" style={{ background: cur.color }} />
                {cur.name}
              </>
            ) : (
              <span className="tp-empty">None</span>
            )}
            {canEdit && <span className="tp-caret">{Icons.chevronDown}</span>}
          </button>
          {open && (
            <Popover onClose={() => setOpen(false)} className="tp-pop-menu">
              {opts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`tp-menu-opt${o.id === optionId ? " on" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    onSave(o.id === optionId ? null : { optionId: o.id });
                  }}
                >
                  <span className="status-dot" style={{ background: o.color }} />
                  <span>{o.name}</span>
                  {o.id === optionId && <span className="tp-menu-check">{Icons.check}</span>}
                </button>
              ))}
              <button
                type="button"
                className={`tp-menu-opt${!optionId ? " on" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onSave(null);
                }}
              >
                <span className="tp-empty">None</span>
              </button>
              {opts.length === 0 && (
                <div className="tp-pop-empty">No options — add some via Manage fields.</div>
              )}
            </Popover>
          )}
        </div>
      );
      break;
    }
    case "labels": {
      const sel = opts.filter((o) => optionIds.includes(o.id));
      const toggle = (id: string): void => {
        const next = optionIds.includes(id)
          ? optionIds.filter((x) => x !== id)
          : [...optionIds, id];
        onSave(next.length > 0 ? { optionIds: next } : null);
      };
      control = (
        <>
          {sel.map((o) => (
            <span
              key={o.id}
              className="tag-chip"
              style={{
                color: o.color,
                borderColor: `color-mix(in srgb, ${o.color} 40%, transparent)`,
                background: `color-mix(in srgb, ${o.color} 12%, transparent)`,
              }}
            >
              <span className="tag-chip-name">{o.name}</span>
              {canEdit && (
                <button
                  type="button"
                  className="tag-chip-x"
                  aria-label={`Remove ${o.name}`}
                  onClick={() => toggle(o.id)}
                >
                  {Icons.close}
                </button>
              )}
            </span>
          ))}
          {sel.length === 0 && !canEdit && <span className="tp-empty">None</span>}
          {canEdit && (
            <div className="tp-pop-anchor">
              <button
                type="button"
                className="tp-add-btn"
                aria-label={`Edit ${entry.name}`}
                onClick={() => setOpen((x) => !x)}
              >
                {Icons.plus}
              </button>
              {open && (
                <Popover onClose={() => setOpen(false)} className="tp-pop-menu">
                  {opts.map((o) => {
                    const on = optionIds.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={`tp-menu-opt${on ? " on" : ""}`}
                        onClick={() => toggle(o.id)}
                      >
                        <span className="status-dot" style={{ background: o.color }} />
                        <span>{o.name}</span>
                        <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
                      </button>
                    );
                  })}
                  {opts.length === 0 && (
                    <div className="tp-pop-empty">No labels — add some via Manage fields.</div>
                  )}
                </Popover>
              )}
            </div>
          )}
        </>
      );
      break;
    }
    case "rating": {
      const max = Math.max(1, entry.config.max ?? 5);
      const val = num ?? 0;
      control = (
        <span className="tp-rating" role="group" aria-label={`${entry.name} rating`}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`tp-star${n <= val ? " on" : ""}`}
              title={`${n} / ${max}`}
              disabled={!canEdit}
              onClick={() => onSave(n === val ? null : { number: n })}
            >
              {n <= val ? Icons.starFill : Icons.star}
            </button>
          ))}
        </span>
      );
      break;
    }
    case "progress":
      control = <ProgressEditor value={num} canEdit={canEdit} onSave={onSave} />;
      break;
  }

  return (
    <div className="tp-prop tp-field">
      <span className="tp-prop-label" title={entry.name}>
        {FIELD_ICON[entry.type]} <span className="tp-field-name">{entry.name}</span>
      </span>
      <div className="tp-prop-val">{control}</div>
    </div>
  );
}

/* Progress: slider + live % — commits when the drag/keyboard edit ends. */
function ProgressEditor({
  value,
  canEdit,
  onSave,
}: {
  value: number | null;
  canEdit: boolean;
  onSave: (v: FieldValue | null) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value ?? 0;
  const commit = (): void => {
    if (draft !== null && draft !== (value ?? 0)) onSave({ number: draft });
    setDraft(null);
  };
  return (
    <span className="tp-progress">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        className="tp-progress-slider"
        value={shown}
        disabled={!canEdit}
        onChange={(e) => setDraft(parseInt(e.target.value, 10))}
        onPointerUp={commit}
        onKeyUp={(e) => {
          if (e.key.startsWith("Arrow")) commit();
        }}
        onBlur={commit}
      />
      <span className="tp-progress-val">{shown}%</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * A referenced task row (dependencies & links): dot + name, click to
 * open, ✕ to remove the relation.
 * ------------------------------------------------------------------ */
function RefRow({
  r,
  onOpen,
  onRemove,
}: {
  r: TaskRef;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const done = r.status?.type === "done";
  return (
    <div className={`tp-ref${done ? " done" : ""}`}>
      <button type="button" className="tp-ref-main" onClick={onOpen}>
        <span
          className="status-dot lg"
          style={{
            background: r.status ? r.status.color || colorFor(r.status.id) : "var(--line)",
          }}
        />
        <span className="tp-ref-name">{r.name}</span>
        {r.status && <span className="tp-ref-status">{r.status.name}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          className="icon-btn tp-ref-x"
          title="Remove"
          onClick={onRemove}
        >
          {Icons.close}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Task picker — searches the current list's tasks (dependencies/links).
 * ------------------------------------------------------------------ */
function TaskPickerPop({
  listId,
  excludeIds,
  placeholder,
  onPick,
  onClose,
}: {
  listId: string;
  excludeIds: Set<string>;
  placeholder: string;
  onPick: (taskId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);

  useEffect(() => {
    tasksApi
      .listForList(listId)
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]));
  }, [listId]);

  const needle = q.trim().toLowerCase();
  const hits = (tasks ?? []).filter(
    (t) => !excludeIds.has(t.id) && (!needle || t.name.toLowerCase().includes(needle)),
  );

  return (
    <Popover onClose={onClose} className="tp-pop-people tp-pop-right">
      <div className="tp-pop-search">
        {Icons.search}
        <input
          autoFocus
          className="tp-pop-input"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="tp-pop-list">
        {tasks === null ? (
          <div className="tp-pop-empty">Loading tasks…</div>
        ) : hits.length === 0 ? (
          <div className="tp-pop-empty">No matching tasks in this list.</div>
        ) : (
          hits.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tp-pop-opt"
              onClick={() => onPick(t.id)}
            >
              <span
                className="status-dot lg"
                style={{ background: t.status.color || colorFor(t.status.id) }}
              />
              <span className="tp-pop-opt-body">
                <span className="tp-pop-opt-name">{t.name}</span>
                <span className="tp-pop-opt-sub">{t.status.name}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </Popover>
  );
}

/* ------------------------------------------------------------------ *
 * Inline add field (subtasks, checklists, checklist items).
 * ------------------------------------------------------------------ */
function InlineAdd({
  placeholder,
  onCommit,
  onCancel,
  keepFocus = false,
}: {
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel?: () => void;
  keepFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="tp-inline-add">
      {Icons.plus}
      <input
        ref={ref}
        className="tp-inline-input"
        placeholder={placeholder}
        value={value}
        autoFocus={!keepFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = value.trim();
            if (v) onCommit(v);
            setValue("");
            if (keepFocus) ref.current?.focus();
          } else if (e.key === "Escape") {
            setValue("");
            onCancel?.();
          }
        }}
        onBlur={() => {
          if (!keepFocus) {
            const v = value.trim();
            if (v) onCommit(v);
            else onCancel?.();
          }
        }}
      />
    </div>
  );
}
