"use client";

/**
 * Module 9 — Goal detail: the OKR screen. `/goal?id=<goalId>`
 * (static export: no [id] routes, so query param + Suspense).
 *
 * Header: inline-rename name, inline description, owner picker, due date,
 * archive/delete menu and the big overall progress bar. Below: targets
 * (key results) — number / currency (inline current-value editing, ⚙
 * popover for start/target), boolean (a satisfying Done checkbox) and
 * tasks (linked task chips + a Space → List → tasks picker). The whole
 * screen refetches on `goal.changed` SSE.
 */

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  goalsApi,
  tasksApi,
  workspacesApi,
  type GoalDetail,
  type Member,
  type Target,
  type TargetType,
  type TaskCard,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import {
  clamp01,
  colorFor,
  formatDueDate,
  formatMetric,
  formatPercent,
  initials,
  isOverdue,
  toDateInputValue,
} from "@/lib/format";

const TARGET_TYPE_META: Record<TargetType, { label: string; hint: string }> = {
  number: { label: "Number", hint: "Track a metric from a start value to a target." },
  currency: { label: "Currency", hint: "Track money — revenue, budget, savings." },
  boolean: { label: "Done / not done", hint: "A single yes-or-no milestone." },
  tasks: { label: "Tasks", hint: "Roll up completion of linked tasks." },
};

/* ------------------------------------------------------------------ *
 * Task picker — Space → List → checklist of that list's tasks.
 * ------------------------------------------------------------------ */
