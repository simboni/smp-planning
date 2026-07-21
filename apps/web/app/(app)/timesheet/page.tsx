"use client";

/**
 * Timesheet (Module 8) — the caller's tracked week plus, for admins and
 * owners, a "Team" tab of every member's totals with approve/reject.
 *
 * My week: Monday-start week navigation, a 7-column grid of days (per-day
 * totals + that day's entries linking back to their tasks), a prominent
 * week total, and submit-for-approval with a Draft / Submitted /
 * Approved / Rejected state chip. Live-refetches on `time.changed`.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getWorkspace,
  timeApi,
  workspacesApi,
  type MyTimesheet,
  type TimesheetRow,
  type TimesheetSubmission,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { WeekNav } from "@/components/WeekNav";
import {
  formatDuration,
  formatDayLabel,
  isTodayYmd,
  mondayOf,
} from "@/lib/format";
import { Avatar } from "@/components/Avatar";

type Tab = "me" | "team";

/** Status chip for a submission (null = draft). */
function SubmissionChip({ submission }: { submission: TimesheetSubmission | null }) {
  if (!submission) return <span className="ts-chip draft">Draft</span>;
  if (submission.status === "approved")
    return <span className="ts-chip approved">{Icons.check} Approved</span>;
  if (submission.status === "rejected")
    return <span className="ts-chip rejected">{Icons.close} Rejected</span>;
  return <span className="ts-chip submitted">{Icons.clock} Submitted</span>;
}

