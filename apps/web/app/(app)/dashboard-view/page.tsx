"use client";

/**
 * Module 10 — the dashboard canvas (/dashboard-view?id=<id>; /dashboard
 * is Home). Header with inline rename + "Add card" (kind picker → scope
 * step), then a responsive grid of live chart cards. Each card fetches
 * its own `/cards/:id/data` payload and re-fetches (debounced 1s) on
 * `task.changed` SSE so the wall feels alive.
 */

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  dashboardsApi,
  goalsApi,
  sprintsApi,
  type AssigneeLoadCardData,
  type BreakdownCardData,
  type CompletionTrendCardData,
  type DashboardCard,
  type DashboardCardConfig,
  type DashboardCardData,
  type DashboardCardKind,
  type DashboardSummary,
  type GoalProgressCardData,
  type GoalSummary,
  type OverdueByAssigneeCardData,
  type RecentActivityCardData,
  type RecentActivityItem,
  type Sprint,
  type SprintBurndownCardData,
  type TextCardData,
  type TimeTrackedCardData,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { useRealtime } from "@/lib/realtime";
import { Icons, type IconKey } from "@/components/icons";
import {
  Bars,
  ChartEmpty,
  ChartLegend,
  Donut,
  HBars,
  LineChart,
} from "@/components/charts";
import {
  clamp01,
  colorFor,
  formatDuration,
  formatPercent,
  formatShortDate,
  initials,
  timeAgo,
} from "@/lib/format";

/* ------------------------------------------------------------------ *
 * Card kind catalogue.
 * ------------------------------------------------------------------ */
type Scope = "all" | "space" | "list";

const KIND_META: Record<
  DashboardCardKind,
  { label: string; desc: string; icon: IconKey; scoped: boolean }
> = {
  statusBreakdown: {
    label: "Status breakdown",
    desc: "Donut of tasks by status.",
    icon: "goals",
    scoped: true,
  },
  priorityBreakdown: {
    label: "Priority breakdown",
    desc: "Bars of tasks by priority.",
    icon: "flag",
    scoped: true,
  },
  assigneeLoad: {
    label: "Assignee load",
    desc: "Open vs done per person.",
    icon: "members",
    scoped: true,
  },
  timeTracked: {
    label: "Time tracked",
    desc: "Daily hours, last N days.",
    icon: "timer",
    scoped: true,
  },
  goalProgress: {
    label: "Goal progress",
    desc: "Progress bars for your goals.",
    icon: "trendUp",
    scoped: false,
  },
  sprintBurndown: {
    label: "Sprint burndown",
    desc: "Remaining points vs the ideal line.",
    icon: "gantt",
    scoped: false,
  },
  recentActivity: {
    label: "Recent activity",
    desc: "Live feed of task changes.",
    icon: "bolt",
    scoped: true,
  },
  completionTrend: {
    label: "Completion trend",
    desc: "Completed vs created, by week.",
    icon: "trendUp",
    scoped: true,
  },
  overdueByAssignee: {
    label: "Overdue by assignee",
    desc: "Who's carrying overdue tasks.",
    icon: "clock",
    scoped: true,
  },
  text: {
    label: "Text",
    desc: "A note, heading or context block.",
    icon: "note",
    scoped: false,
  },
};

const KIND_ORDER: DashboardCardKind[] = [
  "statusBreakdown",
  "priorityBreakdown",
  "assigneeLoad",
  "timeTracked",
  "goalProgress",
  "sprintBurndown",
  "recentActivity",
  "completionTrend",
  "overdueByAssignee",
  "text",
];

/* ------------------------------------------------------------------ *
 * Add / edit card modal — kind picker, then a scope step.
 * ------------------------------------------------------------------ */
