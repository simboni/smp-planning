"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  governanceApi,
  type AuditEvent,
  type AuditIntegrity,
} from "@/lib/api";
import { Icons } from "@/components/icons";

/** Turn "space.created" / "role.assign" into a human phrase. */
function describe(e: AuditEvent): string {
  const who = e.actorName || e.actorEmail || "Someone";
  const name =
    (e.data && typeof e.data.name === "string" && e.data.name) || null;
  const verb = e.action.split(".").slice(1).join(" ") || e.action;
  const subject = name ? ` “${name}”` : "";
  return `${who} — ${verb} ${e.entity}${subject}`;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [denied, setDenied] = useState(false);
  const [integrity, setIntegrity] = useState<AuditIntegrity | null>(null);
  const [entityFilter, setEntityFilter] = useState("");

  const load = (reset: boolean) => {
    governanceApi
      .listAudit({
        cursor: reset ? undefined : cursor ?? undefined,
        entity: entityFilter || undefined,
        limit: 50,
      })
      .then((r) => {
        setEvents((prev) => (reset || !prev ? r.events : [...prev, ...r.events]));
        setCursor(r.nextCursor);
      })
      .catch((e: unknown) => {
        if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 403) {
          setDenied(true);
        }
        setEvents([]);
      })
      .finally(() => setLoadingMore(false));
  };

  useEffect(() => {
    load(true);
    governanceApi.verifyAudit().then(setIntegrity).catch(() => setIntegrity(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter]);

  if (denied) {
    return (
      <div className="page">
        <SettingsBack />
        <div className="page-head">
          <h1>Audit log</h1>
        </div>
        <div className="notice">
          {Icons.info}
          You do not have permission to view the audit log. Ask an admin for the
          “View the audit log” capability.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <SettingsBack />
      <div className="page-head">
        <h1>Audit log</h1>
        <p className="sub">
          An append-only, tamper-evident record of who changed what in this
          workspace.
        </p>
      </div>

      <div className="audit-toolbar">
        {integrity && (
          <span
            className={`integrity-badge ${integrity.ok ? "ok" : "bad"}`}
            title={
              integrity.ok
                ? `Hash chain verified across ${integrity.checked} entries`
                : `Chain broken at entry ${integrity.brokenAt}`
            }
          >
            <span className="dot" />
            {integrity.ok
              ? `Integrity verified · ${integrity.checked} entries`
              : "Integrity check FAILED"}
          </span>
        )}
        <select
          className="input audit-filter"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
        >
          <option value="">All activity</option>
          <option value="space">Spaces</option>
          <option value="task">Tasks</option>
          <option value="custom_role">Custom roles</option>
          <option value="membership">Memberships</option>
          <option value="team">Teams</option>
          <option value="doc">Docs</option>
        </select>
      </div>

      <div className="card">
        {events === null ? (
          <div className="skel" style={{ height: 120 }} />
        ) : events.length === 0 ? (
          <div className="empty-hint">No activity recorded yet.</div>
        ) : (
          <ul className="audit-feed">
            {events.map((e) => (
              <li className="audit-item" key={e.id}>
                <span className={`audit-dot entity-${e.entity}`} />
                <div className="audit-body">
                  <div className="audit-desc">{describe(e)}</div>
                  <div className="audit-meta">
                    <code className="audit-action">{e.action}</code>
                    <span className="audit-time" title={new Date(e.createdAt).toLocaleString()}>
                      {timeAgo(e.createdAt)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {cursor && (
          <div className="audit-more">
            <button
              className="btn btn-ghost btn-sm"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                load(false);
              }}
            >
              {loadingMore ? <span className="spinner" /> : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsBack() {
  return (
    <Link href="/settings" className="back-link">
      {Icons.chevronRight}
      <span>Settings</span>
    </Link>
  );
}
