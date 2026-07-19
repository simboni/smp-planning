"use client";

/**
 * Module 9 — Portfolios home: named bundles of lists whose task stats
 * roll up into one table. Cards show a color dot, name and item count;
 * "New Portfolio" picks a color and any set of visible lists (flattened
 * from the shared hierarchy with their space for context).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, portfoliosApi, type Portfolio } from "@/lib/api";
import {
  ListPicker,
  PORTFOLIO_SWATCHES,
  useFlatLists,
} from "@/components/PortfolioBits";
import { Icons } from "@/components/icons";

/* ------------------------------------------------------------------ *
 * New Portfolio modal.
 * ------------------------------------------------------------------ */
function NewPortfolioModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Portfolio) => void;
}) {
  const lists = useFlatLists();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PORTFOLIO_SWATCHES[0]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (id: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await portfoliosApi.create({
        name: trimmed,
        color,
        listIds: picked.size ? [...picked] : undefined,
      });
      onCreated(r.portfolio);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the portfolio.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New portfolio"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.briefcase}</span>
            <div>
              <h2>New Portfolio</h2>
              <p className="muted share-sub">Roll up any set of lists into one health view.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="pf-name">Name</label>
            <input
              id="pf-name"
              className="input"
              placeholder="e.g. Client work, Q3 launches"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          <div className="field">
            <span className="label">Color</span>
            <div className="team-swatches">
              {PORTFOLIO_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`team-swatch${color === c ? " sel" : ""}`}
                  style={{ background: c, color: c }}
                  aria-label={c}
                  onClick={() => setColor(c)}
                >
                  {color === c && Icons.check}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">
              Lists {picked.size > 0 && `(${picked.size})`}
            </span>
            <ListPicker lists={lists} picked={picked} onToggle={toggle} />
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
              {busy ? "Creating…" : "Create Portfolio"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page.
 * ------------------------------------------------------------------ */
export default function PortfoliosPage() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    portfoliosApi
      .list()
      .then((r) => setPortfolios(r.portfolios))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load your portfolios.");
        setPortfolios([]);
      });
  }, []);

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Portfolios</h1>
          <p className="sub">Roll-up health across any set of lists.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          {Icons.plus}
          New Portfolio
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {portfolios === null ? (
        <div className="pf-grid">
          <span className="skel" style={{ height: 104, borderRadius: 14 }} />
          <span className="skel" style={{ height: 104, borderRadius: 14 }} />
          <span className="skel" style={{ height: 104, borderRadius: 14 }} />
        </div>
      ) : portfolios.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.briefcase}</span>
          <h3>No portfolios yet</h3>
          <p>Bundle lists from anywhere into one table of progress, counts and overdue work.</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {Icons.plus}
            Create your first portfolio
          </button>
        </div>
      ) : (
        <div className="pf-grid">
          {portfolios.map((p) => (
            <Link key={p.id} href={`/portfolio?id=${p.id}`} className="pf-card card-hover">
              <span className="pf-card-dot" style={{ background: p.color }} aria-hidden="true" />
              <span className="pf-card-name">{p.name}</span>
              <span className="pf-card-sub">
                {p.itemCount} {p.itemCount === 1 ? "list" : "lists"}
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <NewPortfolioModal
          onClose={() => setCreating(false)}
          onCreated={(p) => router.push(`/portfolio?id=${p.id}`)}
        />
      )}
    </div>
  );
}
