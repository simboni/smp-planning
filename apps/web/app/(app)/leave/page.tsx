"use client";

/**
 * Leave management (HR module).
 *
 * A member's view: balances per leave type, a request flow with live
 * working-day math, their request history with cancel. An approver's view
 * (admins + department heads): a pending queue with approve/reject + note.
 * Admins define the policy (leave types, with Kenya-statutory starter
 * presets). Everyone sees who's away in the next 30 days.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  leaveApi,
  getWorkspace,
  workspacesApi,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
  type WorkspaceRole,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { Avatar } from "@/components/Avatar";
import { showToast } from "@/lib/toast";

const STANDARD_TYPES: { name: string; daysPerYear: number; color: string }[] = [
  { name: "Annual leave", daysPerYear: 21, color: "#36B37E" },
  { name: "Sick leave", daysPerYear: 14, color: "#FF7452" },
  { name: "Maternity leave", daysPerYear: 90, color: "#E5578C" },
  { name: "Paternity leave", daysPerYear: 14, color: "#00B8D9" },
  { name: "Compassionate leave", daysPerYear: 5, color: "#8777D9" },
  { name: "Study leave", daysPerYear: 5, color: "#FFAB00" },
  { name: "Unpaid leave", daysPerYear: 0, color: "#5B5FEF" },
];

const STATUS_LABEL: Record<LeaveRequest["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Mon–Fri days in [start, end] inclusive — mirrors the server math. */
function workingDays(start: string, end: string): number {
  if (!start || !end || end < start) return 0;
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  let n = 0;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

function fmtRange(start: string, end: string): string {
  return start === end ? start : `${start} → ${end}`;
}

/* ------------------------------------------------------------------ *
 * Request-leave modal.
 * ------------------------------------------------------------------ */
function RequestModal({
  types,
  onClose,
  onCreated,
}: {
  types: LeaveType[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const days = workingDays(start, end || start);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (): Promise<void> => {
    if (busy || !typeId || !start) return;
    setBusy(true);
    setError("");
    try {
      await leaveApi.request({
        leaveTypeId: typeId,
        startDate: start,
        endDate: end || start,
        reason: reason.trim() || undefined,
      });
      showToast("Leave request submitted");
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't submit the request.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Request leave"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.calendar}</span>
            <div>
              <h2>Request leave</h2>
              <p className="muted share-sub">
                Weekends don&apos;t count — only working days are deducted.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="lv-type">Leave type</label>
            <select
              id="lv-type"
              className="input"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="hr-row-2">
            <div className="field">
              <label className="label" htmlFor="lv-start">First day</label>
              <input
                id="lv-start"
                className="input"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="lv-end">Last day</label>
              <input
                id="lv-end"
                className="input"
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {start && (
            <p className="lv-days muted">
              {days} working {days === 1 ? "day" : "days"}
            </p>
          )}

          <div className="field">
            <label className="label" htmlFor="lv-reason">Reason (optional)</label>
            <input
              id="lv-reason"
              className="input"
              placeholder="e.g. Family event"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !typeId || !start || days === 0}
              onClick={() => void submit()}
            >
              {busy ? <span className="spinner" /> : "Submit request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The Leave page.
 * ------------------------------------------------------------------ */
export default function LeavePage() {
  const [types, setTypes] = useState<LeaveType[] | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [approvals, setApprovals] = useState<LeaveRequest[]>([]);
  const [away, setAway] = useState<LeaveRequest[]>([]);
  const [role, setRole] = useState<WorkspaceRole | null>(
    () => getWorkspace()?.role ?? null,
  );
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isAdmin = role === "owner" || role === "admin";

  const load = useCallback((): void => {
    leaveApi
      .types()
      .then((r) => {
        setTypes(r.types);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load leave."),
      );
    leaveApi.balances().then((r) => setBalances(r.balances)).catch(() => undefined);
    leaveApi.requests("mine").then((r) => setMine(r.requests)).catch(() => undefined);
    leaveApi
      .requests("approvals")
      .then((r) => setApprovals(r.requests))
      .catch(() => undefined);
    leaveApi.away().then((r) => setAway(r.requests)).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    workspacesApi
      .current()
      .then((r) => setRole(r.role))
      .catch(() => undefined);
  }, [load]);

  const decide = async (r: LeaveRequest, approve: boolean): Promise<void> => {
    let note: string | undefined;
    if (!approve) {
      const v = window.prompt("Reason for rejecting (shown to the requester)", "");
      if (v === null) return;
      note = v.trim() || undefined;
    }
    setBusyId(r.id);
    try {
      await leaveApi.decide(r.id, approve, note);
      showToast(approve ? `Approved ${r.userName}'s leave` : "Request rejected");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't decide.");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (r: LeaveRequest): Promise<void> => {
    if (!window.confirm("Cancel this leave request?")) return;
    setBusyId(r.id);
    try {
      await leaveApi.cancel(r.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cancel.");
    } finally {
      setBusyId(null);
    }
  };

  const addStandardTypes = async (): Promise<void> => {
    try {
      for (const t of STANDARD_TYPES) {
        await leaveApi.createType(t).catch(() => undefined); // skip existing
      }
      showToast("Standard leave types added");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add types.");
    }
  };

  const editType = (t: LeaveType): void => {
    const name = window.prompt("Leave type name", t.name);
    if (name === null) return;
    const daysStr = window.prompt("Days per year", String(t.daysPerYear));
    if (daysStr === null) return;
    const daysPerYear = Number(daysStr);
    void leaveApi
      .updateType(t.id, { name: name.trim() || t.name, daysPerYear })
      .then(load)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't update."),
      );
  };

  const activeRequests = useMemo(
    () => mine.filter((r) => r.status === "pending" || r.status === "approved"),
    [mine],
  );
  const pastRequests = useMemo(
    () => mine.filter((r) => r.status === "rejected" || r.status === "cancelled"),
    [mine],
  );

  return (
    <div className="page page-wide">
      <div className="page-head page-head-row">
        <div>
          <h1>Leave</h1>
          <p className="sub">
            Time off — balances, requests and approvals for{" "}
            {new Date().getFullYear()}.
          </p>
        </div>
        {types !== null && types.length > 0 && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setRequesting(true)}
          >
            {Icons.plus} Request leave
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {types === null ? (
        <div className="card">
          <span className="skel" style={{ width: "70%", height: 14, marginBottom: 10 }} />
          <span className="skel" style={{ width: "50%", height: 14 }} />
        </div>
      ) : types.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.calendar}</span>
            <h3>No leave policy yet</h3>
            <p>
              Define your leave types — or load the standard set (Annual 21,
              Sick 14, Maternity 90, Paternity 14…).
            </p>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void addStandardTypes()}
              >
                {Icons.sparkles} Load standard leave types
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Balances */}
          <div className="lv-balances">
            {balances.map((b) => {
              const left = Math.max(0, b.entitlementDays - b.usedDays);
              return (
                <div key={b.leaveTypeId} className="card lv-balance">
                  <span className="lv-balance-name">
                    <span
                      className="dept-preset-dot"
                      style={{ background: b.leaveTypeColor }}
                    />
                    {b.leaveTypeName}
                  </span>
                  <span className="lv-balance-num">
                    {left}
                    <span className="lv-balance-total muted">
                      /{b.entitlementDays}
                    </span>
                  </span>
                  <span className="lv-balance-sub muted">
                    days left
                    {b.pendingDays > 0 ? ` · ${b.pendingDays} pending` : ""}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Approvals queue */}
          {approvals.length > 0 && (
            <>
              <h2 className="lv-section">
                Waiting for your approval
                <span className="badge badge-soft">{approvals.length}</span>
              </h2>
              <div className="card lv-list">
                {approvals.map((r) => (
                  <div key={r.id} className="lv-row">
                    <Avatar
                      name={r.userName}
                      id={r.userId}
                      avatarUrl={r.userAvatarUrl}
                      className="avatar-sm"
                    />
                    <span className="lv-row-body">
                      <span className="lv-row-name">
                        {r.userName}
                        <span
                          className="badge badge-soft"
                          style={{ color: r.leaveTypeColor }}
                        >
                          {r.leaveTypeName}
                        </span>
                      </span>
                      <span className="lv-row-sub muted">
                        {fmtRange(r.startDate, r.endDate)} · {r.days}{" "}
                        {r.days === 1 ? "day" : "days"}
                        {r.reason ? ` · ${r.reason}` : ""}
                      </span>
                    </span>
                    <span className="lv-row-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyId === r.id}
                        onClick={() => void decide(r, true)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn danger-ghost btn-sm"
                        disabled={busyId === r.id}
                        onClick={() => void decide(r, false)}
                      >
                        Reject
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* My requests */}
          <h2 className="lv-section">My requests</h2>
          {activeRequests.length === 0 && pastRequests.length === 0 ? (
            <p className="muted lv-none">
              Nothing yet — request your first leave above.
            </p>
          ) : (
            <div className="card lv-list">
              {[...activeRequests, ...pastRequests].map((r) => (
                <div key={r.id} className="lv-row">
                  <span
                    className="dept-preset-dot lv-row-dot"
                    style={{ background: r.leaveTypeColor }}
                  />
                  <span className="lv-row-body">
                    <span className="lv-row-name">
                      {r.leaveTypeName}
                      <span className={`badge lv-st-${r.status}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </span>
                    <span className="lv-row-sub muted">
                      {fmtRange(r.startDate, r.endDate)} · {r.days}{" "}
                      {r.days === 1 ? "day" : "days"}
                      {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                    </span>
                  </span>
                  {(r.status === "pending" ||
                    (r.status === "approved" && r.startDate >= new Date().toISOString().slice(0, 10))) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === r.id}
                      onClick={() => void cancel(r)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Who's away */}
          <h2 className="lv-section">Who&apos;s away — next 30 days</h2>
          {away.length === 0 ? (
            <p className="muted lv-none">Everyone&apos;s in.</p>
          ) : (
            <div className="card lv-list">
              {away.map((r) => (
                <div key={r.id} className="lv-row">
                  <Avatar
                    name={r.userName}
                    id={r.userId}
                    avatarUrl={r.userAvatarUrl}
                    className="avatar-sm"
                  />
                  <span className="lv-row-body">
                    <span className="lv-row-name">
                      {r.userName}
                      <span
                        className="badge badge-soft"
                        style={{ color: r.leaveTypeColor }}
                      >
                        {r.leaveTypeName}
                      </span>
                    </span>
                    <span className="lv-row-sub muted">
                      {fmtRange(r.startDate, r.endDate)} · {r.days}{" "}
                      {r.days === 1 ? "day" : "days"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Policy (admin) */}
          {isAdmin && (
            <>
              <h2 className="lv-section">Leave policy</h2>
              <div className="card lv-list">
                {types.map((t) => (
                  <div key={t.id} className="lv-row">
                    <span
                      className="dept-preset-dot lv-row-dot"
                      style={{ background: t.color }}
                    />
                    <span className="lv-row-body">
                      <span className="lv-row-name">{t.name}</span>
                      <span className="lv-row-sub muted">
                        {t.daysPerYear} days / year
                      </span>
                    </span>
                    <span className="lv-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => editType(t)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="icon-btn share-remove"
                        aria-label={`Delete ${t.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete “${t.name}”? Its requests are removed too.`,
                            )
                          ) {
                            void leaveApi.removeType(t.id).then(load);
                          }
                        }}
                      >
                        {Icons.close}
                      </button>
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm lv-add-type"
                  onClick={() => {
                    const name = window.prompt("New leave type name", "");
                    if (!name?.trim()) return;
                    const days = Number(
                      window.prompt("Days per year", "21") ?? "21",
                    );
                    void leaveApi
                      .createType({ name: name.trim(), daysPerYear: days })
                      .then(load)
                      .catch((err) =>
                        setError(
                          err instanceof ApiError
                            ? err.message
                            : "Couldn't create the type.",
                        ),
                      );
                  }}
                >
                  {Icons.plus} Add leave type
                </button>
              </div>
            </>
          )}
        </>
      )}

      {requesting && types && (
        <RequestModal
          types={types}
          onClose={() => setRequesting(false)}
          onCreated={() => {
            setRequesting(false);
            load();
          }}
        />
      )}
    </div>
  );
}
