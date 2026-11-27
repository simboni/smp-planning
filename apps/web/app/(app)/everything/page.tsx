"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, hierarchyApi, type ArchivedItems, type SpaceTree } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";

function spaceCounts(s: SpaceTree): { folders: number; lists: number } {
  const folderLists = s.folders.reduce((n, f) => n + f.lists.length, 0);
  return { folders: s.folders.length, lists: s.lists.length + folderLists };
}

export default function EverythingPage() {
  const { tree, loading, error, reload } = useHierarchy();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [archived, setArchived] = useState<ArchivedItems | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const loadArchived = useCallback((): void => {
    hierarchyApi
      .archived()
      .then(setArchived)
      .catch(() => setArchived(null));
  }, []);
  useEffect(loadArchived, [loadArchived]);

  const createSpace = async (): Promise<void> => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setCreateError("");
    try {
      await hierarchyApi.createSpace({ name: n });
      setName("");
      setCreating(false);
      await reload();
    } catch (err) {
      // Used to have no catch at all: a refusal was an unhandled rejection
      // and the button simply looked like it did nothing.
      setCreateError(err instanceof ApiError ? err.message : "Couldn't create the space. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (kind: "space" | "folder" | "list", id: string, label: string): Promise<void> => {
    try {
      if (kind === "space") await hierarchyApi.updateSpace(id, { archived: false });
      else if (kind === "folder") await hierarchyApi.updateFolder(id, { archived: false });
      else await hierarchyApi.updateList(id, { archived: false });
      showToast(`Restored “${label}”`);
      await reload();
      loadArchived();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't restore it.");
    }
  };
  const archivedCount = archived
    ? archived.spaces.length + archived.folders.length + archived.lists.length
    : 0;

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Everything</h1>
          <p className="sub">Every space in this workspace, at a glance.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          {Icons.plus} New space
        </button>
      </div>

      {creating && (
        <div className="card sp-add-card" style={{ marginBottom: 18 }}>
          <input
            autoFocus
            className="input"
            placeholder="Space name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createSpace();
              else if (e.key === "Escape") { setCreating(false); setName(""); }
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={() => void createSpace()} disabled={busy}>
            Create
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setName(""); setCreateError(""); }}>
            Cancel
          </button>
          {createError && <div className="form-error" style={{ flexBasis: "100%" }}>{createError}</div>}
        </div>
      )}

      {loading && tree.length === 0 ? (
        <div className="module-grid">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skel" style={{ width: "100%", height: 120 }} />
          ))}
        </div>
      ) : error && tree.length === 0 ? (
        <div className="form-error">{error}</div>
      ) : tree.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.spaces}</span>
            <h3>No spaces yet</h3>
            <p>Spaces are the top level of your workspace — think teams, clients, or big initiatives.</p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              {Icons.plus} Create your first space
            </button>
          </div>
        </div>
      ) : (
        <div className="ev-grid">
          {tree.map((s) => {
            const color = s.color || colorFor(s.id);
            const { folders, lists } = spaceCounts(s);
            return (
              <Link key={s.id} href={`/space?id=${s.id}`} className="ev-card card card-hover">
                <div className="ev-card-top">
                  <span className="ev-icon" style={{ background: color }}>
                    {s.icon ?? <span className="ev-initial">{s.name.trim().charAt(0).toUpperCase() || "S"}</span>}
                  </span>
                  {s.isPrivate && <span className="ev-lock" title="Private">{Icons.lock}</span>}
                </div>
                <h3 className="ev-name" style={{ color }}>{s.name}</h3>
                <div className="ev-meta muted">
                  {folders} {folders === 1 ? "folder" : "folders"} · {lists}{" "}
                  {lists === 1 ? "list" : "lists"}
                </div>
                {(s.folders.length > 0 || s.lists.length > 0) && (
                  <div className="ev-lists">
                    {[
                      ...s.lists,
                      ...s.folders.flatMap((f) => f.lists),
                    ]
                      .slice(0, 4)
                      .map((l) => (
                        <span key={l.id} className="ev-list-chip">
                          <span className="ev-list-dot" style={{ background: l.color || colorFor(l.id) }} />
                          {l.name}
                        </span>
                      ))}
                    {lists > 4 && <span className="ev-list-chip ev-list-more">+{lists - 4} more</span>}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {archivedCount > 0 && (
        <div className="ev-archived">
          <button type="button" className="ev-archived-toggle" onClick={() => setShowArchived((v) => !v)}>
            {Icons.archive} Archived ({archivedCount}) <span className={`tree-caret${showArchived ? " open" : ""}`}>{Icons.chevronRight}</span>
          </button>
          {showArchived && archived && (
            <div className="card ev-archived-list">
              {[
                ...archived.spaces.map((x) => ({ kind: "space" as const, id: x.id, name: x.name, where: "Space", can: x.canRestore })),
                ...archived.folders.map((x) => ({ kind: "folder" as const, id: x.id, name: x.name, where: `Folder in ${x.spaceName}`, can: x.canRestore })),
                ...archived.lists.map((x) => ({
                  kind: "list" as const, id: x.id, name: x.name,
                  where: `List in ${x.spaceName}${x.folderName ? ` › ${x.folderName}` : ""}`, can: x.canRestore,
                })),
              ].map((x) => (
                <div key={`${x.kind}:${x.id}`} className="ev-archived-row">
                  <span className="ev-archived-name">
                    {x.name}
                    <span className="muted">{x.where}</span>
                  </span>
                  {x.can ? (
                    <button type="button" className="btn btn-soft btn-sm" onClick={() => void restore(x.kind, x.id, x.name)}>
                      Restore
                    </button>
                  ) : (
                    <span className="muted ev-archived-ro">Ask an admin to restore</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
