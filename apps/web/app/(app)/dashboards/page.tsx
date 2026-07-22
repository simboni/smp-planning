"use client";

/**
 * Module 10 — Dashboards home. Every dashboard as a card (name, card
 * count, last updated) plus a "New Dashboard" modal. Clicking a card
 * opens the canvas at /dashboard-view?id=<id> (/dashboard is Home).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  dashboardsApi,
  type DashboardSummary,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";

function NewDashboardModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (d: DashboardSummary) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await dashboardsApi.create({ name: trimmed });
      onCreated(r.dashboard);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the dashboard.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New dashboard"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.dashboards}</span>
            <div>
              <h2>New Dashboard</h2>
              <p className="muted share-sub">Name it — then add chart cards to taste.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="field">
            <label className="label" htmlFor="db-name">Name</label>
            <input
              id="db-name"
              className="input"
              placeholder="e.g. Engineering Weekly"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
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
              disabled={!name.trim() || busy}
              onClick={() => void submit()}
            >
              {busy ? "Creating…" : "Create Dashboard"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardsPage() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<DashboardSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    dashboardsApi
      .list()
      .then((r) => setDashboards(r.dashboards ?? []))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load dashboards.");
        setDashboards([]);
      });
  }, []);

  const loading = dashboards === null;

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Dashboards</h1>
          <p className="sub">Your work, charted — build a wall of signal.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          {Icons.plus}
          New Dashboard
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <div className="db-grid">
          <span className="skel" style={{ height: 116, borderRadius: 14 }} />
          <span className="skel" style={{ height: 116, borderRadius: 14 }} />
          <span className="skel" style={{ height: 116, borderRadius: 14 }} />
        </div>
      ) : dashboards.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.dashboards}</span>
          <h3>No dashboards yet</h3>
          <p>
            A dashboard is a wall of live charts — status donuts, burndowns,
            workload bars — built from your tasks.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {Icons.plus}
            Create your first dashboard
          </button>
        </div>
      ) : (
        <div className="db-grid">
          {dashboards.map((d) => (
            <Link key={d.id} href={`/dashboard-view?id=${d.id}`} className="db-card card-hover">
              <span className="db-card-ic">{Icons.dashboards}</span>
              <span className="db-card-name">{d.name}</span>
              <span className="db-card-sub">
                {d.cardCount} {d.cardCount === 1 ? "card" : "cards"}
                {d.updatedAt && <> · updated {timeAgo(d.updatedAt)}</>}
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <NewDashboardModal
          onClose={() => setCreating(false)}
          onCreated={(d) => router.push(`/dashboard-view?id=${d.id}`)}
        />
      )}
    </div>
  );
}