export default function TimesheetPage() {
  const router = useRouter();

  // Week is set client-side so the static export never bakes a build date.
  const [weekStart, setWeekStart] = useState("");
  const [tab, setTab] = useState<Tab>("me");
  const [isAdmin, setIsAdmin] = useState(false);

  const [sheet, setSheet] = useState<MyTimesheet | null>(null);
  const [rows, setRows] = useState<TimesheetRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWeekStart(mondayOf(new Date()));
    const cached = getWorkspace();
    if (cached) setIsAdmin(cached.role === "owner" || cached.role === "admin");
    else {
      workspacesApi
        .current()
        .then((r) => setIsAdmin(r.role === "owner" || r.role === "admin"))
        .catch(() => undefined);
    }
  }, []);

  const loadMine = (ws: string): void => {
    timeApi
      .myTimesheet(ws)
      .then((r) => {
        setSheet(r);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load your timesheet."),
      );
  };
  const loadTeam = (ws: string): void => {
    timeApi
      .teamTimesheets(ws)
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]));
  };

  useEffect(() => {
    if (!weekStart) return;
    setSheet(null);
    setRows(null);
    loadMine(weekStart);
    if (isAdmin) loadTeam(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, isAdmin]);

  useRealtime(
    (e) => {
      if (e.type === "time.changed" && weekStart) {
        loadMine(weekStart);
        if (isAdmin) loadTeam(weekStart);
      }
    },
    [weekStart, isAdmin],
  );

  const submit = (): void => {
    if (!weekStart || busy) return;
    setBusy(true);
    timeApi
      .submitTimesheet(weekStart)
      .then((r) => setSheet((prev) => (prev ? { ...prev, submission: r.submission } : prev)))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't submit this week."),
      )
      .finally(() => setBusy(false));
  };

  const decide = (userId: string, decision: "approved" | "rejected"): void => {
    if (!weekStart || busy) return;
    setBusy(true);
    timeApi
      .decideTimesheet(userId, weekStart, decision)
      .then((r) =>
        setRows((prev) =>
          (prev ?? []).map((row) =>
            row.user.id === userId ? { ...row, submission: r.submission } : row,
          ),
        ),
      )
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't record the decision."),
      )
      .finally(() => setBusy(false));
  };

  const openEntryTask = (listId: string, taskId: string): void => {
    router.push(`/list?id=${listId}&task=${taskId}`);
  };

  const billableTotal = (sheet?.days ?? []).reduce((sum, d) => sum + d.billableSeconds, 0);
  const submission = sheet?.submission ?? null;
  const canSubmit =
    submission === null || submission.status === "rejected";

  return (
    <div className="page page-wide">
      <div className="page-head page-head-row">
        <div>
          <h1>Timesheet</h1>
          <p className="sub">Your tracked time, week by week.</p>
        </div>
        {weekStart && <WeekNav weekStart={weekStart} onChange={setWeekStart} />}
      </div>

      {error && <div className="form-error">{error}</div>}

      {isAdmin && (
        <div className="cm-tabs inbox-tabs" role="tablist" aria-label="Timesheet">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "me"}
            className={`cm-tab${tab === "me" ? " on" : ""}`}
            onClick={() => setTab("me")}
          >
            My week
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "team"}
            className={`cm-tab${tab === "team" ? " on" : ""}`}
            onClick={() => setTab("team")}
          >
            Team
          </button>
        </div>
      )}

      {tab === "me" ? (
        <>
          {/* week summary + submission */}
          <div className="card ts-summary">
            <div className="ts-summary-stat">
              <span className="ts-summary-label">Week total</span>
              <span className="ts-summary-big">
                {sheet ? formatDuration(sheet.totalSeconds) : "–:––"}
              </span>
            </div>
            <div className="ts-summary-stat">
              <span className="ts-summary-label">Billable</span>
              <span className="ts-summary-big billable">
                {sheet ? formatDuration(billableTotal) : "–:––"}
              </span>
            </div>
            <span className="ts-summary-spacer" />
            <SubmissionChip submission={submission} />
            {sheet && canSubmit && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || sheet.totalSeconds <= 0}
                onClick={submit}
              >
                {Icons.send}
                {submission?.status === "rejected" ? "Resubmit" : "Submit for approval"}
              </button>
            )}
          </div>

          {/* 7-day grid */}
          {sheet === null ? (
            <div className="card">
              <span className="skel" style={{ width: "100%", height: 60, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 60 }} />
            </div>
          ) : (
            <div className="ts-grid">
              {sheet.days.map((day) => (
                <div
                  key={day.date}
                  className={`ts-day${isTodayYmd(day.date) ? " today" : ""}`}
                >
                  <div className="ts-day-head">
                    <span className="ts-day-name">{formatDayLabel(day.date)}</span>
                    <span className={`ts-day-total${day.totalSeconds > 0 ? " has" : ""}`}>
                      {formatDuration(day.totalSeconds)}
                    </span>
                  </div>
                  <div className="ts-day-body">
                    {day.entries.length === 0 ? (
                      <span className="ts-day-empty">—</span>
                    ) : (
                      day.entries.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="ts-entry"
                          title={e.note ?? e.taskName}
                          onClick={() => openEntryTask(e.listId, e.taskId)}
                        >
                          <span className="ts-entry-task">{e.taskName}</span>
                          <span className="ts-entry-meta">
                            <span className="ts-entry-dur">
                              {formatDuration(e.durationSeconds)}
                            </span>
                            {e.billable && <span className="tt-bill-tag on ro">$</span>}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* Team tab (admin/owner) */
        <div className="card inbox-card">
          {rows === null ? (
            <>
              <span className="skel" style={{ width: "100%", height: 52, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 52 }} />
            </>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <span className="empty-ic">{Icons.clock}</span>
              <h3>No tracked time this week</h3>
              <p>Team members' tracked hours and submissions will appear here.</p>
            </div>
          ) : (
            <div className="ts-team">
              {rows.map((row) => (
                <div className="ts-team-row" key={row.user.id}>
                  <Avatar
                    name={row.user.fullName}
                    id={row.user.id}
                    avatarUrl={row.user.avatarUrl}
                    className="avatar-sm"
                  />
                  <span className="ts-team-name">{row.user.fullName}</span>
                  <span className="ts-team-hours">
                    <strong>{formatDuration(row.totalSeconds)}</strong>
                    <span className="muted"> total</span>
                  </span>
                  <span className="ts-team-hours">
                    <strong>{formatDuration(row.billableSeconds)}</strong>
                    <span className="muted"> billable</span>
                  </span>
                  <span className="ts-team-spacer" />
                  <SubmissionChip submission={row.submission} />
                  {row.submission?.status === "submitted" && (
                    <span className="ts-team-actions">
                      <button
                        type="button"
                        className="btn btn-soft btn-sm"
                        disabled={busy}
                        onClick={() => decide(row.user.id, "approved")}
                      >
                        {Icons.check} Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm ts-reject"
                        disabled={busy}
                        onClick={() => decide(row.user.id, "rejected")}
                      >
                        {Icons.close} Reject
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
