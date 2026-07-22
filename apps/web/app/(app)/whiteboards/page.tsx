"use client";

/**
 * Module 12 — the visual hub: every whiteboard and mind map you can see.
 *
 * Start-from-a-template row + two compact card grids (Whiteboards / Mind maps)
 * with a shared create modal: name, an optional Space, and an optional link to
 * a Folder / List / Task the board belongs to. Templates seed a new board with
 * starter content. Cards show where a board lives, what it's linked to, an
 * element/node count and "updated ago".
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  mindmapsApi,
  permissionAtLeast,
  whiteboardsApi,
  type MindmapSummary,
  type WhiteboardCreate,
  type WhiteboardElement,
  type WhiteboardSummary,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import {
  WHITEBOARD_TEMPLATES,
  type WhiteboardTemplate,
} from "@/lib/whiteboard-templates";

type VisualKind = "whiteboard" | "mindmap";

/* ------------------------------------------------------------------ *
 * Create modal — name + Space + optional Folder/List link. When a
 * template is passed, its elements seed the new board.
 * ------------------------------------------------------------------ */
function NewVisualModal({
  kind,
  template,
  onClose,
  onCreated,
}: {
  kind: VisualKind;
  template: WhiteboardTemplate | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { tree } = useHierarchy();
  const [name, setName] = useState(template && template.id !== "blank" ? template.name : "");
  const [spaceId, setSpaceId] = useState("");
  const [link, setLink] = useState(""); // "folder:<id>" | "list:<id>" | ""
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isBoard = kind === "whiteboard";
  const spaces = tree.filter((s) => permissionAtLeast(s.myPermission, "edit"));

  // Flatten the hierarchy into Folder / List options the board can link to.
  const linkOptions = useMemo(() => {
    const folders: { value: string; label: string }[] = [];
    const lists: { value: string; label: string }[] = [];
    for (const s of tree) {
      for (const f of s.folders ?? []) {
        folders.push({ value: `folder:${f.id}`, label: `${s.name} / ${f.name}` });
        for (const l of f.lists ?? []) {
          lists.push({ value: `list:${l.id}`, label: `${s.name} / ${f.name} / ${l.name}` });
        }
      }
      for (const l of s.lists ?? []) {
        lists.push({ value: `list:${l.id}`, label: `${s.name} / ${l.name}` });
      }
    }
    return { folders, lists };
  }, [tree]);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      let id: string;
      if (isBoard) {
        const body: WhiteboardCreate = { name: trimmed, spaceId: spaceId || null };
        if (template && template.id !== "blank") body.elements = template.build();
        if (link.startsWith("folder:")) body.folderId = link.slice(7);
        else if (link.startsWith("list:")) body.listId = link.slice(5);
        id = (await whiteboardsApi.create(body)).whiteboard.id;
      } else {
        id = (await mindmapsApi.create({ name: trimmed, spaceId: spaceId || null })).mindmap.id;
      }
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
            <span className="modal-ic">{isBoard ? Icons.whiteboard : Icons.mindmap}</span>
            <div>
              <h2>{isBoard ? "New whiteboard" : "New mind map"}</h2>
              <p className="muted share-sub">
                {template && template.id !== "blank"
                  ? `Starting from the ${template.name} template.`
                  : isBoard
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

          {isBoard && (linkOptions.folders.length > 0 || linkOptions.lists.length > 0) && (
            <div className="field">
              <label className="label" htmlFor="viz-link">Link to work (optional)</label>
              <select
                id="viz-link"
                className="input"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              >
                <option value="">Not linked</option>
                {linkOptions.lists.length > 0 && (
                  <optgroup label="Lists">
                    {linkOptions.lists.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                )}
                {linkOptions.folders.length > 0 && (
                  <optgroup label="Folders">
                    {linkOptions.folders.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                Cross-reference the project this board belongs to — it won&apos;t change who can see it.
              </p>
            </div>
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

/** The little "linked to …" chip on a board card. */
function LinkChip({ b }: { b: WhiteboardSummary }) {
  if (b.taskId) return <span className="viz-link-chip">{Icons.tasks} {b.taskName ?? "Task"}</span>;
  if (b.listId) return <span className="viz-link-chip">{Icons.list} {b.listName ?? "List"}</span>;
  if (b.folderId) return <span className="viz-link-chip">{Icons.folder} {b.folderName ?? "Folder"}</span>;
  return null;
}

export default function WhiteboardsHubPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<WhiteboardSummary[] | null>(null);
  const [maps, setMaps] = useState<MindmapSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<VisualKind | null>(null);
  const [template, setTemplate] = useState<WhiteboardTemplate | null>(null);
  const [query, setQuery] = useState("");

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

  const openNew = (kind: VisualKind, tpl: WhiteboardTemplate | null = null) => {
    setTemplate(tpl);
    setCreating(kind);
  };

  const q = query.trim().toLowerCase();
  const filteredBoards = (boards ?? []).filter(
    (b) => !q || b.name.toLowerCase().includes(q) || (b.spaceName ?? "").toLowerCase().includes(q),
  );
  const filteredMaps = (maps ?? []).filter(
    (m) => !q || m.name.toLowerCase().includes(q) || (m.spaceName ?? "").toLowerCase().includes(q),
  );

  const skeleton = (
    <div className="viz-grid">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="skel" style={{ height: 96, borderRadius: 12 }} />
      ))}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Whiteboards</h1>
          <p className="sub">Sketch it out — canvases and mind maps beside the work.</p>
        </div>
        <div className="viz-search">
          <span className="viz-search-ic">{Icons.search}</span>
          <input
            className="input"
            placeholder="Search boards…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* -------- start from a template (compact) -------- */}
      <div className="viz-templates">
        <div className="viz-templates-label">Start from a template</div>
        <div className="viz-template-row">
          {WHITEBOARD_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="viz-template"
              onClick={() => openNew("whiteboard", t)}
              title={t.desc}
            >
              <span className="viz-template-thumb" style={{ background: t.tint }}>
                {t.icon}
              </span>
              <span className="viz-template-name">{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* -------- whiteboards -------- */}
      <div className="viz-section-head">
        <span className="viz-section-ic">{Icons.whiteboard}</span>
        <h2>Whiteboards</h2>
        {boards && <span className="viz-section-count">{boards.length}</span>}
        <span className="viz-section-spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openNew("whiteboard")}>
          {Icons.plus} New whiteboard
        </button>
      </div>

      {boards === null ? (
        skeleton
      ) : boards.length === 0 ? (
        <div className="viz-empty">
          <span className="viz-empty-ic">{Icons.pen}</span>
          <p>No whiteboards yet — open a blank canvas or start from a template above.</p>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => openNew("whiteboard")}>
            {Icons.plus} Create your first whiteboard
          </button>
        </div>
      ) : filteredBoards.length === 0 ? (
        <div className="viz-empty"><p>No whiteboards match “{query}”.</p></div>
      ) : (
        <div className="viz-grid">
          {filteredBoards.map((b) => (
            <Link key={b.id} href={`/whiteboard?id=${b.id}`} className="viz-card card-hover">
              <span className="viz-card-ic viz-card-ic-board">{Icons.whiteboard}</span>
              <span className="viz-card-name">{b.name}</span>
              <span className="viz-card-meta">
                <SpaceChip spaceId={b.spaceId} spaceName={b.spaceName} />
                <LinkChip b={b} />
              </span>
              <span className="viz-card-sub">
                {b.elementCount} {b.elementCount === 1 ? "element" : "elements"} · {timeAgo(b.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* -------- mind maps -------- */}
      <div className="viz-section-head">
        <span className="viz-section-ic">{Icons.mindmap}</span>
        <h2>Mind maps</h2>
        {maps && <span className="viz-section-count">{maps.length}</span>}
        <span className="viz-section-spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openNew("mindmap")}>
          {Icons.plus} New mind map
        </button>
      </div>

      {maps === null ? (
        skeleton
      ) : maps.length === 0 ? (
        <div className="viz-empty">
          <span className="viz-empty-ic">{Icons.branch}</span>
          <p>No mind maps yet — start with one idea and let it branch.</p>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => openNew("mindmap")}>
            {Icons.plus} Create your first mind map
          </button>
        </div>
      ) : filteredMaps.length === 0 ? (
        <div className="viz-empty"><p>No mind maps match “{query}”.</p></div>
      ) : (
        <div className="viz-grid">
          {filteredMaps.map((m) => (
            <Link key={m.id} href={`/mindmap?id=${m.id}`} className="viz-card card-hover">
              <span className="viz-card-ic viz-card-ic-map">{Icons.mindmap}</span>
              <span className="viz-card-name">{m.name}</span>
              <span className="viz-card-meta">
                <SpaceChip spaceId={m.spaceId} spaceName={m.spaceName} />
              </span>
              <span className="viz-card-sub">
                {typeof m.nodeCount === "number"
                  ? `${m.nodeCount} ${m.nodeCount === 1 ? "node" : "nodes"} · `
                  : ""}
                {timeAgo(m.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <NewVisualModal
          kind={creating}
          template={creating === "whiteboard" ? template : null}
          onClose={() => {
            setCreating(null);
            setTemplate(null);
          }}
          onCreated={(id) =>
            router.push(creating === "whiteboard" ? `/whiteboard?id=${id}` : `/mindmap?id=${id}`)
          }
        />
      )}
    </div>
  );
}
