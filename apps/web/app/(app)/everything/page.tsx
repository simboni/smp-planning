"use client";

import { useState } from "react";
import Link from "next/link";
import { hierarchyApi, type SpaceTree } from "@/lib/api";
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

  const createSpace = async (): Promise<void> => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await hierarchyApi.createSpace({ name: n });
      setName("");
      setCreating(false);
      await reload();
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
    </div>
  );
}
