"use client";

/**
 * Module 11 — the When/Then automation builder + runs viewer.
 *
 * WHEN: one trigger (task created / status changes [optionally to a
 * specific status] / priority changes [optionally to a priority] /
 * assignee added / task becomes overdue).
 * THEN: up to five actions (set status, set priority, add assignee,
 * add tag, post comment).
 *
 * The name auto-suggests itself from the rule ("When status changes to
 * Done, set priority to Low") until the user types their own.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  automationsApi,
  PRIORITY_META,
  PRIORITY_ORDER,
  type Automation,
  type AutomationAction,
  type AutomationRun,
  type AutomationTrigger,
  type AutomationTriggerType,
  type Member,
  type Priority,
  type Status,
  type Tag,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";

export interface AutomationContext {
  statuses: Status[];
  members: Member[];
  tags: Tag[];
}

/* ------------------------------------------------------------------ *
 * Plain-English summaries — shared with the space page rows.
 * ------------------------------------------------------------------ */
export const TRIGGER_LABEL: Record<AutomationTriggerType, string> = {
  "task.created": "a task is created",
  "status.changed": "status changes",
  "priority.changed": "priority changes",
  "assignee.added": "an assignee is added",
  "due.overdue": "a task becomes overdue",
};

export function triggerSummary(trigger: AutomationTrigger, ctx: AutomationContext): string {
  let s = TRIGGER_LABEL[trigger.type] ?? trigger.type;
  if (trigger.type === "status.changed" && trigger.toStatusId) {
    const st = ctx.statuses.find((x) => x.id === trigger.toStatusId);
    if (st) s += ` to ${st.name}`;
  }
  if (trigger.type === "priority.changed" && trigger.toPriority) {
    s += ` to ${PRIORITY_META[trigger.toPriority].label}`;
  }
  return s;
}

export function actionSummary(action: AutomationAction, ctx: AutomationContext): string {
  switch (action.type) {
    case "set.status": {
      const st = ctx.statuses.find((x) => x.id === action.statusId);
      return `set status to ${st?.name ?? "…"}`;
    }
    case "set.priority":
      return `set priority to ${PRIORITY_META[action.priority]?.label ?? action.priority}`;
    case "add.assignee": {
      const m = ctx.members.find((x) => x.id === action.userId);
      return `assign ${m?.fullName ?? "…"}`;
    }
    case "add.tag": {
      const t = ctx.tags.find((x) => x.id === action.tagId);
      return `add tag ${t?.name ?? "…"}`;
    }
    case "post.comment":
      return "post a comment";
    default:
      return "…";
  }
}

/** "When status changes to Done, set priority to Low (+2 more)". */
export function suggestName(
  trigger: AutomationTrigger,
  actions: AutomationAction[],
  ctx: AutomationContext,
): string {
  const when = triggerSummary(trigger, ctx);
  const first = actions[0] ? actionSummary(actions[0], ctx) : "…";
  const extra = actions.length > 1 ? ` (+${actions.length - 1} more)` : "";
  return `When ${when}, ${first}${extra}`;
}

/* ------------------------------------------------------------------ *
 * Builder modal.
 * ------------------------------------------------------------------ */
type ActionType = AutomationAction["type"];

const ACTION_TYPES: { type: ActionType; label: string }[] = [
  { type: "set.status", label: "Set status" },
  { type: "set.priority", label: "Set priority" },
  { type: "add.assignee", label: "Add assignee" },
  { type: "add.tag", label: "Add tag" },
  { type: "post.comment", label: "Post comment" },
];

const TRIGGER_OPTIONS: { type: AutomationTriggerType; label: string }[] = [
  { type: "task.created", label: "Task created" },
  { type: "status.changed", label: "Status changes" },
  { type: "priority.changed", label: "Priority changes" },
  { type: "assignee.added", label: "Assignee added" },
  { type: "due.overdue", label: "Task becomes overdue" },
];

interface ActionRow {
  key: string;
  action: AutomationAction;
}

let rowSeq = 0;
function rowKey(): string {
  rowSeq += 1;
  return `ar_${rowSeq}_${Date.now().toString(36)}`;
}

function defaultAction(type: ActionType, ctx: AutomationContext): AutomationAction {
  switch (type) {
    case "set.status":
      return { type, statusId: ctx.statuses[0]?.id ?? "" };
    case "set.priority":
      return { type, priority: "normal" };
    case "add.assignee":
      return { type, userId: ctx.members[0]?.id ?? "" };
    case "add.tag":
      return { type, tagId: ctx.tags[0]?.id ?? "" };
    default:
      return { type: "post.comment", body: "" };
  }
}

