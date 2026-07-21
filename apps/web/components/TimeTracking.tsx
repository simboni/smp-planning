"use client";

/**
 * TimeTracking (Module 8) — the Time Tracking section of the TaskPanel.
 *
 * A prominent timer control (start / live-elapsed / stop, aware of a timer
 * running on another task), the task's tracked + billable totals, an
 * estimate-vs-tracked progress bar, the entries list (billable toggle and
 * delete for the caller's own entries), and an inline "＋ Add time" manual
 * entry form (start datetime + duration minutes).
 *
 * Refetches on `time.changed` events so other sessions stay in sync.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getUser,
  timeApi,
  type RunningTimer,
  type TimeEntry,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import {
  elapsedSeconds,
  formatDueDate,
  formatDuration,
  formatEstimate,
  formatTimer,
} from "@/lib/format";
import { Avatar } from "@/components/Avatar";

export function TimeTracking({
  taskId,
  estimateMinutes,
  canTrack,
  onChanged,
}: {
  taskId: string;
  estimateMinutes: number | null;
  /** Whether the caller may track time / add entries here. */
  canTrack: boolean;
  /** Fired after any mutation so the list refreshes trackedSeconds chips. */
  onChanged: () => void;
}) {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [billableSeconds, setBillableSeconds] = useState(0);
  const [running, setRunning] = useState<RunningTimer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Manual-entry inline form.
  const [adding, setAdding] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [addBillable, setAddBillable] = useState(false);
  const [addNote, setAddNote] = useState("");

  // 1s tick re-render while a timer runs on this task.
  const [, setTick] = useState(0);

  const me = getUser();
  const runningHere = running !== null && running.task.id === taskId;

  const loadEntries = (): void => {
    timeApi
      .listEntries(taskId)
      .then((r) => {
        setEntries(r.entries);
        setTotalSeconds(r.totalSeconds);
        setBillableSeconds(r.billableSeconds);
      })
      .catch(() => setEntries([]));
  };
  const loadTimer = (): void => {
    timeApi
      .runningTimer()
      .then((r) => setRunning(r.running))
      .catch(() => undefined);
  };

  useEffect(() => {
    setEntries(null);
    setError("");
    loadEntries();
    loadTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useRealtime(
    (e) => {
      if (e.type === "time.changed") {
        loadTimer();
        if (e.payload.taskId === taskId) loadEntries();
      }
    },
    [taskId],
  );

  useEffect(() => {
    if (!runningHere) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [runningHere]);

  const run = (fn: () => Promise<unknown>): void => {
    if (busy) return;
    setBusy(true);
    setError("");
    fn()
      .then(() => {
        loadEntries();
        loadTimer();
        onChanged();
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Something went wrong."),
      )
      .finally(() => setBusy(false));
  };

  const startTimer = (): void => run(() => timeApi.startTimer(taskId));
  const stopTimer = (): void => run(() => timeApi.stopTimer());

  const addManual = (): void => {
    const mins = parseInt(durationMin, 10);
    if (!startAt || !mins || mins <= 0) return;
    const started = new Date(startAt);
    if (Number.isNaN(started.getTime())) return;
    const ended = new Date(started.getTime() + mins * 60_000);
    const note = addNote.trim();
    setAdding(false);
    setStartAt("");
    setDurationMin("");
    setAddNote("");
    setAddBillable(false);
    run(() =>
      timeApi.createEntry(taskId, {
        startedAt: started.toISOString(),
        endedAt: ended.toISOString(),
        billable: addBillable,
        ...(note ? { note } : {}),
      }),
    );
  };

  const toggleBillable = (e: TimeEntry): void =>
    run(() => timeApi.updateEntry(e.id, { billable: !e.billable }));
  const deleteEntry = (e: TimeEntry): void => {
    if (!window.confirm("Delete this time entry?")) return;
    run(() => timeApi.removeEntry(e.id));
  };

  // Completed entries newest-first; a running entry on this task shows in
  // the timer control instead.
  const shown = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => e.endedAt !== null)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [entries],
  );

  const liveSeconds = runningHere ? elapsedSeconds(running.entry.startedAt) : 0;
  const trackedWithLive = totalSeconds + (runningHere ? liveSeconds : 0);
  const estimateSeconds = (estimateMinutes ?? 0) * 60;
  const pct =
    estimateSeconds > 0 ? Math.min(100, (trackedWithLive / estimateSeconds) * 100) : 0;
  const over = estimateSeconds > 0 && trackedWithLive > estimateSeconds;

  return (
    <section className="tp-section tt-section">
      <div className="tp-section-head">
        <h3 className="tp-section-title">
          {Icons.timer} Time Tracking
          {shown.length > 0 && <span className="tp-count-badge">{shown.length}</span>}
        </h3>
        {canTrack && !adding && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAdding(true)}
          >
            {Icons.plus} Add time
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* timer control */}
      <div className={`tt-timer${runningHere ? " live" : ""}`}>
        {runningHere ? (
          <>
            <span className="tt-pulse" aria-hidden="true" />
            <span className="tt-elapsed" aria-live="off">
              {formatTimer(liveSeconds)}
            </span>
            <span className="tt-timer-hint">Timer running</span>
            <button
              type="button"
              className="btn btn-primary btn-sm tt-stop-btn"
              disabled={busy}
              onClick={stopTimer}
            >
              {Icons.stop} Stop
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canTrack || busy}
              onClick={startTimer}
            >
              {Icons.play} Start timer
            </button>
            {running && (
              <span className="tt-timer-hint" title={running.task.name}>
                Currently timing “{running.task.name}” — starting here switches it.
              </span>
            )}
          </>
        )}
      </div>

      {/* totals + estimate bar */}
      <div className="tt-totals">
        <span className="tt-total">
          <span className="tt-total-label">Tracked</span>
          <strong>{formatDuration(trackedWithLive)}</strong>
        </span>
        {billableSeconds > 0 && (
          <span className="tt-total">
            <span className="tt-total-label">Billable</span>
            <strong className="tt-billable-val">{formatDuration(billableSeconds)}</strong>
          </span>
        )}
        {estimateSeconds > 0 && (
          <span className="tt-total">
            <span className="tt-total-label">Estimate</span>
            <strong>{formatEstimate(estimateMinutes)}</strong>
          </span>
        )}
      </div>
      {estimateSeconds > 0 && (
        <div
          className={`progress tt-progress${over ? " over" : ""}`}
          title={`${formatDuration(trackedWithLive)} of ${formatEstimate(estimateMinutes)} estimated`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* manual entry form */}
      {adding && (
        <div className="tt-add-form">
          <label className="tt-add-field">
            <span>Start</span>
            <input
              type="datetime-local"
              className="input"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </label>
          <label className="tt-add-field tt-add-mins">
            <span>Minutes</span>
            <input
              type="number"
              min={1}
              className="input"
              placeholder="30"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
            />
          </label>
          <label className="tt-add-field tt-add-note">
            <span>Note</span>
            <input
              className="input"
              placeholder="What was this time for?"
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
            />
          </label>
          <label className="tt-add-billable">
            <input
              type="checkbox"
              checked={addBillable}
              onChange={(e) => setAddBillable(e.target.checked)}
            />
            Billable
          </label>
          <div className="tt-add-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!startAt || !(parseInt(durationMin, 10) > 0) || busy}
              onClick={addManual}
            >
              Add
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* entries */}
      {entries === null ? (
        <span className="skel" style={{ width: "100%", height: 40 }} />
      ) : shown.length === 0 ? (
        !adding && <div className="tp-empty tp-empty-pad">No time tracked yet.</div>
      ) : (
        <div className="tt-entries">
          {shown.map((e) => {
            const mine = me !== null && e.user.id === me.id;
            return (
              <div className="tt-entry" key={e.id}>
                <Avatar
                  name={e.user.fullName}
                  id={e.user.id}
                  avatarUrl={e.user.avatarUrl}
                  className="avatar-sm"
                  title={e.user.fullName}
                />
                <span className="tt-entry-dur">{formatDuration(e.durationSeconds)}</span>
                <span className="tt-entry-date" title={new Date(e.startedAt).toLocaleString()}>
                  {formatDueDate(e.startedAt)}
                </span>
                {mine && canTrack ? (
                  <button
                    type="button"
                    className={`tt-bill-tag${e.billable ? " on" : ""}`}
                    title={e.billable ? "Billable — click to make non-billable" : "Non-billable — click to make billable"}
                    disabled={busy}
                    onClick={() => toggleBillable(e)}
                  >
                    $
                  </button>
                ) : (
                  e.billable && (
                    <span className="tt-bill-tag on ro" title="Billable">
                      $
                    </span>
                  )
                )}
                {e.note && (
                  <span className="tt-entry-note" title={e.note}>
                    {e.note}
                  </span>
                )}
                <span className="tt-entry-spacer" />
                {mine && canTrack && (
                  <button
                    type="button"
                    className="icon-btn tt-entry-del"
                    title="Delete entry"
                    disabled={busy}
                    onClick={() => deleteEntry(e)}
                  >
                    {Icons.trash}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
