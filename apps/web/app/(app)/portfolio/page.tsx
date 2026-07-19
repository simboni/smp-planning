"use client";

/**
 * Module 9 — Portfolio detail: the roll-up table. `/portfolio?id=<id>`
 * (static export: query param + Suspense around useSearchParams).
 *
 * One row per list: name (links to /list?id=), space chip, a progress
 * bar with %, and total / done / in-progress counts with overdue as a
 * red badge. The ⋯ menu offers rename, recolor, manage lists, delete.
 * Task mutations anywhere refresh the roll-up via `task.changed` SSE
 * (debounced — a board full of edits shouldn't stampede the API).
 */

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  portfoliosApi,
  type Portfolio,
  type PortfolioItem,
} from "@/lib/api";
import {
  ListPicker,
  PORTFOLIO_SWATCHES,
  useFlatLists,
} from "@/components/PortfolioBits";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { clamp01, formatPercent } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * Manage-lists modal (full listIds set on submit).
 * ------------------------------------------------------------------ */
function ManageListsModal({
  portfolioName,
  currentIds,
  onClose,
  onSubmit,
}: {
  portfolioName: string;
  currentIds: string[];
  onClose: () => void;
  onSubmit: (listIds: string[]) => Promise<void>;
}) {
  const lists = useFlatLists();
  const [picked, setPicked] = useState<Set<string>>(new Set(currentIds));
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
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit([...picked]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the lists.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Manage portfolio lists"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.briefcase}</span>
            <div>
              <h2>Manage lists</h2>
              <p className="muted share-sub">Choose what rolls up into “{portfolioName}”.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <ListPicker lists={lists} picked={picked} onToggle={toggle} />
          <div className="modal-foot between">
            <span className="muted tp-count">
              {picked.size} {picked.size === 1 ? "list" : "lists"} selected
            </span>
            <div className="tp-foot-btns">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? "Saving…" : "Save lists"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The portfolio view.
 * ------------------------------------------------------------------ */
function PortfolioView() {
  const router = useRouter();
  const portfolioId = useSearchParams().get("id") ?? "";

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [items, setItems] = useState<PortfolioItem[] | null>(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [recoloring, setRecoloring] = useState(false);
  const [managing, setManaging] = useState(false);

  const load = (): void => {
    if (!portfolioId) return;
    portfoliosApi
      .get(portfolioId)
      .then((r) => {
        setPortfolio(r.portfolio);
        setItems(r.items);
        setError("");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load this portfolio.");
      });
  };
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  // Debounced roll-up refresh when tasks change anywhere.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(
    (e) => {
      if (e.type !== "task.changed") return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => loadRef.current(), 800);
    },
    [portfolioId],
  );
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const commitRename = (): void => {
    setRenaming(false);
    if (!portfolio) return;
    const trimmed = renameVal.trim();
    if (!trimmed || trimmed === portfolio.name) return;
    portfoliosApi
      .update(portfolio.id, { name: trimmed })
      .then((r) => setPortfolio(r.portfolio))
      .catch(() => loadRef.current());
  };

  const recolor = (color: string): void => {
    setRecoloring(false);
    setMenuOpen(false);
    if (!portfolio) return;
    portfoliosApi
      .update(portfolio.id, { color })
      .then((r) => setPortfolio(r.portfolio))
      .catch(() => loadRef.current());
  };

  const remove = (): void => {
    if (!portfolio) return;
    if (!window.confirm(`Delete the portfolio “${portfolio.name}”? Lists themselves are untouched.`)) {
      return;
    }
    portfoliosApi
      .remove(portfolio.id)
      .then(() => router.push("/portfolios"))
      .catch(() => undefined);
  };

  if (!portfolioId) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.briefcase}</span>
          <h3>No portfolio selected</h3>
          <p>Pick a portfolio from the Portfolios page.</p>
          <Link href="/portfolios" className="btn btn-primary">Back to Portfolios</Link>
        </div>
      </div>
    );
  }

  if (!portfolio || items === null) {
    return (
      <div className="page">
        {error ? (
          <>
            <div className="form-error">{error}</div>
            <Link href="/portfolios" className="btn btn-ghost">
              {Icons.chevronLeft} Back to Portfolios
            </Link>
          </>
        ) : (
          <>
            <span className="skel" style={{ width: 320, height: 36, marginBottom: 20 }} />
            <span className="skel" style={{ width: "100%", height: 52, marginBottom: 8 }} />
            <span className="skel" style={{ width: "100%", height: 52 }} />
          </>
        )}
      </div>
    );
  }

  const totals = items.reduce(
    (acc, it) => ({
      total: acc.total + Number(it.stats.total || 0),
      done: acc.done + Number(it.stats.done || 0),
      inProgress: acc.inProgress + Number(it.stats.inProgress || 0),
      overdue: acc.overdue + Number(it.stats.overdue || 0),
    }),
    { total: 0, done: 0, inProgress: 0, overdue: 0 },
  );
  const overallProgress = totals.total > 0 ? totals.done / totals.total : 0;

  return (
    <div className="page pf-page">
      <div className="goal-crumb">
        <Link href="/portfolios" className="goal-back">
          {Icons.chevronLeft}
          Portfolios
        </Link>
      </div>

      <div className="page-head page-head-row pf-head">
        <div className="pf-head-main">
          <span className="pf-card-dot lg" style={{ background: portfolio.color }} aria-hidden="true" />
          {renaming ? (
            <input
              className="dp-rename pf-rename"
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
            <h1>{portfolio.name}</h1>
          )}
        </div>
        <span className="dp-menu-wrap">
          <button
            type="button"
            className="icon-btn"
            aria-label="Portfolio menu"
            onClick={(e) => {
              e.stopPropagation();
              setRecoloring(false);
              setMenuOpen((v) => !v);
            }}
          >
            {Icons.more}
          </button>
          {menuOpen && (
            <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
              {recoloring ? (
                <div className="gf-menu-swatches">
                  {PORTFOLIO_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`team-swatch${portfolio.color === c ? " sel" : ""}`}
                      style={{ background: c, color: c }}
                      aria-label={c}
                      onClick={() => recolor(c)}
                    >
                      {portfolio.color === c && Icons.check}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameVal(portfolio.name);
                      setRenaming(true);
                      setMenuOpen(false);
                    }}
                  >
                    {Icons.edit} Rename
                  </button>
                  <button type="button" onClick={() => setRecoloring(true)}>
                    {Icons.palette} Change color
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setManaging(true);
                    }}
                  >
                    {Icons.list} Manage lists
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setMenuOpen(false);
                      remove();
                    }}
                  >
                    {Icons.trash} Delete portfolio
                  </button>
                </>
              )}
            </div>
          )}
        </span>
      </div>

      {items.length > 0 && (
        <div className="pf-summary">
          <span className="pf-summary-prog">
            <span className="goal-prog-track lg">
              <span
                className={`goal-prog-fill${overallProgress >= 1 ? " full" : ""}`}
                style={{ width: `${clamp01(overallProgress) * 100}%` }}
              />
            </span>
            <span className={`goal-prog-label${overallProgress >= 1 ? " full" : ""}`}>
              {formatPercent(overallProgress)}
            </span>
          </span>
          <span className="pf-summary-counts muted">
            {totals.done} of {totals.total} tasks done · {totals.inProgress} in progress
            {totals.overdue > 0 && (
              <span className="pf-overdue-badge">{totals.overdue} overdue</span>
            )}
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.list}</span>
          <h3>Nothing rolled up yet</h3>
          <p>Add lists to this portfolio and their tasks roll up here.</p>
          <button type="button" className="btn btn-primary" onClick={() => setManaging(true)}>
            {Icons.plus}
            Add lists
          </button>
        </div>
      ) : (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th className="pf-th-list">List</th>
                <th className="pf-th-space">Space</th>
                <th className="pf-th-prog">Progress</th>
                <th className="num">Total</th>
                <th className="num">Done</th>
                <th className="num">In progress</th>
                <th className="num">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const p = clamp01(it.progress);
                return (
                  <tr key={it.listId}>
                    <td className="pf-td-list">
                      <Link href={`/list?id=${it.listId}`} className="pf-list-link">
                        <span
                          className="pf-list-dot"
                          style={{ background: it.color || "var(--brand)" }}
                          aria-hidden="true"
                        />
                        {it.listName}
                      </Link>
                    </td>
                    <td className="pf-td-space">
                      <span className="doc-chip doc-chip-space">{it.spaceName}</span>
                    </td>
                    <td className="pf-td-prog">
                      <span className="pf-row-prog">
                        <span className="goal-prog-track">
                          <span
                            className={`goal-prog-fill${p >= 1 ? " full" : ""}`}
                            style={{ width: `${p * 100}%` }}
                          />
                        </span>
                        <span className={`goal-prog-label${p >= 1 ? " full" : ""}`}>
                          {formatPercent(p)}
                        </span>
                      </span>
                    </td>
                    <td className="num">{Number(it.stats.total || 0)}</td>
                    <td className="num pf-num-done">{Number(it.stats.done || 0)}</td>
                    <td className="num">{Number(it.stats.inProgress || 0)}</td>
                    <td className="num">
                      {Number(it.stats.overdue || 0) > 0 ? (
                        <span className="pf-overdue-badge">{Number(it.stats.overdue)}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {managing && (
        <ManageListsModal
          portfolioName={portfolio.name}
          currentIds={items.map((it) => it.listId)}
          onClose={() => setManaging(false)}
          onSubmit={async (listIds) => {
            await portfoliosApi.update(portfolio.id, { listIds });
            setManaging(false);
            load();
          }}
        />
      )}
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 34 }} />
        </div>
      }
    >
      <PortfolioView />
    </Suspense>
  );
}
