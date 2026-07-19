"use client";

/**
 * Module 12 — the mind-map canvas. `/mindmap?id=<mindmapId>`.
 *
 * The whole map is a single tree hanging off `root` (client-owned jsonb).
 * We compute a tidy horizontal layout every render: the root sits on the
 * left, children fan out to the right. Each visible leaf owns one row of
 * `ROW_H`; a parent's y centers on the span of its visible children;
 * x = depth * COL_W. Positions animate via a CSS transform transition.
 *
 * Nodes are absolutely-positioned DOM pills (so they can host inline
 * rename inputs and hover controls) laid over an SVG connector layer —
 * both share the same pan/zoom camera transform:
 *   screen = world * zoom + pan.
 *
 * Persistence mirrors the whiteboard: the tree (and name) are PATCHed
 * wholesale, debounced 900ms, with a Saving/Saved pill and a flush on
 * unmount. `mindmap.changed` from another user (quiet for >2s locally)
 * refetches — last write wins, no merge.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  mindmapsApi,
  permissionAtLeast,
  tasksApi,
  type MindmapDetail,
  type MindmapNode,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";

/* ------------------------------------------------------------------ *
 * Geometry.
 * ------------------------------------------------------------------ */
const NODE_W = 176;
const ROW_H = 50;
const COL_W = 224;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.2;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

/* ------------------------------------------------------------------ *
 * Pure tree helpers — every mutation returns a fresh root.
 * ------------------------------------------------------------------ */
function findNode(node: MindmapNode, id: string): MindmapNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

function findParentId(node: MindmapNode, id: string): string | null {
  for (const c of node.children) {
    if (c.id === id) return node.id;
    const deep = findParentId(c, id);
    if (deep) return deep;
  }
  return null;
}

function updateNode(
  node: MindmapNode,
  id: string,
  fn: (n: MindmapNode) => MindmapNode,
): MindmapNode {
  if (node.id === id) return fn(node);
  if (node.children.length === 0) return node;
  let changed = false;
  const children = node.children.map((c) => {
    const nc = updateNode(c, id, fn);
    if (nc !== c) changed = true;
    return nc;
  });
  return changed ? { ...node, children } : node;
}

function addChildTo(node: MindmapNode, parentId: string, child: MindmapNode): MindmapNode {
  return updateNode(node, parentId, (n) => ({
    ...n,
    collapsed: false,
    children: [...n.children, child],
  }));
}

function removeNode(node: MindmapNode, id: string): MindmapNode {
  const children = node.children
    .filter((c) => c.id !== id)
    .map((c) => removeNode(c, id));
  return { ...node, children };
}

function subtreeIds(node: MindmapNode, set: Set<string> = new Set()): Set<string> {
  set.add(node.id);
  for (const c of node.children) subtreeIds(c, set);
  return set;
}

interface FlatNode {
  id: string;
  text: string;
  depth: number;
}
function flattenNodes(
  node: MindmapNode,
  exclude: Set<string>,
  depth = 0,
  acc: FlatNode[] = [],
): FlatNode[] {
  if (exclude.has(node.id)) return acc;
  acc.push({ id: node.id, text: node.text, depth });
  for (const c of node.children) flattenNodes(c, exclude, depth + 1, acc);
  return acc;
}

/* ------------------------------------------------------------------ *
 * Layout — post-order walk assigns x by depth, y by leaf rows.
 * ------------------------------------------------------------------ */
interface Placed {
  node: MindmapNode;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
}
interface Layout {
  placed: Placed[];
  byId: Map<string, Placed>;
  width: number;
  height: number;
}