function TaskPickerModal({
  targetName,
  linkedIds,
  busy,
  onClose,
  onSubmit,
}: {
  targetName: string;
  linkedIds: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (taskIds: string[]) => void;
}) {
  const { tree } = useHierarchy();
  const [spaceId, setSpaceId] = useState("");
  const [listId, setListId] = useState("");
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(linkedIds));
  const [loadError, setLoadError] = useState("");

  const spaces = tree.filter((s) => !s.archived);
  const space = spaces.find((s) => s.id === spaceId) ?? null;
  const lists = space
    ? [
        ...space.folders.flatMap((f) =>
          f.lists.map((l) => ({ ...l, group: f.name })),
        ),
        ...space.lists.map((l) => ({ ...l, group: "" })),
      ].filter((l) => !l.archived)
    : [];

  useEffect(() => {
    if (!listId) {
      setTasks(null);
      return;
    }
    let cancelled = false;
    setTasks(null);
    setLoadError("");
    tasksApi
      .listForList(listId)
      .then((r) => {
        if (!cancelled) setTasks(r.tasks);
      })
      .catch((err) => {
        if (!cancelled) {
          setTasks([]);
          setLoadError(
            err instanceof ApiError ? err.message : "Couldn't load that list's tasks.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const toggle = (id: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Manage linked tasks"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.link}</span>
            <div>
              <h2>Link tasks</h2>
              <p className="muted share-sub">
                “{targetName}” tracks the completion of its linked tasks.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          <div className="tp-selects">
            <div className="field">
              <label className="label" htmlFor="tp-space">Space</label>
              <select
                id="tp-space"
                className="input"
                value={spaceId}
                onChange={(e) => {
                  setSpaceId(e.target.value);
                  setListId("");
                }}
              >
                <option value="">Pick a space…</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.icon ? `${s.icon} ` : ""}{s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="tp-list">List</label>
              <select
                id="tp-list"
                className="input"
                value={listId}
                disabled={!spaceId}
                onChange={(e) => setListId(e.target.value)}
              >
                <option value="">{spaceId ? "Pick a list…" : "Pick a space first"}</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.group ? `${l.group} / ` : ""}{l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadError && <div className="form-error">{loadError}</div>}

          {listId && (
            <div className="tp-tasks">
              {tasks === null ? (
                <>
                  <span className="skel" style={{ height: 38, borderRadius: 8 }} />
                  <span className="skel" style={{ height: 38, borderRadius: 8 }} />
                </>
              ) : tasks.length === 0 ? (
                <p className="muted tp-empty">No tasks in this list yet.</p>
              ) : (
                tasks.map((t) => {
                  const on = picked.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`tp-task${on ? " on" : ""}`}
                      onClick={() => toggle(t.id)}
                    >
                      <span
                        className="status-dot"
                        style={{ background: t.status.color }}
                        title={t.status.name}
                      />
                      <span className="tp-task-name">{t.name}</span>
                      <span className={`team-check${on ? " on" : ""}`}>
                        {on && Icons.check}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          <div className="modal-foot between">
            <span className="muted tp-count">
              {picked.size} {picked.size === 1 ? "task" : "tasks"} linked
            </span>
            <div className="tp-foot-btns">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => onSubmit([...picked])}
              >
                {busy ? "Saving…" : "Save links"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One target (key result) row.
 * ------------------------------------------------------------------ */
function TargetRow({
  target,
  canEdit,
  onPatched,
  onDeleted,
}: {
  target: Target;
  canEdit: boolean;
  onPatched: (t: Target) => void;
  onDeleted: (id: string) => void;
}) {
  const progress = clamp01(target.progress);
  const [current, setCurrent] = useState(String(Number(target.currentValue) || 0));
  const [gearOpen, setGearOpen] = useState(false);
  const [startVal, setStartVal] = useState(String(Number(target.startValue) || 0));
  const [targetVal, setTargetVal] = useState(String(Number(target.targetValue) || 0));
  const [currencyVal, setCurrencyVal] = useState(target.currency ?? "USD");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-seed local inputs when the server pushes a new version of the target.
  useEffect(() => {
    setCurrent(String(Number(target.currentValue) || 0));
    setStartVal(String(Number(target.startValue) || 0));
    setTargetVal(String(Number(target.targetValue) || 0));
    setCurrencyVal(target.currency ?? "USD");
  }, [target]);

  const patch = (body: Parameters<typeof goalsApi.updateTarget>[1]): void => {
    setBusy(true);
    goalsApi
      .updateTarget(target.id, body)
      .then((r) => onPatched(r.target))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const commitCurrent = (): void => {
    const n = Number(current);
    if (!Number.isFinite(n) || n === Number(target.currentValue)) {
      setCurrent(String(Number(target.currentValue) || 0));
      return;
    }
    patch({ currentValue: n });
  };

  const commitConfig = (): void => {
    setGearOpen(false);
    const s = Number(startVal);
    const t = Number(targetVal);
    const body: Parameters<typeof goalsApi.updateTarget>[1] = {};
    if (Number.isFinite(s) && s !== Number(target.startValue)) body.startValue = s;
    if (Number.isFinite(t) && t !== Number(target.targetValue)) body.targetValue = t;
    if (target.type === "currency" && currencyVal.trim() && currencyVal !== target.currency) {
      body.currency = currencyVal.trim().toUpperCase();
    }
    if (Object.keys(body).length > 0) patch(body);
  };

  const remove = (): void => {
    if (!window.confirm(`Delete the target “${target.name}”?`)) return;
    goalsApi
      .removeTarget(target.id)
      .then(() => onDeleted(target.id))
      .catch(() => undefined);
  };

  const currency = target.currency ?? "USD";
  const done = progress >= 1 || (target.type === "boolean" && target.done);

  return (
    <div className={`target-row${done ? " done" : ""}`}>
      <div className="target-top">
        {target.type === "boolean" ? (
          <button
            type="button"
            className={`t-bool${target.done ? " on" : ""}`}
            disabled={!canEdit || busy}
            aria-pressed={target.done}
            aria-label={target.done ? "Mark not done" : "Mark done"}
            onClick={() => patch({ done: !target.done })}
          >
            {target.done && Icons.check}
          </button>
        ) : (
          <span className={`t-type-ic t-${target.type}`} aria-hidden="true">
            {target.type === "currency"
              ? Icons.coin
              : target.type === "tasks"
                ? Icons.checkSquare
                : Icons.trendUp}
          </span>
        )}
        <span className="target-name">{target.name}</span>

        <span className="target-controls">
          {(target.type === "number" || target.type === "currency") && (
            <span className="t-metric">
              {target.type === "currency" && <span className="t-currency">{currency}</span>}
              <input
                className="t-num-input"
                type="number"
                value={current}
                disabled={!canEdit || busy}
                aria-label="Current value"
                onChange={(e) => setCurrent(e.target.value)}
                onBlur={commitCurrent}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setCurrent(String(Number(target.currentValue) || 0));
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <span className="t-of">/ {formatMetric(target.targetValue)}</span>
              {canEdit && (
                <span className="dp-menu-wrap">
                  <button
                    type="button"
                    className="icon-btn t-gear"
                    aria-label="Edit start & target values"
                    title="Start / target"
                    onClick={(e) => {
                      e.stopPropagation();
                      setGearOpen((v) => !v);
                    }}
                  >
                    {Icons.sliders}
                  </button>
                  {gearOpen && (
                    <div className="menu dp-menu t-pop" onClick={(e) => e.stopPropagation()}>
                      <div className="t-pop-field">
                        <span className="label">Start</span>
                        <input
                          className="input"
                          type="number"
                          value={startVal}
                          onChange={(e) => setStartVal(e.target.value)}
                        />
                      </div>
                      <div className="t-pop-field">
                        <span className="label">Target</span>
                        <input
                          className="input"
                          type="number"
                          value={targetVal}
                          onChange={(e) => setTargetVal(e.target.value)}
                        />
                      </div>
                      {target.type === "currency" && (
                        <div className="t-pop-field">
                          <span className="label">Currency</span>
                          <input
                            className="input"
                            value={currencyVal}
                            maxLength={6}
                            onChange={(e) => setCurrencyVal(e.target.value)}
                          />
                        </div>
                      )}
                      <div className="t-pop-foot">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setGearOpen(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={commitConfig}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </span>
              )}
            </span>
          )}
          {target.type === "boolean" && (
            <span className={`t-bool-label${target.done ? " on" : ""}`}>
              {target.done ? "Done" : "Not done"}
            </span>
          )}
          {target.type === "tasks" && canEdit && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setPicking(true)}
            >
              {Icons.link}
              Manage tasks
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="icon-btn t-del"
              aria-label="Delete target"
              title="Delete target"
              onClick={remove}
            >
              {Icons.trash}
            </button>
          )}
        </span>
      </div>

      {target.type === "tasks" && (
        <div className="t-task-chips">
          {(target.tasks ?? []).length === 0 ? (
            <span className="muted t-no-tasks">No tasks linked yet.</span>
          ) : (
            (target.tasks ?? []).map((t) =>
              t.name === "Private task" ? (
                <span key={t.id} className="tt-chip private" title="You don't have access to this task">
                  {Icons.lock}
                  Private task
                </span>
              ) : (
                <Link
                  key={t.id}
                  href={`/list?id=${t.listId}&task=${t.id}`}
                  className={`tt-chip st-${t.statusType}`}
                >
                  <span className="status-dot" aria-hidden="true" />
                  {t.name}
                </Link>
              ),
            )
          )}
        </div>
      )}

      <div className="target-progress">
        <span className="goal-prog-track">
          <span
            className={`goal-prog-fill${progress >= 1 ? " full" : ""}`}
            style={{ width: `${progress * 100}%` }}
          />
        </span>
        <span className={`goal-prog-label${progress >= 1 ? " full" : ""}`}>
          {formatPercent(progress)}
        </span>
      </div>

      {picking && (
        <TaskPickerModal
          targetName={target.name}
          linkedIds={(target.tasks ?? []).map((t) => t.id)}
          busy={busy}
          onClose={() => setPicking(false)}
          onSubmit={(taskIds) => {
            setBusy(true);
            goalsApi
              .updateTarget(target.id, { taskIds })
              .then((r) => {
                onPatched(r.target);
                setPicking(false);
              })
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * "＋ Add Target" inline form.
 * ------------------------------------------------------------------ */
function AddTargetForm({
  goalId,
  onAdded,
  onClose,
}: {
  goalId: string;
  onAdded: (t: Target) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TargetType>("number");
  const [targetVal, setTargetVal] = useState("100");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = (): void => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    const body: Parameters<typeof goalsApi.createTarget>[1] = { name: trimmed, type };
    if (type === "number" || type === "currency") {
      const t = Number(targetVal);
      body.targetValue = Number.isFinite(t) && t > 0 ? t : 100;
      if (type === "currency") body.currency = currency.trim().toUpperCase() || "USD";
    }
    goalsApi
      .createTarget(goalId, body)
      .then((r) => onAdded(r.target))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't add the target.");
        setBusy(false);
      });
  };

  return (
    <div className="add-target">
      {error && <div className="form-error">{error}</div>}
      <div className="add-target-row">
        <input
          className="input"
          placeholder="e.g. Reach 1,000 signups"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
        />
        <select
          className="input add-target-type"
          value={type}
          aria-label="Target type"
          onChange={(e) => setType(e.target.value as TargetType)}
        >
          {(Object.keys(TARGET_TYPE_META) as TargetType[]).map((t) => (
            <option key={t} value={t}>{TARGET_TYPE_META[t].label}</option>
          ))}
        </select>
        {(type === "number" || type === "currency") && (
          <input
            className="input add-target-val"
            type="number"
            value={targetVal}
            aria-label="Target value"
            onChange={(e) => setTargetVal(e.target.value)}
          />
        )}
        {type === "currency" && (
          <input
            className="input add-target-cur"
            value={currency}
            maxLength={6}
            aria-label="Currency code"
            onChange={(e) => setCurrency(e.target.value)}
          />
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || busy}
          onClick={submit}
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="muted add-target-hint">
        {type === "tasks"
          ? "Create it, then use “Manage tasks” to link tasks — progress rolls up from their statuses."
          : TARGET_TYPE_META[type].hint}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The goal view.
 * ------------------------------------------------------------------ */
function GoalView() {
  const router = useRouter();
  const goalId = useSearchParams().get("id") ?? "";

  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const editingRef = useRef(false);
  editingRef.current = editingDesc;

  const load = (): void => {
    if (!goalId) return;
    goalsApi
      .get(goalId)
      .then((r) => {
        setGoal(r.goal);
        setNameDraft(r.goal.name);
        if (!editingRef.current) setDescDraft(r.goal.description ?? "");
        setError("");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load this goal.");
      });
  };
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  useRealtime(
    (e) => {
      if (e.type === "goal.changed" && e.payload.goalId === goalId) loadRef.current();
    },
    [goalId],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const patchGoal = (body: Parameters<typeof goalsApi.update>[1]): void => {
    if (!goal) return;
    goalsApi
      .update(goal.id, body)
      .then((r) => {
        setGoal(r.goal);
        setNameDraft(r.goal.name);
        if (!editingRef.current) setDescDraft(r.goal.description ?? "");
      })
      .catch(() => loadRef.current());
  };

  const commitName = (): void => {
    if (!goal) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === goal.name) {
      setNameDraft(goal.name);
      return;
    }
    patchGoal({ name: trimmed });
  };

  const commitDesc = (): void => {
    setEditingDesc(false);
    if (!goal) return;
    const trimmed = descDraft.trim();
    if (trimmed === (goal.description ?? "")) return;
    patchGoal({ description: trimmed || null });
  };

  const removeGoal = (): void => {
    if (!goal) return;
    if (!window.confirm(`Delete the goal “${goal.name}”? This can't be undone.`)) return;
    goalsApi
      .remove(goal.id)
      .then(() => router.push("/goals"))
      .catch(() => undefined);
  };

  const onTargetPatched = (t: Target): void => {
    setGoal((prev) =>
      prev
        ? { ...prev, targets: prev.targets.map((x) => (x.id === t.id ? t : x)) }
        : prev,
    );
    // Target math changes the goal's overall progress — refresh it.
    loadRef.current();
  };
  const onTargetDeleted = (id: string): void => {
    setGoal((prev) =>
      prev ? { ...prev, targets: prev.targets.filter((x) => x.id !== id) } : prev,
    );
    loadRef.current();
  };

  if (!goalId) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.goals}</span>
          <h3>No goal selected</h3>
          <p>Pick a goal from the Goals page.</p>
          <Link href="/goals" className="btn btn-primary">Back to Goals</Link>
        </div>
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="page">
        {error ? (
          <>
            <div className="form-error">{error}</div>
            <Link href="/goals" className="btn btn-ghost">
              {Icons.chevronLeft} Back to Goals
            </Link>
          </>
        ) : (
          <>
            <span className="skel" style={{ width: 340, height: 38, marginBottom: 16 }} />
            <span className="skel" style={{ width: "100%", height: 18, marginBottom: 24 }} />
            <span className="skel" style={{ width: "100%", height: 72, marginBottom: 10 }} />
            <span className="skel" style={{ width: "100%", height: 72 }} />
          </>
        )}
      </div>
    );
  }

  const progress = clamp01(goal.progress);
  const overdue = isOverdue(goal.dueDate) && progress < 1;
  const sortedTargets = [...goal.targets].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );

  return (
    <div className="page goal-page">
      <div className="goal-crumb">
        <Link href="/goals" className="goal-back">
          {Icons.chevronLeft}
          Goals
        </Link>
        {goal.archived && <span className="badge badge-soon">Archived</span>}
      </div>

      <div className="goal-hero">
        <div className="goal-hero-top">
          <input
            className="goal-title-input"
            value={nameDraft}
            aria-label="Goal name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setNameDraft(goal.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <span className="dp-menu-wrap">
            <button
              type="button"
              className="icon-btn"
              aria-label="Goal menu"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              {Icons.more}
            </button>
            {menuOpen && (
              <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    patchGoal({ archived: !goal.archived });
                  }}
                >
                  {Icons.archive} {goal.archived ? "Unarchive" : "Archive"}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    removeGoal();
                  }}
                >
                  {Icons.trash} Delete goal
                </button>
              </div>
            )}
          </span>
        </div>

        {editingDesc ? (
          <textarea
            className="input goal-desc-input"
            value={descDraft}
            autoFocus
            rows={3}
            placeholder="What does winning look like?"
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDescDraft(goal.description ?? "");
                setEditingDesc(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={`goal-desc${goal.description ? "" : " placeholder"}`}
            onClick={() => setEditingDesc(true)}
          >
            {goal.description || "Add a description — what does winning look like?"}
          </button>
        )}

        <div className="goal-hero-meta">
          <label className="goal-meta-item">
            <span className="goal-meta-label">Owner</span>
            <span className="goal-owner-pick">
              {goal.owner ? (
                <span
                  className="avatar avatar-sm"
                  style={{ background: colorFor(goal.owner.id) }}
                >
                  {initials(goal.owner.fullName)}
                </span>
              ) : (
                <span className="goal-row-noowner">{Icons.members}</span>
              )}
              <select
                className="input goal-meta-select"
                value={goal.owner?.id ?? ""}
                aria-label="Goal owner"
                onChange={(e) => patchGoal({ ownerUserId: e.target.value || null })}
              >
                <option value="">No owner</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.fullName || m.email}</option>
                ))}
              </select>
            </span>
          </label>
          <label className="goal-meta-item">
            <span className="goal-meta-label">Due date</span>
            <input
              type="date"
              className={`input goal-meta-date${overdue ? " overdue" : ""}`}
              value={toDateInputValue(goal.dueDate)}
              aria-label="Due date"
              onChange={(e) => patchGoal({ dueDate: e.target.value || null })}
            />
          </label>
          {goal.dueDate && (
            <span className={`goal-due-chip${overdue ? " overdue" : ""}`}>
              {Icons.calendar}
              {overdue ? "Overdue — " : "Due "}
              {formatDueDate(goal.dueDate)}
            </span>
          )}
        </div>

        <div className="goal-overall">
          <div className="goal-overall-head">
            <span className="goal-overall-label">Overall progress</span>
            <span className={`goal-overall-pct${progress >= 1 ? " full" : ""}`}>
              {formatPercent(progress)}
            </span>
          </div>
          <span className="goal-prog-track lg">
            <span
              className={`goal-prog-fill${progress >= 1 ? " full" : ""}`}
              style={{ width: `${progress * 100}%` }}
            />
          </span>
          <span className="goal-overall-sub muted">
            {progress >= 1
              ? "Target reached — nice work. 🎉"
              : `Averaged across ${sortedTargets.length || "your"} ${sortedTargets.length === 1 ? "target" : "targets"}.`}
          </span>
        </div>
      </div>

      <div className="section-title goal-targets-title">
        <h2>Targets</h2>
        <span className="muted">
          {sortedTargets.length} key {sortedTargets.length === 1 ? "result" : "results"}
        </span>
      </div>

      {sortedTargets.length === 0 && !adding ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.trendUp}</span>
          <h3>No targets yet</h3>
          <p>Targets are the measurable pieces — a number, an amount, a yes/no, or a set of tasks.</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {Icons.plus}
            Add your first target
          </button>
        </div>
      ) : (
        <div className="target-list">
          {sortedTargets.map((t) => (
            <TargetRow
              key={t.id}
              target={t}
              canEdit={!goal.archived}
              onPatched={onTargetPatched}
              onDeleted={onTargetDeleted}
            />
          ))}
          {adding ? (
            <AddTargetForm
              goalId={goal.id}
              onAdded={() => {
                setAdding(false);
                loadRef.current();
              }}
              onClose={() => setAdding(false)}
            />
          ) : (
            !goal.archived && (
              <button type="button" className="add-target-btn" onClick={() => setAdding(true)}>
                {Icons.plus}
                Add Target
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function GoalPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 34 }} />
        </div>
      }
    >
      <GoalView />
    </Suspense>
  );
}