function actionValid(a: AutomationAction): boolean {
  switch (a.type) {
    case "set.status": return Boolean(a.statusId);
    case "set.priority": return Boolean(a.priority);
    case "add.assignee": return Boolean(a.userId);
    case "add.tag": return Boolean(a.tagId);
    case "post.comment": return a.body.trim().length > 0;
    default: return false;
  }
}

export function AutomationBuilder({
  spaceId,
  ctx,
  existing,
  onClose,
  onSaved,
}: {
  spaceId: string;
  ctx: AutomationContext;
  /** Edit an existing rule, or null to create a new one. */
  existing: Automation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(
    existing?.trigger?.type ?? "task.created",
  );
  const [toStatusId, setToStatusId] = useState(existing?.trigger?.toStatusId ?? "");
  const [toPriority, setToPriority] = useState<Priority | "">(
    existing?.trigger?.toPriority ?? "",
  );
  const [rows, setRows] = useState<ActionRow[]>(() =>
    existing && existing.actions.length > 0
      ? existing.actions.map((a) => ({ key: rowKey(), action: a }))
      : [],
  );
  const [name, setName] = useState(existing?.name ?? "");
  const nameTouched = useRef(Boolean(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trigger: AutomationTrigger = useMemo(() => {
    const t: AutomationTrigger = { type: triggerType };
    if (triggerType === "status.changed" && toStatusId) t.toStatusId = toStatusId;
    if (triggerType === "priority.changed" && toPriority) t.toPriority = toPriority;
    return t;
  }, [triggerType, toStatusId, toPriority]);

  const actions = useMemo(() => rows.map((r) => r.action), [rows]);

  // Keep suggesting a name until the user takes over.
  useEffect(() => {
    if (nameTouched.current) return;
    setName(actions.length > 0 ? suggestName(trigger, actions, ctx) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, actions]);

  const addRow = (): void => {
    if (rows.length >= 5) return;
    setRows((prev) => [...prev, { key: rowKey(), action: defaultAction("set.status", ctx) }]);
  };

  const setRowType = (key: string, type: ActionType): void => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, action: defaultAction(type, ctx) } : r)),
    );
  };

  const setRowAction = (key: string, action: AutomationAction): void => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, action } : r)));
  };

  const removeRow = (key: string): void => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const valid =
    actions.length > 0 && actions.every(actionValid) && name.trim().length > 0;

  const save = async (): Promise<void> => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      if (existing) {
        await automationsApi.update(existing.id, { name: name.trim(), trigger, actions });
      } else {
        await automationsApi.create(spaceId, {
          name: name.trim(),
          trigger,
          actions,
          enabled: true,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the automation.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal auto-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic auto-ic">{Icons.zap}</span>
            <div>
              <h2>{existing ? "Edit automation" : "New automation"}</h2>
              <p className="muted share-sub">
                When something happens in this space, do things automatically.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {/* ---- WHEN ---- */}
          <div className="auto-block">
            <span className="auto-kicker auto-kicker-when">When</span>
            <div className="auto-row">
              <select
                className="input auto-select"
                value={triggerType}
                aria-label="Trigger"
                onChange={(e) => {
                  setTriggerType(e.target.value as AutomationTriggerType);
                  setToStatusId("");
                  setToPriority("");
                }}
              >
                {TRIGGER_OPTIONS.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>

              {triggerType === "status.changed" && (
                <select
                  className="input auto-select"
                  value={toStatusId}
                  aria-label="To status"
                  onChange={(e) => setToStatusId(e.target.value)}
                >
                  <option value="">to any status</option>
                  {ctx.statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      to {s.name}
                    </option>
                  ))}
                </select>
              )}

              {triggerType === "priority.changed" && (
                <select
                  className="input auto-select"
                  value={toPriority}
                  aria-label="To priority"
                  onChange={(e) => setToPriority(e.target.value as Priority | "")}
                >
                  <option value="">to any priority</option>
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>
                      to {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* ---- THEN ---- */}
          <div className="auto-block">
            <span className="auto-kicker auto-kicker-then">Then</span>

            {rows.length === 0 && (
              <p className="muted auto-empty-hint">Add at least one action.</p>
            )}

            {rows.map((r) => {
              const a = r.action;
              return (
                <div className="auto-row" key={r.key}>
                  <select
                    className="input auto-select auto-action-type"
                    value={a.type}
                    aria-label="Action"
                    onChange={(e) => setRowType(r.key, e.target.value as ActionType)}
                  >
                    {ACTION_TYPES.map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.label}
                      </option>
                    ))}
                  </select>

                  {a.type === "set.status" && (
                    <select
                      className="input auto-select"
                      value={a.statusId}
                      aria-label="Status"
                      onChange={(e) =>
                        setRowAction(r.key, { type: "set.status", statusId: e.target.value })
                      }
                    >
                      {ctx.statuses.length === 0 && <option value="">No statuses</option>}
                      {ctx.statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {a.type === "set.priority" && (
                    <select
                      className="input auto-select"
                      value={a.priority}
                      aria-label="Priority"
                      onChange={(e) =>
                        setRowAction(r.key, {
                          type: "set.priority",
                          priority: e.target.value as Priority,
                        })
                      }
                    >
                      {PRIORITY_ORDER.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_META[p].label}
                        </option>
                      ))}
                    </select>
                  )}

                  {a.type === "add.assignee" && (
                    <select
                      className="input auto-select"
                      value={a.userId}
                      aria-label="Member"
                      onChange={(e) =>
                        setRowAction(r.key, { type: "add.assignee", userId: e.target.value })
                      }
                    >
                      {ctx.members.length === 0 && <option value="">No members</option>}
                      {ctx.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName}
                        </option>
                      ))}
                    </select>
                  )}

                  {a.type === "add.tag" && (
                    <select
                      className="input auto-select"
                      value={a.tagId}
                      aria-label="Tag"
                      onChange={(e) =>
                        setRowAction(r.key, { type: "add.tag", tagId: e.target.value })
                      }
                    >
                      {ctx.tags.length === 0 && <option value="">No tags in this space</option>}
                      {ctx.tags.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {a.type === "post.comment" && (
                    <input
                      className="input auto-comment"
                      value={a.body}
                      placeholder="Comment text…"
                      onChange={(e) =>
                        setRowAction(r.key, { type: "post.comment", body: e.target.value })
                      }
                    />
                  )}

                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove action"
                    onClick={() => removeRow(r.key)}
                  >
                    {Icons.close}
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={rows.length >= 5}
              onClick={addRow}
            >
              {Icons.plus} Add action{rows.length >= 5 ? " (max 5)" : ""}
            </button>
          </div>

          {/* ---- name ---- */}
          <div className="field" style={{ marginTop: 16 }}>
            <label className="label" htmlFor="auto-name">Name</label>
            <input
              id="auto-name"
              className="input"
              value={name}
              placeholder="e.g. When a task is created, assign Ada"
              onChange={(e) => {
                nameTouched.current = true;
                setName(e.target.value);
              }}
            />
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!valid || busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : existing ? "Save changes" : "Create automation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Runs viewer — recent executions of one rule.
 * ------------------------------------------------------------------ */
export function AutomationRunsModal({
  automation,
  onClose,
}: {
  automation: Automation;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    automationsApi
      .runs(automation.id)
      .then((r) => setRuns(r.runs ?? []))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load the runs.");
        setRuns([]);
      });
  }, [automation.id]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal auto-runs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic auto-ic">{Icons.zap}</span>
            <div>
              <h2>Recent runs</h2>
              <p className="muted share-sub">{automation.name}</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          {runs === null ? (
            <>
              <span className="skel" style={{ height: 40, borderRadius: 10, marginBottom: 8 }} />
              <span className="skel" style={{ height: 40, borderRadius: 10 }} />
            </>
          ) : runs.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "18px 0" }}>
              This rule hasn't run yet — it fires the next time its trigger happens.
            </p>
          ) : (
            <div className="auto-runs">
              {runs.map((r) => (
                <div className="auto-run" key={r.id}>
                  <span className={`auto-run-ok${r.ok ? "" : " failed"}`} aria-hidden="true">
                    {r.ok ? Icons.check : Icons.close}
                  </span>
                  <span className="auto-run-body">
                    <span className="auto-run-task">{r.taskName}</span>
                    {r.detail && <span className="auto-run-detail">{r.detail}</span>}
                  </span>
                  <span className="auto-run-time">{timeAgo(r.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
