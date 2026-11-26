"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  hierarchyApi,
  type Folder,
  type List,
  type Space,
  type SpaceTree,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { showToast } from "@/lib/toast";

interface ArchivedItems {
  spaces: Space[];
  folders: (Folder & { spaceName: string })[];
  lists: (List & { spaceName: string; folderName: string | null })[];
}

function spaceCounts(s: SpaceTree): { folders: number; lists: number } {
  const folderLists = s.folders.reduce((n, f) => n + f.lists.length, 0);
  return { folders: s.folders.length, lists: s.lists.length + folderLists };
}

export default function EverythingPage() {
  const { tree, loading, error, reload } = useHierarchy();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const createSpace = async (): Promise<void> => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await hierarchyApi.createSpace({ name: n });
      setName("");
      setCreating(false);
      await reload();
    } catch (err) {
      // There was no catch at all here, so a rejected create became an
      // unhandled rejection and the user saw nothing happen.
      showToast(
        err instanceof ApiError ? err.message : "Couldn't create that Space.",
      );
    } finally {
      setBusy(false);
    }
  };

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
          <button className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setName(""); }}>
            Cancel
          </button>
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
                    {s.icon ?? Icons.spaces}
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
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <ArchivedSection onRestored={reload} />
    </div>
  );
}

/**
 * Archived Spaces, Folders and Lists, with a way back.
 *
 * Archiving used to be a one-way door: every read path filters
 * `archived = false` and nothing in the app ever sent `archived: false`, so an
 * archived Space — and all its folders, lists and tasks — simply disappeared
 * with no view to find it in and no control to restore it.
 */
function ArchivedSection({ onRestored }: { onRestored: () => Promise<void> }) {
  const [data, setData] = useState<ArchivedItems | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = (): void => {
    hierarchyApi
      .archived()
      .then(setData)
      .catch(() => setData({ spaces: [], folders: [], lists: [] }));
  };
  useEffect(load, []);

  const total =
    (data?.spaces.length ?? 0) +
    (data?.folders.length ?? 0) +
    (data?.lists.length ?? 0);
  if (!data || total === 0) return null;

  const restore = async (
    kind: "space" | "folder" | "list",
    id: string,
    name: string,
  ): Promise<void> => {
    setBusyId(id);
    try {
      if (kind === "space") await hierarchyApi.updateSpace(id, { archived: false });
      else if (kind === "folder")
        await hierarchyApi.updateFolder(id, { archived: false });
      else await hierarchyApi.updateList(id, { archived: false });
      load();
      await onRestored();
      showToast(`Restored “${name}”`);
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : `Couldn't restore “${name}”.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="ev-archived">
      <button
        type="button"
        className="ev-archived-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`tree-caret${open ? " open" : ""}`}>
          {Icons.chevronRight}
        </span>
        {Icons.archive}
        <span>Archived</span>
        <span className="badge badge-soft">{total}</span>
      </button>

      {open && (
        <div className="ev-archived-body">
          {data.spaces.map((s) => (
            <div key={s.id} className="ev-archived-row">
              <span className="ev-archived-ic">{Icons.spaces}</span>
              <span className="ev-archived-name">{s.name}</span>
              <span className="ev-archived-where muted">Space</span>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={busyId === s.id}
                onClick={() => void restore("space", s.id, s.name)}
              >
                Restore
              </button>
            </div>
          ))}
          {data.folders.map((f) => (
            <div key={f.id} className="ev-archived-row">
              <span className="ev-archived-ic">{Icons.folder}</span>
              <span className="ev-archived-name">{f.name}</span>
              <span className="ev-archived-where muted">
                Folder in {f.spaceName}
              </span>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={busyId === f.id}
                onClick={() => void restore("folder", f.id, f.name)}
              >
                Restore
              </button>
            </div>
          ))}
          {data.lists.map((l) => (
            <div key={l.id} className="ev-archived-row">
              <span className="ev-archived-ic">{Icons.list}</span>
              <span className="ev-archived-name">{l.name}</span>
              <span className="ev-archived-where muted">
                List in {l.folderName ? `${l.spaceName} / ${l.folderName}` : l.spaceName}
              </span>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={busyId === l.id}
                onClick={() => void restore("list", l.id, l.name)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
