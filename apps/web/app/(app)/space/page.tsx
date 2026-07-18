"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  hierarchyApi,
  type FolderWithLists,
  type List,
  type Space,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";

function ListRow({ list }: { list: List }) {
  const dot = list.color || colorFor(list.id);
  return (
    <Link href={`/list?id=${list.id}`} className="sp-list">
      <span className="sp-list-dot" style={{ background: dot }} />
      <span className="sp-list-name">{list.name}</span>
      <span className="sp-list-arrow">{Icons.chevronRight}</span>
    </Link>
  );
}

function SpaceView() {
  const search = useSearchParams();
  const id = search.get("id");
  const { reload } = useHierarchy();

  const [space, setSpace] = useState<Space | null>(null);
  const [folders, setFolders] = useState<FolderWithLists[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<null | "folder" | "list">(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    if (!id) return;
    setLoading(true);
    hierarchyApi
      .getSpace(id)
      .then((r) => {
        setSpace(r.space);
        setFolders(r.folders ?? []);
        setLists(r.lists ?? []);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this space."),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const submit = async (): Promise<void> => {
    const name = draft.trim();
    if (!id || !name || busy) {
      setAdding(null);
      setDraft("");
      return;
    }
    setBusy(true);
    try {
      if (adding === "folder") await hierarchyApi.createFolder(id, { name });
      else await hierarchyApi.createList(id, { name, folderId: null });
      setDraft("");
      setAdding(null);
      load();
      void reload();
    } catch {
      /* keep the input open so the user can retry */
    } finally {
      setBusy(false);
    }
  };

  if (!id) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.spaces}</span>
          <h3>No space selected</h3>
          <p>Pick a space from the sidebar to see its contents.</p>
          <Link href="/everything" className="btn btn-soft">Browse spaces</Link>
        </div>
      </div>
    );
  }

  if (loading && !space) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 220, height: 32, marginBottom: 18 }} />
        <span className="skel" style={{ width: "100%", height: 60, marginBottom: 10 }} />
        <span className="skel" style={{ width: "100%", height: 60 }} />
      </div>
    );
  }

  if (error || !space) {
    return (
      <div className="page">
        <div className="form-error">{error || "Space not found."}</div>
        <Link href="/everything" className="btn btn-soft">Back to Everything</Link>
      </div>
    );
  }

  const color = space.color || colorFor(space.id);
  const totalLists = lists.length + folders.reduce((n, f) => n + f.lists.length, 0);

  return (
    <div className="page">
      <div className="sp-head">
        <span className="sp-icon" style={{ background: color }}>
          {space.icon ?? Icons.spaces}
        </span>
        <div className="sp-head-body">
          <h1 style={{ color }}>{space.name}</h1>
          <div className="sp-head-meta">
            {space.isPrivate && (
              <span className="badge sp-private">{Icons.lock} Private</span>
            )}
            <span className="muted">
              {folders.length} {folders.length === 1 ? "folder" : "folders"} · {totalLists}{" "}
              {totalLists === 1 ? "list" : "lists"}
            </span>
          </div>
        </div>
        <div className="sp-head-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => { setAdding("folder"); setDraft(""); }}>
            {Icons.folder} Add folder
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setAdding("list"); setDraft(""); }}>
            {Icons.plus} Add list
          </button>
        </div>
      </div>

      {adding && (
        <div className="card sp-add-card">
          <input
            autoFocus
            className="input"
            placeholder={adding === "folder" ? "New folder name" : "New list name"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              else if (e.key === "Escape") { setAdding(null); setDraft(""); }
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy}>
            Create
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(null); setDraft(""); }}>
            Cancel
          </button>
        </div>
      )}

      {/* Folders */}
      {folders.map((f) => (
        <div key={f.id} className="sp-group">
          <div className="sp-group-head">
            <span className="sp-group-ic">{Icons.folder}</span>
            <h3>{f.name}</h3>
            <span className="badge badge-soft">{f.lists.length}</span>
          </div>
          {f.lists.length === 0 ? (
            <div className="sp-group-empty">No lists in this folder yet.</div>
          ) : (
            <div className="sp-lists">
              {f.lists.map((l) => (
                <ListRow key={l.id} list={l} />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Folderless lists */}
      {lists.length > 0 && (
        <div className="sp-group">
          {folders.length > 0 && (
            <div className="sp-group-head">
              <span className="sp-group-ic">{Icons.list}</span>
              <h3>Lists</h3>
              <span className="badge badge-soft">{lists.length}</span>
            </div>
          )}
          <div className="sp-lists">
            {lists.map((l) => (
              <ListRow key={l.id} list={l} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {folders.length === 0 && lists.length === 0 && !adding && (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.list}</span>
            <h3>Nothing here yet</h3>
            <p>Create your first list (or a folder to group lists) to get going.</p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => { setAdding("list"); setDraft(""); }}>
                {Icons.plus} Add a list
              </button>
              <button className="btn btn-ghost" onClick={() => { setAdding("folder"); setDraft(""); }}>
                {Icons.folder} Add a folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SpacePage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 220, height: 32 }} />
        </div>
      }
    >
      <SpaceView />
    </Suspense>
  );
}
