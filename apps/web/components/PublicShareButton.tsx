"use client";

/**
 * Module 26 — a "Share" button for entity headers (space / folder / list /
 * task / doc / dashboard). Opens a small popover to create, copy or revoke a
 * PUBLIC link that anyone can open read-only — even people without a StackUp
 * account. Mirrors the FavoriteStar placement.
 */

import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  sharesApi,
  shareUrl,
  type ShareEntityType,
  type ShareSummary,
} from "@/lib/api";
import { Icons } from "@/components/icons";

export function PublicShareButton({
  type,
  id,
  className = "",
}: {
  type: ShareEntityType;
  id: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<ShareSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load the current link the first time the popover opens.
  useEffect(() => {
    if (!open || loaded) return;
    sharesApi
      .forEntity(type, id)
      .then((r) => setShare(r.share))
      .catch(() => setShare(null))
      .finally(() => setLoaded(true));
  }, [open, loaded, type, id]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const url = share ? shareUrl(share.token) : "";

  const createLink = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await sharesApi.create(type, id, "view");
      setShare(r.share);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn't create the link. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the input is selectable as a fallback */
    }
  };

  const revoke = async () => {
    if (!share) return;
    setBusy(true);
    try {
      await sharesApi.revoke(share.id);
      setShare(null);
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pshare-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`btn btn-soft btn-sm ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {Icons.share} Share
      </button>
      {open && (
        <div className="pshare-pop" role="dialog" aria-label="Share publicly">
          <div className="pshare-head">
            <span className="pshare-ic">{Icons.globe}</span>
            <div>
              <div className="pshare-title">Public link</div>
              <div className="pshare-sub">
                Anyone with the link can view this — no account needed.
              </div>
            </div>
          </div>

          {!loaded ? (
            <div className="pshare-body muted">Loading…</div>
          ) : share ? (
            <div className="pshare-body">
              <div className="pshare-linkrow">
                <input
                  className="input pshare-input"
                  value={url}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={copy}
                >
                  {copied ? Icons.check : Icons.copy}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button
                type="button"
                className="pshare-revoke"
                onClick={revoke}
                disabled={busy}
              >
                {Icons.trash} Stop sharing
              </button>
            </div>
          ) : (
            <div className="pshare-body">
              {error && <div className="form-error" style={{ marginBottom: 8 }}>{error}</div>}
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={createLink}
                disabled={busy}
              >
                {busy ? <span className="spinner" /> : <>{Icons.link} Create public link</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
