"use client";

/**
 * Module 12 — the visual hub: every whiteboard and mind map you can see.
 *
 * Two card grids (Whiteboards / Mind maps) with a shared create modal:
 * name + an optional Space attachment from the hierarchy. Cards show
 * where the board lives, an element/node count and "updated ago".
 * Clicking opens `/whiteboard?id=` or `/mindmap?id=`.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  mindmapsApi,
  permissionAtLeast,
  whiteboardsApi,
  type MindmapSummary,
  type WhiteboardSummary,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";

type VisualKind = "whiteboard" | "mindmap";

function NewVisualModal({
  kind,
  onClose,
  onCreated,
}: {
  kind: VisualKind;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { tree } = useHierarchy();
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const spaces = tree.filter((s) => permissionAtLeast(s.myPermission, "edit"));
  const isBoard = kind === "whiteboard";

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = { name: trimmed, spaceId: spaceId || null };
      const id = isBoard
        ? (await whiteboardsApi.create(body)).whiteboard.id
        : (await mindmapsApi.create(body)).mindmap.id;
      onCreated(id);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Couldn't create the ${isBoard ? "whiteboard" : "mind map"}.`,
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">
              {isBoard ? Icons.whiteboard : Icons.mindmap}
            </span>
            <div>
              <h2>{isBoard ? "New whiteboard" : "New mind map"}</h2>
              <p className="muted share-sub">
                {isBoard
                  ? "A freeform canvas for sticky notes, shapes and arrows."
                  : "Branch ideas out from a central topic — turn them into tasks."}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="viz-name">Name</label>
            <input
              id="viz-name"
              className="input"
              placeholder={isBoard ? "e.g. Launch brainstorm" : "e.g. Q3 roadmap ideas"}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="viz-space">Location</label>
            <select
              id="viz-space"
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
              {busy ? "Creating…" : isBoard ? "Create whiteboard" : "Create mind map"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpaceChip({ spaceId, spaceName }: { spaceId: string | null; spaceName: string | null }) {
  return spaceId ? (
    <span className="doc-chip doc-chip-space">{spaceName ?? "Space"}</span>
  ) : (
    <span className="doc-chip">{Icons.globe} Workspace</span>
  );
}

export default function WhiteboardsHubPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<WhiteboardSummary[] | null>(null);
  const [maps, setMaps] = useState<MindmapSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<VisualKind | null>(null);

  const load = (): void => {
    whiteboardsApi
      .list()
      .then((r) =>
        setBoards(
          [...r.whiteboards].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          ),
        ),
      )
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load your whiteboards.");
        setBoards([]);
      });
    mindmapsApi
      .list()
      .then((r) =>
        setMaps(
          [...r.mindmaps].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          ),
        ),
      )
      .catch(() => setMaps([]));
  };

  useEffect(load, []);

  useRealtime((e) => {
    if (e.type === "board.changed" || e.type === "mindmap.changed") load();
  }, []);

  const skeleton = (
    <div className="viz-grid">
      <span className="skel" style={{ height: 116, borderRadius: 14 }} />
      <span className="skel" style={{ height: 116, borderRadius: 14 }} />
      <span className="skel" style={{ height: 116, borderRadius: 14 }} />
    </div>
  );

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Whiteboards</h1>
          <p className="sub">Sketch it out — canvases and mind maps beside the work.</p>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* -------- whiteboards -------- */}
      <div className="viz-section-head">
        <span className="viz-section-ic">{Icons.whiteboard}</span>
        <h2>Whiteboards</h2>
        <span className="viz-section-spacer" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setCreating("whiteboard")}
        >
          {Icons.plus}
          New whiteboard
        </button>
      </div>

      {boards === null ? (
        skeleton
      ) : boards.length === 0 ? (
        <div className="viz-empty">
          <span className="viz-empty-ic">{Icons.pen}</span>
          <p>No whiteboards yet — open a blank canvas and think out loud.</p>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => setCreating("whiteboard")}
          >
            {Icons.plus} Create your first whiteboard
          </button>
        </div>
      ) : (
        <div className="viz-grid">
          {boards.map((b) => (
            <Link key={b.id} href={`/whiteboard?id=${b.id}`} className="viz-card card-hover">
              <span className="viz-card-ic viz-card-ic-board">{Icons.whiteboard}</span>
              <span className="viz-card-name">{b.name}</span>
              <span className="viz-card-meta">
                <SpaceChip spaceId={b.spaceId} spaceName={b.spaceName} />
                <span className="viz-card-sub">
                  {b.elementCount} {b.elementCount === 1 ? "element" : "elements"} ·{" "}
                  {timeAgo(b.updatedAt)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* -------- mind maps -------- */}
      <div className="viz-section-head">
        <span className="viz-section-ic">{Icons.mindmap}</span>
        <h2>Mind maps</h2>
        <span className="viz-section-spacer" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setCreating("mindmap")}
        >
          {Icons.plus}
          New mind map
        </button>
      </div>

      {maps === null ? (
        skeleton
      ) : maps.length === 0 ? (
        <div className="viz-empty">
          <span className="viz-empty-ic">{Icons.branch}</span>
          <p>No mind maps yet — start with one idea and let it branch.</p>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => setCreating("mindmap")}
          >
            {Icons.plus} Create your first mind map
          </button>
        </div>
      ) : (
        <div className="viz-grid">
          {maps.map((m) => (
            <Link key={m.id} href={`/mindmap?id=${m.id}`} className="viz-card card-hover">
              <span className="viz-card-ic viz-card-ic-map">{Icons.mindmap}</span>
              <span className="viz-card-name">{m.name}</span>
              <span className="viz-card-meta">
                <SpaceChip spaceId={m.spaceId} spaceName={m.spaceName} />
                <span className="viz-card-sub">
                  {typeof m.nodeCount === "number"
                    ? `${m.nodeCount} ${m.nodeCount === 1 ? "node" : "nodes"} · `
                    : ""}
                  {timeAgo(m.updatedAt)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <NewVisualModal
          kind={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) =>
            router.push(creating === "whiteboard" ? `/whiteboard?id=${id}` : `/mindmap?id=${id}`)
          }
        />
      )}
    </div>
  );
}
