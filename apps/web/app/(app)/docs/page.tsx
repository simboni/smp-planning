"use client";

/**
 * Module 7 — Docs home: every doc you can see, plus creation.
 *
 * Cards show the doc's emoji, name, where it lives (space chip /
 * Workspace / Private), page count and a relative "updated" time.
 * "New Doc" opens a small modal: name, emoji from a preset row, an
 * optional Space (from the shared hierarchy) and a Private toggle
 * that only applies when the doc stays unattached.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, docsApi, permissionAtLeast, type Doc } from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { DOC_EMOJI, timeAgo } from "@/lib/format";

function NewDocModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (doc: Doc) => void;
}) {
  const { tree } = useHierarchy();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(DOC_EMOJI[0]);
  const [spaceId, setSpaceId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const spaces = tree.filter((s) => permissionAtLeast(s.myPermission, "edit"));

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await docsApi.create({
        name: trimmed,
        icon,
        spaceId: spaceId || null,
        isPrivate: spaceId ? false : isPrivate,
      });
      onCreated(r.doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the doc.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.docs}</span>
            <div>
              <h2>New Doc</h2>
              <p className="muted share-sub">A home for specs, wikis and long-form thinking.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="doc-name">Name</label>
            <input
              id="doc-name"
              className="input"
              placeholder="e.g. Engineering Wiki"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          <div className="field">
            <span className="label">Icon</span>
            <div className="emoji-row">
              {DOC_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`emoji-opt${icon === e ? " active" : ""}`}
                  onClick={() => setIcon(e)}
                  aria-label={`Icon ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="doc-space">Location</label>
            <select
              id="doc-space"
              className="input"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              <option value="">Workspace (no space)</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon ? `${s.icon} ` : ""}{s.name}
                </option>
              ))}
            </select>
          </div>

          {!spaceId && (
            <button
              type="button"
              className={`doc-priv-toggle${isPrivate ? " on" : ""}`}
              onClick={() => setIsPrivate((v) => !v)}
            >
              <span className="doc-priv-ic">{Icons.lock}</span>
              <span className="doc-priv-text">
                <span className="doc-priv-title">Private</span>
                <span className="doc-priv-sub">Only you can see this doc.</span>
              </span>
              <span className={`switch${isPrivate ? " on" : ""}`} aria-hidden="true" />
            </button>
          )}

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
              {busy ? "Creating…" : "Create Doc"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DocsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    docsApi
      .list()
      .then((r) => setDocs(r.docs ?? []))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load your docs.");
        setDocs([]);
      });
  }, []);

  const sorted = useMemo(
    () =>
      [...(docs ?? [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [docs],
  );

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Docs</h1>
          <p className="sub">Wikis, specs and notes — living next to the work.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          {Icons.plus}
          New Doc
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {docs === null ? (
        <div className="docs-grid">
          <span className="skel" style={{ height: 128, borderRadius: 14 }} />
          <span className="skel" style={{ height: 128, borderRadius: 14 }} />
          <span className="skel" style={{ height: 128, borderRadius: 14 }} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.docs}</span>
          <h3>No docs yet</h3>
          <p>Start a wiki for your team or a private scratch doc for yourself.</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {Icons.plus}
            Create your first doc
          </button>
        </div>
      ) : (
        <div className="docs-grid">
          {sorted.map((d) => (
            <Link key={d.id} href={`/doc?id=${d.id}`} className="doc-card card-hover">
              <span className="doc-card-ic" aria-hidden="true">{d.icon || "📄"}</span>
              <span className="doc-card-name">{d.name}</span>
              <span className="doc-card-meta">
                {d.spaceId ? (
                  <span className="doc-chip doc-chip-space">{d.spaceName ?? "Space"}</span>
                ) : d.isPrivate ? (
                  <span className="doc-chip doc-chip-private">{Icons.lock} Private</span>
                ) : (
                  <span className="doc-chip">{Icons.globe} Workspace</span>
                )}
                <span className="doc-card-sub">
                  {d.pageCount} {d.pageCount === 1 ? "page" : "pages"} · {timeAgo(d.updatedAt)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <NewDocModal
          onClose={() => setCreating(false)}
          onCreated={(doc) => router.push(`/doc?id=${doc.id}`)}
        />
      )}
    </div>
  );
}
