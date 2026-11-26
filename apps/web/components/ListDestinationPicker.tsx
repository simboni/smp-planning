"use client";

/**
 * Pick a List to put something in — a note becoming a task, a task being
 * moved, a quick-add with no obvious home.
 *
 * Every Space the caller can edit is offered, including empty ones (the old
 * note picker silently dropped any Space without Lists, so a new Space never
 * appeared and there was no way to make a List from there). Inside a Space,
 * Lists are shown under their folders. A List — or a whole new Space — can be
 * created inline, and the new List is picked straight away.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  hierarchyApi,
  permissionAtLeast,
  type List,
  type SpaceTree,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";

export interface PickedList {
  list: Pick<List, "id" | "name" | "spaceId">;
  spaceName: string;
}

export function ListDestinationPicker({
  title,
  subtitle,
  actionLabel = "Choose",
  currentListId,
  busy = false,
  onPick,
  onClose,
}: {
  title: string;
  subtitle?: string;
  /** Verb on each List row, e.g. "Move here". */
  actionLabel?: string;
  /** The List the item is already in (marked, not pickable). */
  currentListId?: string | null;
  busy?: boolean;
  onPick: (picked: PickedList) => void;
  onClose: () => void;
}) {
  const { tree, reload } = useHierarchy();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<"space" | "list" | null>(null);
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const spaces: SpaceTree[] = useMemo(
    () => tree.filter((s) => !s.archived && permissionAtLeast(s.myPermission, "edit")),
    [tree],
  );
  const space = spaces.find((s) => s.id === spaceId) ?? null;
  const listCount = (s: SpaceTree): number =>
    s.lists.length + s.folders.reduce((n, f) => n + f.lists.length, 0);

  // Searching shows matching Lists from every Space at once.
  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!q) return [];
    const out: { list: List; space: SpaceTree; folder: string | null }[] = [];
    for (const s of spaces) {
      for (const l of s.lists) if (l.name.toLowerCase().includes(q)) out.push({ list: l, space: s, folder: null });
      for (const f of s.folders)
        for (const l of f.lists)
          if (l.name.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
            out.push({ list: l, space: s, folder: f.name });
    }
    return out.slice(0, 30);
  }, [q, spaces]);

  const pick = (list: List, s: SpaceTree): void => {
    if (busy || list.id === currentListId) return;
    onPick({ list: { id: list.id, name: list.name, spaceId: s.id }, spaceName: s.name });
  };

  const create = async (): Promise<void> => {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    setError("");
    try {
      if (creating === "space") {
        const r = await hierarchyApi.createSpace({ name: n });
        await reload();
        setSpaceId(r.space.id);
        setCreating("list"); // a new Space is empty: go straight to naming its first List
        setName("");
      } else if (creating === "list" && space) {
        const r = await hierarchyApi.createList(space.id, { name: n, folderId: folderId || null });
        await reload();
        setCreating(null);
        setName("");
        onPick({ list: { id: r.list.id, name: r.list.name, spaceId: space.id }, spaceName: space.name });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const listRow = (l: List, s: SpaceTree, folder: string | null, showSpace = false) => {
    const here = l.id === currentListId;
    return (
      <button
        key={l.id}
        type="button"
        className={`ldp-row${here ? " here" : ""}`}
        disabled={busy || here}
        onClick={() => pick(l, s)}
      >
        <span className="ldp-dot" style={{ background: l.color || "var(--brand)" }} />
        <span className="ldp-name">
          {l.name}
          {(showSpace || folder) && (
            <span className="ldp-path">
              {showSpace ? s.name : ""}
              {showSpace && folder ? " › " : ""}
              {folder ?? ""}
            </span>
          )}
        </span>
        <span className="ldp-act">{here ? "Current" : actionLabel}</span>
      </button>
    );
  };

  const createForm = (
    <div className="ldp-create">
      <input
        ref={inputRef}
        className="input"
        placeholder={creating === "space" ? "New Space name" : "New List name"}
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") {
            e.stopPropagation();
            setCreating(null);
          }
        }}
      />
      {creating === "list" && space && space.folders.length > 0 && (
        <select className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Folder">
          <option value="">No folder</option>
          {space.folders.map((f) => (
            <option key={f.id} value={f.id}>
              In folder: {f.name}
            </option>
          ))}
        </select>
      )}
      <div className="ldp-create-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(null)} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void create()} disabled={!name.trim() || saving}>
          {saving ? <span className="spinner" /> : creating === "space" ? "Create Space" : `Create & ${actionLabel.toLowerCase()}`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="modal-scrim ldp-scrim" onClick={onClose}>
      <div className="modal ldp" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.list}</span>
            <div>
              <h2>{title}</h2>
              {subtitle && <p className="muted share-sub">{subtitle}</p>}
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          <input
            className="input ldp-search"
            placeholder="Search lists…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}

          {q ? (
            <div className="ldp-list">
              {hits.length === 0 ? (
                <p className="ldp-empty">No list called “{query.trim()}”. Clear the search to create one.</p>
              ) : (
                hits.map((h) => listRow(h.list, h.space, h.folder, true))
              )}
            </div>
          ) : !space ? (
            <div className="ldp-list">
              <div className="ldp-label">Spaces</div>
              {spaces.length === 0 && <p className="ldp-empty">You have no Spaces you can add to yet.</p>}
              {spaces.map((s) => (
                <button key={s.id} type="button" className="ldp-row" onClick={() => { setSpaceId(s.id); setCreating(null); }}>
                  <span className="ldp-sq" style={{ background: s.color || "var(--brand)" }}>
                    {(s.icon || s.name.charAt(0)).toUpperCase()}
                  </span>
                  <span className="ldp-name">
                    {s.name}
                    <span className="ldp-path">
                      {listCount(s) === 0 ? "No lists yet" : `${listCount(s)} list${listCount(s) === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="ldp-chev">{Icons.chevronRight}</span>
                </button>
              ))}
              {creating === "space" ? (
                createForm
              ) : (
                <button type="button" className="ldp-new" onClick={() => { setCreating("space"); setName(""); setError(""); }}>
                  {Icons.plus} New Space
                </button>
              )}
            </div>
          ) : (
            <div className="ldp-list">
              <button type="button" className="ldp-back" onClick={() => { setSpaceId(null); setCreating(null); }}>
                {Icons.chevronLeft} All Spaces
              </button>
              <div className="ldp-label">{space.name}</div>
              {listCount(space) === 0 && creating !== "list" && (
                <p className="ldp-empty">This Space has no lists yet. Create one below.</p>
              )}
              {space.lists.map((l) => listRow(l, space, null))}
              {space.folders.map((f) =>
                f.lists.length ? (
                  <div key={f.id}>
                    <div className="ldp-folder">{Icons.folder} {f.name}</div>
                    {f.lists.map((l) => listRow(l, space, null))}
                  </div>
                ) : null,
              )}
              {creating === "list" ? (
                createForm
              ) : (
                <button type="button" className="ldp-new" onClick={() => { setCreating("list"); setName(""); setFolderId(""); setError(""); }}>
                  {Icons.plus} New List in {space.name}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