function layoutTree(root: MindmapNode): Layout {
  const placed: Placed[] = [];
  let row = 0;
  const walk = (node: MindmapNode, parentId: string | null, depth: number): number => {
    const x = depth * COL_W;
    const kids = node.collapsed ? [] : node.children;
    let y: number;
    if (kids.length === 0) {
      y = row * ROW_H + ROW_H / 2;
      row += 1;
    } else {
      const ys = kids.map((k) => walk(k, node.id, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    placed.push({ node, parentId, depth, x, y });
    return y;
  };
  walk(root, null, 0);
  const byId = new Map<string, Placed>();
  let maxDepth = 0;
  for (const p of placed) {
    byId.set(p.node.id, p);
    if (p.depth > maxDepth) maxDepth = p.depth;
  }
  return {
    placed,
    byId,
    width: maxDepth * COL_W + NODE_W,
    height: Math.max(1, row) * ROW_H,
  };
}

/** Smooth cubic from a parent's right edge to a child's left edge. */
function connectorPath(from: Placed, to: Placed): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const dx = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/* ------------------------------------------------------------------ *
 * View.
 * ------------------------------------------------------------------ */
type SaveState = "idle" | "saving" | "saved" | "error";
interface Cam {
  x: number;
  y: number;
  z: number;
}
type NodeMenu = { nodeId: string; x: number; y: number; mode: "root" | "move" | "task" };

function MindmapView() {
  const search = useSearchParams();
  const router = useRouter();
  const mapId = search.get("id");
  const { tree } = useHierarchy();

  const [map, setMap] = useState<MindmapDetail | null>(null);
  const [root, setRoot] = useState<MindmapNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, z: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [headMenu, setHeadMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nodeMenu, setNodeMenu] = useState<NodeMenu | null>(null);
  const [toast, setToast] = useState("");

  /* refs (read from window-level listeners / stable callbacks) */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const rootRef = useRef(root);
  rootRef.current = root;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const editingRef = useRef(editingId);
  editingRef.current = editingId;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const spaceRef = useRef(false);
  const mapIdRef = useRef(mapId);
  mapIdRef.current = mapId;
  const layoutRef = useRef<Layout | null>(null);
  const fittedRef = useRef(false);
  const lastEditRef = useRef(0);
  const pendingRef = useRef<{ name?: string; root?: MindmapNode }>({});
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* permissions — attached maps follow the space's grant */
  const space = map?.spaceId ? tree.find((s) => s.id === map.spaceId) : null;
  const canEdit = map
    ? !map.spaceId || (space ? permissionAtLeast(space.myPermission, "edit") : false)
    : false;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  /* ---- camera helpers ---- */
  const zoomAt = useCallback((clientX: number, clientY: number, nextZ: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    setCam((c) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZ));
      const k = z / c.z;
      return { x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k, z };
    });
  }, []);

  const zoomCenter = useCallback(
    (factor: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const cx = (rect?.width ?? 800) / 2 + (rect?.left ?? 0);
      const cy = (rect?.height ?? 600) / 2 + (rect?.top ?? 0);
      zoomAt(cx, cy, camRef.current.z * factor);
    },
    [zoomAt],
  );

  const fitView = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const vw = rect?.width ?? 900;
    const vh = rect?.height ?? 600;
    const lay = layoutRef.current;
    const bw = Math.max(NODE_W, lay?.width ?? NODE_W);
    const bh = Math.max(ROW_H, lay?.height ?? ROW_H);
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((vw - 140) / bw, (vh - 120) / bh, 1.3)));
    setCam({ x: (vw - bw * z) / 2, y: (vh - bh * z) / 2, z });
  }, []);

  /* ---- autosave ---- */
  const flush = useCallback((): void => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const id = mapIdRef.current;
    const payload = pendingRef.current;
    if (!id || (payload.root === undefined && payload.name === undefined)) return;
    pendingRef.current = {};
    dirtyRef.current = false;
    setSaveState("saving");
    mindmapsApi
      .update(id, payload)
      .then(() => setSaveState((s) => (dirtyRef.current ? s : "saved")))
      .catch(() => {
        // merge the failed payload back so a retry re-sends it
        pendingRef.current = { ...payload, ...pendingRef.current };
        dirtyRef.current = true;
        setSaveState("error");
      });
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const queueSave = useCallback(
    (patch: { name?: string; root?: MindmapNode }): void => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      dirtyRef.current = true;
      lastEditRef.current = Date.now();
      setSaveState("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => flushRef.current(), 900);
    },
    [],
  );

  // Flush any pending edit when leaving the page.
  useEffect(() => () => flushRef.current(), []);

  const commitRoot = useCallback(
    (next: MindmapNode): void => {
      setRoot(next);
      rootRef.current = next;
      queueSave({ root: next });
    },
    [queueSave],
  );

  const flash = useCallback((message: string): void => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2600);
  }, []);

  /* ---- data loading ---- */
  const loadMap = useCallback((): void => {
    if (!mapId) return;
    mindmapsApi
      .get(mapId)
      .then((r) => {
        setMap(r.mindmap);
        setRoot(r.mindmap.root);
        rootRef.current = r.mindmap.root;
        setError("");
        if (!fittedRef.current) {
          fittedRef.current = true;
          requestAnimationFrame(() => fitView());
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this mind map."),
      )
      .finally(() => setLoading(false));
  }, [mapId, fitView]);

  useEffect(loadMap, [loadMap]);

  /* ---- realtime: refetch on someone else's edit ---- */
  useRealtime(
    (e) => {
      if (e.type !== "mindmap.changed" || !mapId || e.payload.mindmapId !== mapId) return;
      if (Date.now() - lastEditRef.current < 2000 || dirtyRef.current) return;
      mindmapsApi
        .get(mapId)
        .then((r) => {
          if (mapIdRef.current !== r.mindmap.id || dirtyRef.current) return;
          setMap(r.mindmap);
          setRoot(r.mindmap.root);
          rootRef.current = r.mindmap.root;
        })
        .catch(() => undefined);
    },
    [mapId],
  );

  /* ---- mutations ---- */
  const addChild = useCallback(
    (parentId: string): void => {
      if (!canEditRef.current || !rootRef.current) return;
      const child: MindmapNode = { id: uid(), text: "", children: [] };
      commitRoot(addChildTo(rootRef.current, parentId, child));
      setSelectedId(child.id);
      setEditingId(child.id);
      setDraft("");
      setNodeMenu(null);
    },
    [commitRoot],
  );

  const deleteNode = useCallback(
    (id: string): void => {
      const r = rootRef.current;
      if (!canEditRef.current || !r || id === r.id) return; // root can't be deleted
      const parentId = findParentId(r, id);
      commitRoot(removeNode(r, id));
      setSelectedId(parentId ?? r.id);
      setEditingId(null);
      setNodeMenu(null);
    },
    [commitRoot],
  );

  const toggleCollapse = useCallback(
    (id: string): void => {
      if (!rootRef.current) return;
      commitRoot(updateNode(rootRef.current, id, (n) => ({ ...n, collapsed: !n.collapsed })));
    },
    [commitRoot],
  );

  const beginRename = useCallback((id: string): void => {
    if (!canEditRef.current || !rootRef.current) return;
    const n = findNode(rootRef.current, id);
    if (!n) return;
    setSelectedId(id);
    setEditingId(id);
    setDraft(n.text);
    setNodeMenu(null);
  }, []);

  const commitRename = useCallback((): void => {
    const id = editingRef.current;
    if (!id || !rootRef.current) return;
    setEditingId(null);
    const cur = findNode(rootRef.current, id);
    const text = draftRef.current;
    if (cur && cur.text !== text) {
      commitRoot(updateNode(rootRef.current, id, (n) => ({ ...n, text })));
    }
  }, [commitRoot]);
  const commitRenameRef = useRef(commitRename);
  commitRenameRef.current = commitRename;

  const moveUnder = useCallback(
    (id: string, targetId: string): void => {
      const r = rootRef.current;
      if (!r) return;
      const sub = findNode(r, id);
      if (!sub || subtreeIds(sub).has(targetId)) return; // never under self/descendant
      commitRoot(addChildTo(removeNode(r, id), targetId, sub));
      setNodeMenu(null);
    },
    [commitRoot],
  );

  const createTaskFrom = useCallback(
    (nodeId: string, listId: string, listName: string): void => {
      const r = rootRef.current;
      if (!r) return;
      const node = findNode(r, nodeId);
      const name = (node?.text ?? "").trim() || "Untitled";
      setNodeMenu(null);
      tasksApi
        .create(listId, { name })
        .then((res) => {
          const cur = rootRef.current;
          if (!cur) return;
          commitRoot(updateNode(cur, nodeId, (n) => ({ ...n, taskId: res.task.id })));
          flash(`Created task “${name}” in ${listName}`);
        })
        .catch(() => flash("Couldn't create the task."));
    },
    [commitRoot, flash],
  );

  /* ---- keyboard ---- */
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      if (e.key === " ") {
        spaceRef.current = true;
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        setEditingId(null);
        setNodeMenu(null);
        setSelectedId(null);
        return;
      }
      const sel = selectedRef.current;
      if (!sel) return;
      if (e.key === "Enter") {
        e.preventDefault();
        addChild(sel);
      } else if (e.key === "Tab") {
        e.preventDefault();
        addChild(sel);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteNode(sel);
      } else if (e.key === "F2") {
        e.preventDefault();
        beginRename(sel);
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === " ") {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [addChild, deleteNode, beginRename]);

  /* ---- pan gesture (window-level move/up) ---- */
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    const onMove = (ev: PointerEvent): void => {
      const g = panRef.current;
      if (!g) return;
      setCam((c) => ({ ...c, x: g.ox + (ev.clientX - g.sx), y: g.oy + (ev.clientY - g.sy) }));
    };
    const onUp = (): void => {
      if (panRef.current) {
        panRef.current = null;
        setPanning(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  /* ---- wheel: pan / ctrl-zoom (native — React's wheel is passive) ---- */
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const onWheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        zoomAt(ev.clientX, ev.clientY, camRef.current.z * Math.exp(-ev.deltaY * 0.002));
      } else {
        setCam((c) => ({ ...c, x: c.x - ev.deltaX, y: c.y - ev.deltaY }));
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const startPan = (e: React.PointerEvent): void => {
    panRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: camRef.current.x,
      oy: camRef.current.y,
    };
    setPanning(true);
  };

  const onCanvasPointerDown = (e: React.PointerEvent): void => {
    if (editingRef.current) commitRenameRef.current();
    if (e.button === 1 || spaceRef.current) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    // empty click — deselect & close menus
    setSelectedId(null);
    setNodeMenu(null);
  };

  const onNodePointerDown = (e: React.PointerEvent, id: string): void => {
    if (e.button === 1 || spaceRef.current) return; // let the canvas pan
    e.stopPropagation();
    if (editingRef.current && editingRef.current !== id) commitRenameRef.current();
    setSelectedId(id);
    setNodeMenu(null);
  };

  const openNodeMenu = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation();
    const wrap = wrapRef.current?.getBoundingClientRect();
    const btn = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setNodeMenu({
      nodeId: id,
      x: btn.left - (wrap?.left ?? 0),
      y: btn.bottom - (wrap?.top ?? 0) + 4,
      mode: "root",
    });
  };

  /* ---- header actions ---- */
  const commitName = (): void => {
    setEditingName(false);
    const n = nameDraft.trim();
    if (map && n && n !== map.name) {
      setMap({ ...map, name: n });
      queueSave({ name: n });
    }
  };

  const deleteMap = (): void => {
    if (!map) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete “${map.name}”? This can't be undone.`)) {
      return;
    }
    mindmapsApi
      .remove(map.id)
      .then(() => router.push("/whiteboards"))
      .catch(() => {
        if (typeof window !== "undefined") window.alert("Couldn't delete the mind map.");
      });
  };

  // Click-away closes the header menu.
  useEffect(() => {
    if (!headMenu) return;
    const close = (): void => setHeadMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [headMenu]);

  // Click-away closes the node menu.
  useEffect(() => {
    if (!nodeMenu) return;
    const close = (): void => setNodeMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [nodeMenu]);

  /* ---- layout (recomputed on every tree change) ---- */
  const layout = useMemo<Layout | null>(() => (root ? layoutTree(root) : null), [root]);
  layoutRef.current = layout;

  /* ---- render guards ---- */
  if (!mapId) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.mindmap}</span>
          <h3>No mind map selected</h3>
          <p>Pick a mind map from the hub to start branching.</p>
          <Link href="/whiteboards" className="btn btn-soft">
            Browse the visual hub
          </Link>
        </div>
      </div>
    );
  }
  if (loading && !map) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 34, marginBottom: 20 }} />
        <span className="skel" style={{ width: "100%", height: 420, borderRadius: 14 }} />
      </div>
    );
  }
  if (error || !map || !root || !layout) {
    return (
      <div className="page">
        <div className="form-error">{error || "Mind map not found."}</div>
        <Link href="/whiteboards" className="btn btn-soft">
          Back to the visual hub
        </Link>
      </div>
    );
  }

  const camTransform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  const cursor = panning ? "grabbing" : spaceDown ? "grab" : "default";
  const menuNode = nodeMenu ? findNode(root, nodeMenu.nodeId) : null;
  const editableSpaces = tree.filter(
    (s) => !s.archived && permissionAtLeast(s.myPermission, "edit"),
  );

  return (
    <div className="doc-shell" style={{ flexDirection: "column" }}>
      {/* -------- header -------- */}
      <header className="doc-head">
        <Link href="/whiteboards" className="doc-crumb" title="Visual hub">
          {Icons.mindmap}
        </Link>
        <span className="doc-crumb-sep">/</span>

        {editingName ? (
          <input
            className="doc-name-input"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              else if (e.key === "Escape") setEditingName(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="doc-name"
            title={canEdit ? "Rename mind map" : map.name}
            onClick={() => {
              if (!canEdit) return;
              setNameDraft(map.name);
              setEditingName(true);
            }}
          >
            {map.name}
          </button>
        )}

        {map.spaceId ? (
          <span className="doc-chip doc-chip-space">{space?.name ?? "Space"}</span>
        ) : (
          <span className="doc-chip">{Icons.globe} Workspace</span>
        )}
        {!canEdit && <span className="doc-chip doc-chip-ro">{Icons.eye} Read-only</span>}

        <span className="doc-head-spacer" />

        <span className={`doc-save${saveState === "idle" ? " hidden" : ""}`} aria-live="polite">
          {saveState === "saving" ? (
            <>
              <span className="doc-save-dot pulsing" />
              Saving…
            </>
          ) : saveState === "error" ? (
            <>
              <span className="doc-save-dot" style={{ background: "var(--danger)" }} />
              Couldn&apos;t save
            </>
          ) : (
            <>
              <span className="doc-save-dot" />
              Saved · just now
            </>
          )}
        </span>

        <span className="doc-menu-wrap">
          <button
            type="button"
            className="icon-btn"
            aria-label="Mind map options"
            onClick={(e) => {
              e.stopPropagation();
              setHeadMenu((v) => !v);
            }}
          >
            {Icons.more}
          </button>
          {headMenu && (
            <div className="menu doc-menu" onClick={(e) => e.stopPropagation()}>
              {canEdit ? (
                <button type="button" className="danger" onClick={deleteMap}>
                  {Icons.trash} Delete mind map
                </button>
              ) : (
                <span className="doc-menu-note">You have view access to this mind map.</span>
              )}
            </div>
          )}
        </span>
      </header>

      {/* -------- canvas -------- */}
      <div
        ref={wrapRef}
        onPointerDown={onCanvasPointerDown}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          background: "var(--card-2)",
          cursor,
          touchAction: "none",
        }}
      >
        {/* connector layer */}
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <defs>
            <pattern
              id="mm-grid"
              width={26 * cam.z}
              height={26 * cam.z}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${cam.x} ${cam.y})`}
            >
              <circle cx={1} cy={1} r={1} fill="var(--line)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#mm-grid)" />
          <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
            {layout.placed.map((p) =>
              p.parentId ? (
                <path
                  key={`edge-${p.node.id}`}
                  d={connectorPath(layout.byId.get(p.parentId) as Placed, p)}
                  fill="none"
                  stroke="var(--brand)"
                  strokeOpacity={0.4}
                  strokeWidth={2}
                />
              ) : null,
            )}
          </g>
        </svg>

        {/* node layer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: camTransform,
            transformOrigin: "0 0",
            pointerEvents: "none",
          }}
        >
          {layout.placed.map((p) => {
            const isRoot = p.node.id === root.id;
            const isSel = selectedId === p.node.id;
            const isEditing = editingId === p.node.id;
            const showCtl = canEdit && (hoverId === p.node.id || isSel);
            const hasChildren = p.node.children.length > 0;
            return (
              <div
                key={p.node.id}
                onPointerDown={(e) => onNodePointerDown(e, p.node.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  beginRename(p.node.id);
                }}
                onMouseEnter={() => setHoverId(p.node.id)}
                onMouseLeave={() => setHoverId((h) => (h === p.node.id ? null : h))}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: NODE_W,
                  transform: `translate(${p.x}px, ${p.y}px) translateY(-50%)`,
                  transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
                  pointerEvents: "auto",
                }}
              >
                {/* pill */}
                <div
                  style={{
                    position: "relative",
                    boxSizing: "border-box",
                    width: "100%",
                    minHeight: 36,
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: 12,
                    fontSize: isRoot ? 14 : 13,
                    fontWeight: isRoot ? 700 : 550,
                    lineHeight: 1.3,
                    background: isRoot ? "var(--brand)" : "var(--card)",
                    color: isRoot ? "var(--brand-ink)" : "var(--ink)",
                    border: `1px solid ${isRoot ? "var(--brand)" : "var(--line)"}`,
                    boxShadow: isSel
                      ? "0 0 0 2px var(--brand)"
                      : "0 1px 2px rgba(24, 26, 42, 0.06)",
                    cursor: "pointer",
                  }}
                >
                  {p.node.taskId && (
                    <span
                      title="Linked to a task"
                      style={{
                        position: "absolute",
                        left: -7,
                        top: -7,
                        width: 17,
                        height: 17,
                        borderRadius: "50%",
                        background: "var(--ok)",
                        color: "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5 10 17.5 19.5 6.5" />
                      </svg>
                    </span>
                  )}

                  {isEditing ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={commitRename}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        font: "inherit",
                        fontWeight: "inherit",
                        color: "inherit",
                        padding: 0,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        wordBreak: "break-word",
                        opacity: p.node.text ? 1 : 0.55,
                      }}
                    >
                      {p.node.text || "Untitled"}
                    </span>
                  )}
                </div>

                {/* collapse / expand toggle */}
                {hasChildren && (
                  <button
                    type="button"
                    title={p.node.collapsed ? "Expand" : "Collapse"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(p.node.id);
                    }}
                    style={{
                      position: "absolute",
                      right: -11,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: "1px solid var(--line)",
                      background: "var(--card)",
                      color: "var(--ink-2)",
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {p.node.collapsed ? p.node.children.length : "–"}
                  </button>
                )}

                {/* hover controls: add child + menu */}
                {showCtl && (
                  <div
                    style={{
                      position: "absolute",
                      top: -13,
                      right: hasChildren ? 14 : -6,
                      display: "flex",
                      gap: 4,
                    }}
                  >
                    <button
                      type="button"
                      title="Add child (Enter)"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        addChild(p.node.id);
                      }}
                      style={miniBtn}
                    >
                      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="Node options"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openNodeMenu(e, p.node.id)}
                      style={miniBtn}
                    >
                      <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" stroke="none">
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* -------- node menu (screen space) -------- */}
        {nodeMenu && menuNode && (
          <div
            className="menu"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: Math.min(nodeMenu.x, (wrapRef.current?.clientWidth ?? 900) - 240),
              top: nodeMenu.y,
              minWidth: 216,
              maxHeight: 320,
              overflowY: "auto",
              zIndex: 50,
            }}
          >
            {nodeMenu.mode === "root" && (
              <>
                <button type="button" onClick={() => addChild(nodeMenu.nodeId)}>
                  {Icons.plus} Add child
                </button>
                <button type="button" onClick={() => beginRename(nodeMenu.nodeId)}>
                  {Icons.edit} Rename
                </button>
                {menuNode.children.length > 0 && (
                  <button type="button" onClick={() => toggleCollapse(nodeMenu.nodeId)}>
                    {Icons.branch} {menuNode.collapsed ? "Expand branch" : "Collapse branch"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={menuNode.id === root.id}
                  onClick={() => setNodeMenu({ ...nodeMenu, mode: "move" })}
                >
                  {Icons.share} Move under…
                </button>
                {menuNode.taskId ? (
                  <span className="doc-menu-note">{Icons.check} Task already created</span>
                ) : (
                  <button type="button" onClick={() => setNodeMenu({ ...nodeMenu, mode: "task" })}>
                    {Icons.tasks} Create task…
                  </button>
                )}
                <button
                  type="button"
                  className="danger"
                  disabled={menuNode.id === root.id}
                  onClick={() => deleteNode(nodeMenu.nodeId)}
                >
                  {Icons.trash} Delete node
                </button>
              </>
            )}

            {nodeMenu.mode === "move" && (
              <>
                <button type="button" onClick={() => setNodeMenu({ ...nodeMenu, mode: "root" })}>
                  {Icons.chevronLeft} Back
                </button>
                <span className="doc-menu-note">Move under…</span>
                {flattenNodes(root, subtreeIds(menuNode)).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => moveUnder(nodeMenu.nodeId, f.id)}
                    style={{ paddingLeft: 10 + f.depth * 12 }}
                  >
                    {f.text || "Untitled"}
                  </button>
                ))}
              </>
            )}

            {nodeMenu.mode === "task" && (
              <>
                <button type="button" onClick={() => setNodeMenu({ ...nodeMenu, mode: "root" })}>
                  {Icons.chevronLeft} Back
                </button>
                <span className="doc-menu-note">Create task in…</span>
                {editableSpaces.length === 0 && (
                  <span className="doc-menu-note">No lists you can add tasks to.</span>
                )}
                {editableSpaces.map((s) => {
                  const lists = [
                    ...s.lists,
                    ...s.folders.flatMap((f) => f.lists),
                  ].filter((l) => !l.archived);
                  if (lists.length === 0) return null;
                  return (
                    <div key={s.id}>
                      <span
                        className="doc-menu-note"
                        style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}
                      >
                        {Icons.spaces} {s.name}
                      </span>
                      {lists.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => createTaskFrom(nodeMenu.nodeId, l.id, l.name)}
                          style={{ paddingLeft: 22 }}
                        >
                          {Icons.list} {l.name}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* -------- zoom cluster -------- */}
        <div
          style={{
            position: "absolute",
            right: 16,
            bottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 2,
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            boxShadow: "var(--shadow-3)",
            padding: 3,
          }}
        >
          <button type="button" className="icon-btn" title="Zoom out" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>
            −
          </button>
          <button
            type="button"
            title="Fit to content"
            onClick={() => fitView()}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--ink-2)",
              font: "inherit",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              minWidth: 46,
            }}
          >
            {Math.round(cam.z * 100)}%
          </button>
          <button type="button" className="icon-btn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>
            +
          </button>
        </div>

        {/* -------- hint -------- */}
        {canEdit && (
          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 16,
              maxWidth: 340,
              fontSize: "0.78rem",
              color: "var(--muted)",
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "8px 12px",
            }}
          >
            Click a node to select · Enter or ＋ adds a child · double-click renames · ⌫ deletes · space-drag to pan.
          </div>
        )}

        {/* -------- toast -------- */}
        {toast && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 20,
              transform: "translateX(-50%)",
              background: "var(--ink)",
              color: "var(--card)",
              fontSize: "0.82rem",
              fontWeight: 600,
              padding: "9px 16px",
              borderRadius: 999,
              boxShadow: "var(--shadow-3)",
              zIndex: 60,
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 7,
  border: "1px solid var(--line)",
  background: "var(--card)",
  color: "var(--ink-2)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  boxShadow: "0 1px 2px rgba(24, 26, 42, 0.08)",
};

export default function MindmapPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 34 }} />
        </div>
      }
    >
      <MindmapView />
    </Suspense>
  );
}