function CardModal({
  dashboardId,
  existing,
  onClose,
  onSaved,
}: {
  dashboardId: string;
  /** When set, we're editing this card's scope instead of creating. */
  existing: DashboardCard | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { tree } = useHierarchy();
  const [kind, setKind] = useState<DashboardCardKind | null>(existing?.kind ?? null);
  const [title, setTitle] = useState(existing?.title ?? "");
  const cfg = existing?.config ?? {};
  const [scope, setScope] = useState<Scope>(
    cfg.listId ? "list" : cfg.spaceId ? "space" : "all",
  );
  const [spaceId, setSpaceId] = useState(cfg.spaceId ?? "");
  const [listId, setListId] = useState(cfg.listId ?? "");
  const [goalId, setGoalId] = useState(cfg.goalId ?? "");
  const [sprintId, setSprintId] = useState(cfg.sprintId ?? "");
  const [days, setDays] = useState(cfg.days ?? 7);
  const [weeks, setWeeks] = useState(cfg.weeks ?? 8);
  const [text, setText] = useState(cfg.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Lazy pickers.
  const [goals, setGoals] = useState<GoalSummary[] | null>(null);
  const [sprints, setSprints] = useState<Sprint[] | null>(null);

  useEffect(() => {
    if (kind === "goalProgress" && goals === null) {
      goalsApi
        .list()
        .then((r) => setGoals(r.goals.filter((g) => !g.archived)))
        .catch(() => setGoals([]));
    }
  }, [kind, goals]);

  useEffect(() => {
    if (kind !== "sprintBurndown" || !spaceId) {
      setSprints(null);
      return;
    }
    let alive = true;
    sprintsApi
      .list(spaceId)
      .then((r) => alive && setSprints(r.sprints))
      .catch(() => alive && setSprints([]));
    return () => {
      alive = false;
    };
  }, [kind, spaceId]);

  const allLists = useMemo(
    () =>
      tree.flatMap((s) =>
        [...s.lists, ...s.folders.flatMap((f) => f.lists)].map((l) => ({
          id: l.id,
          name: l.name,
          spaceName: s.name,
        })),
      ),
    [tree],
  );

  const buildConfig = (): DashboardCardConfig => {
    if (!kind) return {};
    const c: DashboardCardConfig = {};
    if (kind === "text") {
      c.text = text;
      return c;
    }
    if (kind === "goalProgress") {
      if (goalId) c.goalId = goalId;
      return c;
    }
    if (kind === "sprintBurndown") {
      if (spaceId) c.spaceId = spaceId;
      if (sprintId) c.sprintId = sprintId;
      return c;
    }
    if (scope === "space" && spaceId) c.spaceId = spaceId;
    if (scope === "list" && listId) c.listId = listId;
    if (kind === "timeTracked") c.days = days;
    if (kind === "completionTrend") c.weeks = weeks;
    return c;
  };

  const valid =
    kind !== null &&
    (kind !== "sprintBurndown" || !!sprintId) &&
    (kind !== "text" || text.trim().length > 0) &&
    (kind === "sprintBurndown" || kind === "text" || kind === "goalProgress" ||
      (scope !== "space" || !!spaceId) && (scope !== "list" || !!listId));

  const submit = async (): Promise<void> => {
    if (!kind || !valid || busy) return;
    setBusy(true);
    setError("");
    try {
      if (existing) {
        await dashboardsApi.updateCard(existing.id, {
          config: buildConfig(),
          ...(title.trim() && title.trim() !== existing.title
            ? { title: title.trim() }
            : {}),
        });
      } else {
        await dashboardsApi.createCard(dashboardId, {
          kind,
          ...(title.trim() ? { title: title.trim() } : {}),
          config: buildConfig(),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the card.");
      setBusy(false);
    }
  };

  const meta = kind ? KIND_META[kind] : null;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal dbv-modal"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Edit card" : "Add card"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{meta ? Icons[meta.icon] : Icons.dashboards}</span>
            <div>
              <h2>{existing ? "Edit card" : meta ? meta.label : "Add card"}</h2>
              <p className="muted share-sub">
                {meta ? meta.desc : "Pick a visualization for this dashboard."}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {/* Step 1 — pick a kind */}
          {kind === null ? (
            <div className="dbv-kind-grid">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="dbv-kind-tile"
                  onClick={() => setKind(k)}
                >
                  <span className="dbv-kind-ic">{Icons[KIND_META[k].icon]}</span>
                  <span className="dbv-kind-name">{KIND_META[k].label}</span>
                  <span className="dbv-kind-desc">{KIND_META[k].desc}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {!existing && (
                <button
                  type="button"
                  className="dbv-back"
                  onClick={() => setKind(null)}
                >
                  {Icons.chevronLeft} All card types
                </button>
              )}

              <div className="field">
                <label className="label" htmlFor="dbc-title">Title (optional)</label>
                <input
                  id="dbc-title"
                  className="input"
                  placeholder={meta?.label}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {/* Scope: All / Space / List */}
              {meta?.scoped && (
                <div className="field">
                  <span className="label">Scope</span>
                  <div className="dbv-scope-row">
                    {(["all", "space", "list"] as Scope[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`chip${scope === s ? " active" : ""}`}
                        onClick={() => setScope(s)}
                      >
                        {s === "all" ? "All spaces" : s === "space" ? "One space" : "One list"}
                      </button>
                    ))}
                  </div>
                  {scope === "space" && (
                    <select
                      className="input dbv-scope-select"
                      value={spaceId}
                      onChange={(e) => setSpaceId(e.target.value)}
                    >
                      <option value="">Pick a space…</option>
                      {tree.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                  {scope === "list" && (
                    <select
                      className="input dbv-scope-select"
                      value={listId}
                      onChange={(e) => setListId(e.target.value)}
                    >
                      <option value="">Pick a list…</option>
                      {allLists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.spaceName} / {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* timeTracked — window */}
              {kind === "timeTracked" && (
                <div className="field">
                  <span className="label">Window</span>
                  <div className="dbv-scope-row">
                    {[7, 14, 30].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`chip${days === d ? " active" : ""}`}
                        onClick={() => setDays(d)}
                      >
                        {d} days
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* completionTrend — how many weeks back */}
              {kind === "completionTrend" && (
                <div className="field">
                  <label className="label" htmlFor="dbc-weeks">Weeks</label>
                  <input
                    id="dbc-weeks"
                    className="input dbv-weeks-input"
                    type="number"
                    min={1}
                    max={26}
                    value={weeks}
                    onChange={(e) =>
                      setWeeks(Math.min(26, Math.max(1, Number(e.target.value) || 1)))
                    }
                  />
                </div>
              )}

              {/* goalProgress — optional goal picker */}
              {kind === "goalProgress" && (
                <div className="field">
                  <label className="label" htmlFor="dbc-goal">Goal</label>
                  <select
                    id="dbc-goal"
                    className="input"
                    value={goalId}
                    onChange={(e) => setGoalId(e.target.value)}
                  >
                    <option value="">All goals</option>
                    {(goals ?? []).map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* sprintBurndown — space → sprint */}
              {kind === "sprintBurndown" && (
                <>
                  <div className="field">
                    <label className="label" htmlFor="dbc-sp-space">Space</label>
                    <select
                      id="dbc-sp-space"
                      className="input"
                      value={spaceId}
                      onChange={(e) => {
                        setSpaceId(e.target.value);
                        setSprintId("");
                      }}
                    >
                      <option value="">Pick a space…</option>
                      {tree.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  {spaceId && (
                    <div className="field">
                      <label className="label" htmlFor="dbc-sprint">Sprint</label>
                      <select
                        id="dbc-sprint"
                        className="input"
                        value={sprintId}
                        onChange={(e) => setSprintId(e.target.value)}
                      >
                        <option value="">
                          {sprints === null
                            ? "Loading sprints…"
                            : sprints.length === 0
                              ? "No sprints in this space"
                              : "Pick a sprint…"}
                        </option>
                        {(sprints ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({formatShortDate(s.startDate)} – {formatShortDate(s.endDate)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* text — the content itself */}
              {kind === "text" && (
                <div className="field">
                  <label className="label" htmlFor="dbc-text">Text</label>
                  <textarea
                    id="dbc-text"
                    className="input dbv-textarea"
                    rows={5}
                    placeholder="Context, links, a headline for this dashboard…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </div>
              )}

              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!valid || busy}
                  onClick={() => void submit()}
                >
                  {busy ? "Saving…" : existing ? "Save card" : "Add card"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Per-kind card bodies.
 * ------------------------------------------------------------------ */
function StatusBreakdownBody({ data }: { data: BreakdownCardData }) {
  const slices = (data.slices ?? []).map((s) => ({ ...s, count: Number(s.count) || 0 }));
  const total = slices.reduce((n, s) => n + s.count, 0);
  if (total === 0) return <ChartEmpty>No tasks in scope yet.</ChartEmpty>;
  return (
    <div className="dbc-donut-wrap">
      <Donut slices={slices} />
      <div className="dbc-donut-legend">
        {slices
          .filter((s) => s.count > 0)
          .map((s) => (
            <span key={s.label} className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: s.color }} />
              <span className="chart-legend-label">{s.label}</span>
              <span className="chart-legend-value">{s.count}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

function PriorityBody({ data }: { data: BreakdownCardData }) {
  const rows = (data.slices ?? []).map((s) => ({ ...s, count: Number(s.count) || 0 }));
  if (rows.every((r) => r.count === 0)) {
    return <ChartEmpty>No prioritized tasks in scope.</ChartEmpty>;
  }
  return <HBars rows={rows} />;
}

function AssigneeLoadBody({ data }: { data: AssigneeLoadCardData }) {
  const rows = (data.rows ?? []).map((r) => ({
    ...r,
    open: Number(r.open) || 0,
    done: Number(r.done) || 0,
  }));
  if (rows.length === 0) return <ChartEmpty>No assigned tasks in scope.</ChartEmpty>;
  const max = Math.max(...rows.map((r) => r.open + r.done), 1);
  return (
    <div className="dbc-load">
      {rows.map((r) => (
        <div key={r.user.id} className="dbc-load-row" title={`${r.user.fullName} — ${r.open} open · ${r.done} done`}>
          <span
            className="avatar avatar-sm"
            style={{ background: colorFor(r.user.id) }}
          >
            {initials(r.user.fullName)}
          </span>
          <span className="dbc-load-name">{r.user.fullName}</span>
          <span className="dbc-load-track">
            {r.open > 0 && (
              <span
                className="dbc-load-open"
                style={{ width: `${(r.open / max) * 100}%` }}
              />
            )}
            {r.done > 0 && (
              <span
                className="dbc-load-done"
                style={{ width: `${(r.done / max) * 100}%` }}
              />
            )}
          </span>
          <span className="dbc-load-counts">
            {r.open} open · {r.done} done
          </span>
        </div>
      ))}
      <ChartLegend
        items={[
          { label: "Open", color: "var(--brand)" },
          { label: "Done", color: "var(--ok)" },
        ]}
      />
    </div>
  );
}

function TimeTrackedBody({ data }: { data: TimeTrackedCardData }) {
  const days = data.days ?? [];
  const total = Number(data.totalSeconds) || 0;
  if (days.length === 0 || total === 0) {
    return <ChartEmpty>No time tracked in this window.</ChartEmpty>;
  }
  return (
    <div className="dbc-time">
      <span className="dbc-corner-stat" title="Total tracked in window">
        {Icons.timer}
        {formatDuration(total)}
      </span>
      <Bars
        points={days.map((d) => {
          const hours = Math.round(((Number(d.seconds) || 0) / 3600) * 10) / 10;
          return {
            label: formatShortDate(d.date).replace(/,.*/, ""),
            value: hours,
            hint: `${formatShortDate(d.date)} — ${formatDuration(Number(d.seconds) || 0)}`,
          };
        })}
        formatValue={(v) => `${v}h`}
      />
    </div>
  );
}

function GoalProgressBody({ data }: { data: GoalProgressCardData }) {
  const goals = data.goals ?? [];
  if (goals.length === 0) return <ChartEmpty>No goals yet — set one on the Goals page.</ChartEmpty>;
  return (
    <div className="dbc-goals">
      {goals.map((g) => {
        const p = clamp01(g.progress);
        return (
          <Link key={g.id} href={`/goal?id=${g.id}`} className="dbc-goal-row">
            <span className="dbc-goal-name">{g.name}</span>
            <span className="goal-prog-track dbc-goal-track">
              <span
                className={`goal-prog-fill${p >= 1 ? " full" : ""}`}
                style={{ width: `${p * 100}%` }}
              />
            </span>
            <span className={`goal-prog-label${p >= 1 ? " full" : ""}`}>
              {formatPercent(p)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function BurndownBody({ data }: { data: SprintBurndownCardData }) {
  const days = data.days ?? [];
  if (days.length === 0) return <ChartEmpty>No burndown data yet.</ChartEmpty>;
  return (
    <div className="dbc-burndown">
      <div className="dbc-burndown-meta">
        <Link href={`/sprint?id=${data.sprint.id}`} className="dbc-burndown-sprint">
          {data.sprint.name}
        </Link>
        <span className="muted">
          {formatShortDate(data.sprint.startDate)} – {formatShortDate(data.sprint.endDate)} ·{" "}
          {Number(data.totalPoints) || 0} pts
        </span>
      </div>
      <LineChart days={days} totalPoints={Number(data.totalPoints) || 0} height={190} />
      <ChartLegend
        items={[
          { label: "Remaining", color: "var(--brand)" },
          { label: "Ideal", color: "var(--muted)", dashed: true },
        ]}
      />
    </div>
  );
}

/** "status" → "changed status on", etc. Falls back to "updated". */
const ACTIVITY_VERB: Record<string, string> = {
  created: "created",
  status: "changed status on",
  priority: "reprioritized",
  dates: "rescheduled",
  assignee: "reassigned",
  name: "renamed",
  description: "described",
  archived: "archived",
  completed: "completed",
  comment: "commented on",
};

function actorName(actor: RecentActivityItem["actor"]): string {
  if (!actor) return "Someone";
  return typeof actor === "string" ? actor : actor.fullName;
}

function ActivityBody({ data }: { data: RecentActivityCardData }) {
  const items = data.items ?? [];
  if (items.length === 0) return <ChartEmpty>Nothing has happened yet.</ChartEmpty>;
  return (
    <div className="dbc-feed">
      {items.map((it, i) => {
        const name = actorName(it.actor);
        const seed =
          it.actor && typeof it.actor === "object" ? it.actor.id : name;
        return (
          <div key={`${it.taskId}-${it.createdAt}-${i}`} className="dbc-feed-row">
            <span className="avatar avatar-sm" style={{ background: colorFor(seed) }}>
              {initials(name)}
            </span>
            <span className="dbc-feed-text">
              <strong>{name}</strong> {ACTIVITY_VERB[it.kind] ?? "updated"}{" "}
              <span className="dbc-feed-task">{it.taskName}</span>
            </span>
            <span className="dbc-feed-time">{timeAgo(it.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CompletionTrendBody({ data }: { data: CompletionTrendCardData }) {
  const weeks = (data.weeks ?? []).map((w) => ({
    week: w.week,
    completed: Number(w.completed) || 0,
    created: Number(w.created) || 0,
  }));
  const totalCompleted = Number(data.totalCompleted) || 0;
  if (weeks.length === 0 || weeks.every((w) => w.completed === 0 && w.created === 0)) {
    return <ChartEmpty>No completed or created tasks in this window.</ChartEmpty>;
  }
  const max = Math.max(...weeks.map((w) => Math.max(w.completed, w.created)), 1);
  const n = weeks.length;
  // Which week labels fit: all when few, first/middle/last otherwise.
  const labelIdx = new Set<number>(
    n <= 9 ? weeks.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1],
  );
  return (
    <div className="dbc-trend">
      <span className="dbc-corner-stat" title="Completed in window">
        {Icons.check}
        {totalCompleted} completed
      </span>
      <div className="dbc-trend-bars">
        {weeks.map((w, i) => (
          <div
            key={w.week}
            className="dbc-trend-week"
            title={`Week of ${formatShortDate(w.week)} — ${w.completed} completed · ${w.created} created`}
          >
            <span className="dbc-trend-cols">
              <span
                className="dbc-trend-bar dbc-trend-completed"
                style={{ height: `${Math.max((w.completed / max) * 100, w.completed > 0 ? 4 : 0)}%` }}
              />
              <span
                className="dbc-trend-bar dbc-trend-created"
                style={{ height: `${Math.max((w.created / max) * 100, w.created > 0 ? 4 : 0)}%` }}
              />
            </span>
            <span className="dbc-trend-label">
              {labelIdx.has(i) ? formatShortDate(w.week).replace(/,.*/, "") : ""}
            </span>
          </div>
        ))}
      </div>
      <ChartLegend
        items={[
          { label: "Completed", color: "var(--brand)" },
          { label: "Created", color: "var(--brand-soft-2)" },
        ]}
      />
    </div>
  );
}

function OverdueByAssigneeBody({ data }: { data: OverdueByAssigneeCardData }) {
  const rows = (data.rows ?? []).map((r) => ({ ...r, overdue: Number(r.overdue) || 0 }));
  const unassigned = Number(data.unassigned) || 0;
  if (rows.length === 0 && unassigned === 0) {
    return <ChartEmpty>Nothing overdue 🎉</ChartEmpty>;
  }
  return (
    <div className="dbc-overdue">
      {rows.map((r) => (
        <div
          key={r.user.id}
          className="dbc-overdue-row"
          title={`${r.user.fullName} — ${r.overdue} overdue`}
        >
          <span className="avatar avatar-sm" style={{ background: colorFor(r.user.id) }}>
            {initials(r.user.fullName)}
          </span>
          <span className="dbc-overdue-name">{r.user.fullName}</span>
          <span className="dbc-overdue-badge">{r.overdue}</span>
        </div>
      ))}
      {unassigned > 0 && (
        <div className="dbc-overdue-row" title={`Unassigned — ${unassigned} overdue`}>
          <span className="avatar avatar-sm dbc-overdue-none">{Icons.members}</span>
          <span className="dbc-overdue-name">Unassigned</span>
          <span className="dbc-overdue-badge">{unassigned}</span>
        </div>
      )}
    </div>
  );
}

function TextBody({ data }: { data: TextCardData }) {
  return <div className="dbc-text">{data.text || ""}</div>;
}

/* ------------------------------------------------------------------ *
 * One dashboard card: frame, inline title rename, ⋯ menu, live body.
 * ------------------------------------------------------------------ */
function CardView({
  card,
  index,
  count,
  refreshKey,
  onEditScope,
  onChanged,
  onMove,
}: {
  card: DashboardCard;
  index: number;
  count: number;
  refreshKey: number;
  onEditScope: () => void;
  onChanged: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [data, setData] = useState<DashboardCardData | null>(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  const configKey = JSON.stringify(card.config ?? {});
  useEffect(() => {
    let alive = true;
    dashboardsApi
      .cardData(card.id)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError("");
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load this card.");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, configKey, refreshKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const commitRename = (): void => {
    setRenaming(false);
    const v = renameVal.trim();
    if (!v || v === card.title) return;
    dashboardsApi
      .updateCard(card.id, { title: v })
      .then(onChanged)
      .catch(() => undefined);
  };

  const resize = (): void => {
    setMenuOpen(false);
    dashboardsApi
      .updateCard(card.id, { width: card.width === "full" ? "half" : "full" })
      .then(onChanged)
      .catch(() => undefined);
  };

  const remove = (): void => {
    setMenuOpen(false);
    if (!window.confirm(`Remove the card “${card.title}”?`)) return;
    dashboardsApi
      .removeCard(card.id)
      .then(onChanged)
      .catch(() => undefined);
  };

  const meta = KIND_META[card.kind];

  let body: React.ReactNode;
  if (error) {
    body = <ChartEmpty>{error}</ChartEmpty>;
  } else if (data === null) {
    body = (
      <div className="dbc-loading">
        <span className="skel" style={{ height: 18, width: "60%" }} />
        <span className="skel" style={{ height: 90, width: "100%" }} />
      </div>
    );
  } else {
    switch (card.kind) {
      case "statusBreakdown":
        body = <StatusBreakdownBody data={data as BreakdownCardData} />;
        break;
      case "priorityBreakdown":
        body = <PriorityBody data={data as BreakdownCardData} />;
        break;
      case "assigneeLoad":
        body = <AssigneeLoadBody data={data as AssigneeLoadCardData} />;
        break;
      case "timeTracked":
        body = <TimeTrackedBody data={data as TimeTrackedCardData} />;
        break;
      case "goalProgress":
        body = <GoalProgressBody data={data as GoalProgressCardData} />;
        break;
      case "sprintBurndown":
        body = <BurndownBody data={data as SprintBurndownCardData} />;
        break;
      case "recentActivity":
        body = <ActivityBody data={data as RecentActivityCardData} />;
        break;
      case "completionTrend":
        body = <CompletionTrendBody data={data as CompletionTrendCardData} />;
        break;
      case "overdueByAssignee":
        body = <OverdueByAssigneeBody data={data as OverdueByAssigneeCardData} />;
        break;
      case "text":
        body = <TextBody data={data as TextCardData} />;
        break;
    }
  }

  return (
    <section className={`dbv-card${card.width === "full" ? " full" : ""}`}>
      <div className="dbv-card-head">
        <span className="dbv-card-ic" title={meta?.label}>
          {meta ? Icons[meta.icon] : Icons.dashboards}
        </span>
        {renaming ? (
          <input
            className="dp-rename"
            value={renameVal}
            autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="dbv-card-title"
            title="Rename card"
            onClick={() => {
              setRenameVal(card.title || meta?.label || "");
              setRenaming(true);
            }}
          >
            {card.title || meta?.label || "Card"}
          </button>
        )}
        <span className="dp-menu-wrap">
          <button
            type="button"
            className="icon-btn dbv-card-more"
            aria-label="Card menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {Icons.more}
          </button>
          {menuOpen && (
            <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={resize}>
                {Icons.board}
                {card.width === "full" ? "Half width" : "Full width"}
              </button>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  setMenuOpen(false);
                  onMove(-1);
                }}
              >
                {Icons.arrowUp} Move up
              </button>
              <button
                type="button"
                disabled={index >= count - 1}
                onClick={() => {
                  setMenuOpen(false);
                  onMove(1);
                }}
              >
                {Icons.arrowDown} Move down
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onEditScope();
                }}
              >
                {Icons.sliders} {card.kind === "text" ? "Edit text" : "Edit scope"}
              </button>
              <button type="button" className="danger" onClick={remove}>
                {Icons.trash} Remove card
              </button>
            </div>
          )}
        </span>
      </div>
      <div className="dbv-card-body">{body}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The canvas page.
 * ------------------------------------------------------------------ */
function DashboardView() {
  const search = useSearchParams();
  const id = search.get("id");
  const router = useRouter();

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DashboardCard | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback((): void => {
    if (!id) return;
    dashboardsApi
      .get(id)
      .then((r) => {
        setDashboard(r.dashboard);
        setCards([...r.cards].sort((a, b) => a.position - b.position));
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this dashboard."),
      )
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  // Live refetch — debounced 1s so a burst of task changes costs one pass.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime((e) => {
    if (e.type !== "task.changed" && e.type !== "time.changed") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setRefreshKey((k) => k + 1);
    }, 1000);
  }, []);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const commitRename = (): void => {
    setRenaming(false);
    const v = renameVal.trim();
    if (!dashboard || !v || v === dashboard.name) return;
    setDashboard({ ...dashboard, name: v });
    dashboardsApi.update(dashboard.id, { name: v }).catch(load);
  };

  const removeDashboard = (): void => {
    setMenuOpen(false);
    if (!dashboard) return;
    if (!window.confirm(`Delete the dashboard “${dashboard.name}”? Its cards go with it.`)) return;
    dashboardsApi
      .remove(dashboard.id)
      .then(() => router.replace("/dashboards"))
      .catch(() => undefined);
  };

  const moveCard = (index: number, dir: -1 | 1): void => {
    const target = index + dir;
    if (target < 0 || target >= cards.length) return;
    const moved = cards[index];
    const next = [...cards];
    next.splice(index, 1);
    next.splice(target, 0, moved);
    setCards(next); // optimistic
    dashboardsApi
      .updateCard(moved.id, { position: target })
      .then(load)
      .catch(load);
  };

  if (!id) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.dashboards}</span>
          <h3>No dashboard selected</h3>
          <p>Pick one from the Dashboards page.</p>
          <Link href="/dashboards" className="btn btn-soft">Browse dashboards</Link>
        </div>
      </div>
    );
  }

  if (loading && !dashboard) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 32, marginBottom: 18 }} />
        <div className="dbv-grid">
          <span className="skel" style={{ height: 220, borderRadius: 14 }} />
          <span className="skel" style={{ height: 220, borderRadius: 14 }} />
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="page">
        <div className="form-error">{error || "Dashboard not found."}</div>
        <Link href="/dashboards" className="btn btn-soft">Back to Dashboards</Link>
      </div>
    );
  }

  return (
    <div className="page dbv-page">
      <div className="dbv-head">
        <Link href="/dashboards" className="dbv-crumb">
          {Icons.dashboards}
          Dashboards
          {Icons.chevronRight}
        </Link>
        {renaming ? (
          <input
            className="dp-rename dbv-rename"
            value={renameVal}
            autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="dbv-name"
            title="Rename dashboard"
            onClick={() => {
              setRenameVal(dashboard.name);
              setRenaming(true);
            }}
          >
            {dashboard.name}
            {Icons.edit}
          </button>
        )}
        <span className="dbv-head-spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          {Icons.plus} Add card
        </button>
        <span className="dp-menu-wrap">
          <button
            type="button"
            className="icon-btn"
            aria-label="Dashboard menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {Icons.more}
          </button>
          {menuOpen && (
            <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="danger" onClick={removeDashboard}>
                {Icons.trash} Delete dashboard
              </button>
            </div>
          )}
        </span>
      </div>

      {cards.length === 0 ? (
        <div className="empty-state dbv-hero">
          <span className="empty-ic">{Icons.dashboards}</span>
          <h3>Add your first card</h3>
          <p>
            Status donuts, burndown lines, workload bars, live activity —
            compose the view your team checks every morning.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {Icons.plus} Add a card
          </button>
        </div>
      ) : (
        <div className="dbv-grid">
          {cards.map((c, i) => (
            <CardView
              key={c.id}
              card={c}
              index={i}
              count={cards.length}
              refreshKey={refreshKey}
              onEditScope={() => setEditing(c)}
              onChanged={load}
              onMove={(dir) => moveCard(i, dir)}
            />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <CardModal
          dashboardId={dashboard.id}
          existing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

export default function DashboardViewPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 32 }} />
        </div>
      }
    >
      <DashboardView />
    </Suspense>
  );
}
