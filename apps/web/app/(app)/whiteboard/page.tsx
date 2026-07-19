"use client";

/**
 * Module 12 — the whiteboard canvas. `/whiteboard?id=<boardId>`.
 *
 * One SVG world under a translate+scale camera:
 *   screen = world * zoom + pan          world = (screen - pan) / zoom
 *
 * Tools: Select (V), Sticky (S), Rect (R), Ellipse (O), Text (T),
 * Arrow (A). Click drops a default-size element, dragging sizes it.
 * Select: drag moves, corner handles resize, double-click edits text
 * inline (a screen-space textarea overlay), Delete removes, Esc
 * deselects. Arrows drag point→point and keep endpoint handles.
 * Pan: space-drag / middle-mouse / wheel; ctrl+wheel zooms at cursor.
 *
 * Persistence: the element array is client-owned and PATCHed wholesale,
 * debounced 900ms, with a Saving/Saved pill. A single-level undo stack
 * (≤50 snapshots, Ctrl+Z) captures a snapshot at the start of every
 * mutating gesture. `board.changed` from another user (quiet for >2s
 * locally) refetches — last write wins, no merge.
 */

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  permissionAtLeast,
  whiteboardsApi,
  type WhiteboardDetail,
  type WhiteboardElement,
  type WhiteboardElementKind,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";

/* ------------------------------------------------------------------ *
 * Constants & tiny helpers.
 * ------------------------------------------------------------------ */
const WB_COLORS = [
  "#FDE68A", // sun
  "#FCA5A5", // coral
  "#A7F3D0", // mint
  "#BFDBFE", // sky
  "#DDD6FE", // lilac
  "#FBCFE8", // rose
] as const;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const UNDO_LIMIT = 50;
const MAX_BYTES = 512 * 1024;

/** Sticky text is always dark ink — the pastel fills stay light in dark mode. */
const STICKY_INK = "#1f2430";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

/** Darken a #rrggbb color (borders/arrow strokes derived from swatches). */
function darken(hex: string | undefined, f: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return "rgba(90, 96, 120, 0.9)";
  const n = parseInt(m[1], 16);
  const ch = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v * f)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

interface Camera {
  x: number;
  y: number;
  z: number;
}

/** Everything a live pointer gesture needs, kept in a ref (no re-renders). */
type Gesture =
  | { type: "pan"; sx: number; sy: number; ox: number; oy: number }
  | {
      type: "move";
      id: string;
      sx: number;
      sy: number;
      orig: { x: number; y: number };
      origPoints: { x: number; y: number }[] | null;
      moved: boolean;
    }
  | {
      type: "resize";
      id: string;
      corner: "nw" | "ne" | "sw" | "se";
      orig: { x: number; y: number; w: number; h: number };
    }
  | {
      type: "create";
      kind: Exclude<WhiteboardElementKind, "arrow">;
      id: string;
      sx: number;
      sy: number;
      created: boolean;
    }
  | { type: "arrow"; id: string; sx: number; sy: number }
  | { type: "arrowpt"; id: string; index: number };

const DEFAULT_SIZE: Record<Exclude<WhiteboardElementKind, "arrow">, { w: number; h: number }> = {
  sticky: { w: 180, h: 140 },
  rect: { w: 190, h: 110 },
  ellipse: { w: 170, h: 110 },
  text: { w: 240, h: 34 },
};

function arrowBounds(points: { x: number; y: number }[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

/* ------------------------------------------------------------------ *
 * Toolbar buttons (local — icons are tiny and tool-specific).
 * ------------------------------------------------------------------ */
const st = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const TOOL_META: {
  tool: "select" | WhiteboardElementKind;
  label: string;
  key: string;
  icon: React.ReactNode;
}[] = [
  {
    tool: "select",
    label: "Select",
    key: "V",
    icon: (
      <svg viewBox="0 0 24 24" {...st}>
        <path d="M6 3.5 18.5 12l-5.4 1.3L10 19z" />
      </svg>
    ),
  },
  {
    tool: "sticky",
    label: "Sticky note",
    key: "S",
    icon: (
      <svg viewBox="0 0 24 24" {...st}>
        <path d="M4.5 4.5h15v9L14 19.5H4.5z" />
        <path d="M14 19.5V13.5h5.5" />
      </svg>
    ),
  },
  {
    tool: "rect",
    label: "Rectangle",
    key: "R",
    icon: (
      <svg viewBox="0 0 24 24" {...st}>
        <rect x="4" y="6" width="16" height="12" rx="2" />
      </svg>
    ),
  },
  {
    tool: "ellipse",
    label: "Ellipse",
    key: "O",
    icon: (
      <svg viewBox="0 0 24 24" {...st}>
        <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
      </svg>
    ),
  },
  {
    tool: "text",
    label: "Text",
    key: "T",
    icon: (
      <svg viewBox="0 0 24 24" {...st}>
        <path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />
      </svg>
    ),
  },
  {
    tool: "arrow",
    label: "Arrow",
    key: "A",
    icon: (
      <svg viewBox="0 0 24 24" {...st}>
        <path d="M5 19 19 5M19 5h-6M19 5v6" />
      </svg>
    ),
  },
];

/* ------------------------------------------------------------------ *
 * Element renderers.
 * ------------------------------------------------------------------ */
function ElementBody({
  el,
  hideText,
}: {
  el: WhiteboardElement;
  hideText: boolean;
}) {
  const color = el.color ?? WB_COLORS[0];
  if (el.kind === "arrow") {
    const [p1, p2] = el.points ?? [
      { x: el.x, y: el.y },
      { x: el.x + el.w, y: el.y + el.h },
    ];
    const stroke = darken(color, 0.62);
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const headLen = 13;
    const spread = 0.44;
    const a1 = {
      x: p2.x - headLen * Math.cos(angle - spread),
      y: p2.y - headLen * Math.sin(angle - spread),
    };
    const a2 = {
      x: p2.x - headLen * Math.cos(angle + spread),
      y: p2.y - headLen * Math.sin(angle + spread),
    };
    return (
      <>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={stroke} strokeWidth={2.4} strokeLinecap="round" />
        <polygon points={`${p2.x},${p2.y} ${a1.x},${a1.y} ${a2.x},${a2.y}`} fill={stroke} stroke="none" />
      </>
    );
  }

  const text = hideText ? "" : (el.text ?? "");
  if (el.kind === "sticky") {
    return (
      <>
        <rect
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          rx={10}
          fill={color}
          className="wb-sticky-rect"
        />
        {text && (
          <foreignObject x={el.x} y={el.y} width={el.w} height={el.h} pointerEvents="none">
            <div className="wb-sticky-text" style={{ color: STICKY_INK, fontSize: el.fontSize ?? 14 }}>
              {text}
            </div>
          </foreignObject>
        )}
      </>
    );
  }

  if (el.kind === "rect" || el.kind === "ellipse") {
    const edge = darken(color, 0.72);
    return (
      <>
        {el.kind === "rect" ? (
          <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={8} fill={color} fillOpacity={0.42} stroke={edge} strokeWidth={1.6} />
        ) : (
          <ellipse cx={el.x + el.w / 2} cy={el.y + el.h / 2} rx={el.w / 2} ry={el.h / 2} fill={color} fillOpacity={0.42} stroke={edge} strokeWidth={1.6} />
        )}
        {text && (
          <foreignObject x={el.x} y={el.y} width={el.w} height={el.h} pointerEvents="none">
            <div className="wb-shape-text" style={{ fontSize: el.fontSize ?? 14 }}>
              {text}
            </div>
          </foreignObject>
        )}
      </>
    );
  }

  // Plain text — transparent, just the words.
  return (
    <>
      {/* invisible hit target so empty/short text stays clickable */}
      <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="transparent" stroke="none" />
      <foreignObject x={el.x} y={el.y} width={el.w} height={el.h} pointerEvents="none">
        <div className="wb-text-text" style={{ fontSize: el.fontSize ?? 18 }}>
          {hideText ? "" : el.text || "Text"}
        </div>
      </foreignObject>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The board view.
 * ------------------------------------------------------------------ */
type SaveState = "idle" | "saving" | "saved" | "error";

function WhiteboardView() {
  const search = useSearchParams();
  const router = useRouter();
  const boardId = search.get("id");
  const { tree } = useHierarchy();

  const [board, setBoard] = useState<WhiteboardDetail | null>(null);
  const [elements, setElements] = useState<WhiteboardElement[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [tool, setTool] = useState<"select" | WhiteboardElementKind>("select");
  const [color, setColor] = useState<string>(WB_COLORS[0]);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [movePick, setMovePick] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const editingRef = useRef(editingId);
  editingRef.current = editingId;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const spaceRef = useRef(false);
  const undoRef = useRef<WhiteboardElement[][]>([]);
  const dirtyRef = useRef(false);
  const lastEditRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;
  const fittedRef = useRef(false);

  /* ---- permissions: attached boards follow the space's grant ---- */
  const space = board?.spaceId ? tree.find((s) => s.id === board.spaceId) : null;
  const canEdit = board
    ? !board.spaceId || (space ? permissionAtLeast(space.myPermission, "edit") : false)
    : false;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  /* ---- camera helpers ---- */
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const c = camRef.current;
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    return { x: (sx - c.x) / c.z, y: (sy - c.y) / c.z };
  }, []);

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

  const zoomCenter = useCallback((factor: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const cx = (rect?.width ?? 800) / 2 + (rect?.left ?? 0);
    const cy = (rect?.height ?? 600) / 2 + (rect?.top ?? 0);
    zoomAt(cx, cy, camRef.current.z * factor);
  }, [zoomAt]);

  const fitView = useCallback((els?: WhiteboardElement[]) => {
    const list = els ?? elementsRef.current;
    const rect = wrapRef.current?.getBoundingClientRect();
    const vw = rect?.width ?? 900;
    const vh = rect?.height ?? 600;
    if (list.length === 0) {
      setCam({ x: vw / 2 - 400, y: vh / 2 - 300, z: 1 });
      return;
    }
    const x1 = Math.min(...list.map((e) => e.x));
    const y1 = Math.min(...list.map((e) => e.y));
    const x2 = Math.max(...list.map((e) => e.x + e.w));
    const y2 = Math.max(...list.map((e) => e.y + e.h));
    const bw = Math.max(40, x2 - x1);
    const bh = Math.max(40, y2 - y1);
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((vw - 120) / bw, (vh - 120) / bh, 1.6)));
    setCam({
      x: (vw - bw * z) / 2 - x1 * z,
      y: (vh - bh * z) / 2 - y1 * z,
      z,
    });
  }, []);

  /* ---- autosave ---- */
  const flushSave = useCallback((): void => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const id = boardIdRef.current;
    if (!dirtyRef.current || !id) return;
    const payload = elementsRef.current;
    if (JSON.stringify(payload).length > MAX_BYTES) {
      setSaveState("error");
      return;
    }
    dirtyRef.current = false;
    setSaveState("saving");
    whiteboardsApi
      .update(id, { elements: payload })
      .then(() => setSaveState((s) => (dirtyRef.current ? s : "saved")))
      .catch(() => {
        dirtyRef.current = true;
        setSaveState("error");
      });
  }, []);

  const markDirty = useCallback((): void => {
    dirtyRef.current = true;
    lastEditRef.current = Date.now();
    setSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, 900);
  }, [flushSave]);

  // Flush any pending edit when leaving the board entirely.
  useEffect(() => flushSave, [flushSave]);

  /* ---- undo ---- */
  const pushUndo = useCallback((): void => {
    undoRef.current.push(elementsRef.current);
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
  }, []);

  const undo = useCallback((): void => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    setEditingId(null);
    setSelectedId((sel) => (sel && prev.some((e) => e.id === sel) ? sel : null));
    setElements(prev);
    elementsRef.current = prev;
    markDirty();
  }, [markDirty]);

  /* ---- mutations ---- */
  const patchElement = useCallback(
    (id: string, patch: Partial<WhiteboardElement>): void => {
      setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },
    [],
  );

  const deleteSelected = useCallback((): void => {
    const sel = selectedRef.current;
    if (!sel || !canEditRef.current) return;
    pushUndo();
    setElements((prev) => prev.filter((e) => e.id !== sel));
    setSelectedId(null);
    setEditingId(null);
    markDirty();
  }, [markDirty, pushUndo]);

  /* ---- text editing ---- */
  const openEditor = useCallback((el: WhiteboardElement): void => {
    if (!canEditRef.current || el.kind === "arrow") return;
    setSelectedId(el.id);
    setEditingId(el.id);
    setDraft(el.text ?? "");
  }, []);

  const commitEditor = useCallback((): void => {
    const id = editingRef.current;
    if (!id) return;
    setEditingId(null);
    const el = elementsRef.current.find((e) => e.id === id);
    if (!el) return;
    setDraft((text) => {
      if ((el.text ?? "") !== text) {
        pushUndo();
        if (el.kind === "text" && !text.trim()) {
          setElements((prev) => prev.filter((e) => e.id !== id));
          setSelectedId((s) => (s === id ? null : s));
        } else {
          patchElement(id, { text });
        }
        markDirty();
      }
      return text;
    });
  }, [markDirty, patchElement, pushUndo]);
  const commitEditorRef = useRef(commitEditor);
  commitEditorRef.current = commitEditor;

  /* ---- data loading ---- */
  const loadBoard = useCallback((): void => {
    if (!boardId) return;
    whiteboardsApi
      .get(boardId)
      .then((r) => {
        setBoard(r.whiteboard);
        const els = Array.isArray(r.whiteboard.elements) ? r.whiteboard.elements : [];
        setElements(els);
        setError("");
        if (!fittedRef.current) {
          fittedRef.current = true;
          // Wait one frame so the wrapper has a size.
          requestAnimationFrame(() => fitView(els));
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this whiteboard."),
      )
      .finally(() => setLoading(false));
  }, [boardId, fitView]);

  useEffect(loadBoard, [loadBoard]);

  /* ---- realtime: refetch on someone else's edit ---- */
  useRealtime(
    (e) => {
      if (e.type !== "board.changed" || !boardId || e.payload.whiteboardId !== boardId) return;
      if (Date.now() - lastEditRef.current < 2000 || dirtyRef.current || gestureRef.current) return;
      whiteboardsApi
        .get(boardId)
        .then((r) => {
          if (boardIdRef.current !== r.whiteboard.id) return;
          if (dirtyRef.current || gestureRef.current) return;
          setBoard(r.whiteboard);
          setElements(Array.isArray(r.whiteboard.elements) ? r.whiteboard.elements : []);
        })
        .catch(() => undefined);
    },
    [boardId],
  );

  /* ---- pointer gestures (window-level move/up read the refs) ---- */
  useEffect(() => {
    const onMove = (ev: PointerEvent): void => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.type === "pan") {
        setCam((c) => ({ ...c, x: g.ox + (ev.clientX - g.sx), y: g.oy + (ev.clientY - g.sy) }));
        return;
      }
      const p = screenToWorld(ev.clientX, ev.clientY);

      if (g.type === "move") {
        const dx = p.x - g.sx;
        const dy = p.y - g.sy;
        if (!g.moved && Math.hypot(dx, dy) * camRef.current.z < 2) return;
        if (!g.moved) {
          g.moved = true;
          pushUndo();
        }
        if (g.origPoints) {
          const points = g.origPoints.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
          patchElement(g.id, { ...arrowBounds(points), points });
        } else {
          patchElement(g.id, { x: g.orig.x + dx, y: g.orig.y + dy });
        }
      } else if (g.type === "resize") {
        const o = g.orig;
        let x1 = o.x;
        let y1 = o.y;
        let x2 = o.x + o.w;
        let y2 = o.y + o.h;
        if (g.corner === "nw" || g.corner === "sw") x1 = p.x;
        else x2 = p.x;
        if (g.corner === "nw" || g.corner === "ne") y1 = p.y;
        else y2 = p.y;
        patchElement(g.id, {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.max(24, Math.abs(x2 - x1)),
          h: Math.max(24, Math.abs(y2 - y1)),
        });
      } else if (g.type === "create") {
        const dist = Math.hypot(p.x - g.sx, p.y - g.sy) * camRef.current.z;
        if (!g.created && dist < 5) return;
        if (!g.created) {
          g.created = true;
          pushUndo();
          setElements((prev) => [
            ...prev,
            {
              id: g.id,
              kind: g.kind,
              x: Math.min(g.sx, p.x),
              y: Math.min(g.sy, p.y),
              w: Math.max(24, Math.abs(p.x - g.sx)),
              h: Math.max(24, Math.abs(p.y - g.sy)),
              text: "",
              color: colorRef.current,
              ...(g.kind === "text" ? { fontSize: 18 } : {}),
            },
          ]);
          setSelectedId(g.id);
        } else {
          patchElement(g.id, {
            x: Math.min(g.sx, p.x),
            y: Math.min(g.sy, p.y),
            w: Math.max(24, Math.abs(p.x - g.sx)),
            h: Math.max(24, Math.abs(p.y - g.sy)),
          });
        }
      } else if (g.type === "arrow") {
        const points = [{ x: g.sx, y: g.sy }, { x: p.x, y: p.y }];
        setElements((prev) => {
          const exists = prev.some((e) => e.id === g.id);
          if (!exists) {
            return [
              ...prev,
              { id: g.id, kind: "arrow" as const, ...arrowBounds(points), points, color: colorRef.current },
            ];
          }
          return prev.map((e) => (e.id === g.id ? { ...e, ...arrowBounds(points), points } : e));
        });
      } else if (g.type === "arrowpt") {
        const el = elementsRef.current.find((e) => e.id === g.id);
        if (!el?.points) return;
        const points = el.points.map((pt, i) => (i === g.index ? { x: p.x, y: p.y } : pt));
        patchElement(g.id, { ...arrowBounds(points), points });
      }
    };

    const onUp = (ev: PointerEvent): void => {
      const g = gestureRef.current;
      if (!g) return;
      gestureRef.current = null;
      setPanning(false);

      if (g.type === "pan") return;

      if (g.type === "create") {
        if (!g.created) {
          // Plain click — drop a default-size element centered on the point.
          const size = DEFAULT_SIZE[g.kind];
          pushUndo();
          const el: WhiteboardElement = {
            id: g.id,
            kind: g.kind,
            x: g.sx - size.w / 2,
            y: g.sy - size.h / 2,
            w: size.w,
            h: size.h,
            text: "",
            color: colorRef.current,
            ...(g.kind === "text" ? { fontSize: 18 } : {}),
          };
          setElements((prev) => [...prev, el]);
          setSelectedId(g.id);
          if (g.kind === "sticky" || g.kind === "text") {
            setEditingId(g.id);
            setDraft("");
          }
        }
        setTool("select");
        markDirty();
      } else if (g.type === "arrow") {
        const p = screenToWorld(ev.clientX, ev.clientY);
        if (Math.hypot(p.x - g.sx, p.y - g.sy) < 8) {
          // Accidental click — nothing worth keeping.
          setElements((prev) => prev.filter((e) => e.id !== g.id));
        } else {
          pushUndo(); // snapshot is pre-creation? we snapshot post-hoc below
          // The snapshot above captured the arrow already — fix by removing it.
          undoRef.current[undoRef.current.length - 1] = elementsRef.current.filter(
            (e) => e.id !== g.id,
          );
          setSelectedId(g.id);
          setTool("select");
          markDirty();
        }
      } else if (g.type === "move") {
        if (g.moved) markDirty();
      } else if (g.type === "resize" || g.type === "arrowpt") {
        markDirty();
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [markDirty, patchElement, pushUndo, screenToWorld]);

  /* ---- wheel: pan / ctrl-zoom (native listener — React's is passive) ---- */
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

  /* ---- keyboard ---- */
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return Boolean(
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable),
      );
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      if (e.key === " ") {
        spaceRef.current = true;
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (canEditRef.current) undo();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        setEditingId(null);
        setSelectedId(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (!canEditRef.current) return;
      const k = e.key.toLowerCase();
      if (k === "v") setTool("select");
      else if (k === "s") setTool("sticky");
      else if (k === "r") setTool("rect");
      else if (k === "o") setTool("ellipse");
      else if (k === "t") setTool("text");
      else if (k === "a") setTool("arrow");
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
  }, [deleteSelected, undo]);

  /* ---- canvas pointerdown (creation / pan / deselect) ---- */
  const onCanvasPointerDown = (e: React.PointerEvent): void => {
    if (editingRef.current) commitEditorRef.current();
    const middle = e.button === 1;
    if (middle || spaceRef.current || (toolRef.current === "select" && e.target === e.currentTarget)) {
      // fallthrough below decides pan vs deselect
    }
    if (middle || spaceRef.current) {
      e.preventDefault();
      gestureRef.current = {
        type: "pan",
        sx: e.clientX,
        sy: e.clientY,
        ox: camRef.current.x,
        oy: camRef.current.y,
      };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    const t = toolRef.current;
    if (t === "select") {
      // Clicked empty canvas — deselect.
      setSelectedId(null);
      return;
    }
    if (!canEditRef.current) return;
    const p = screenToWorld(e.clientX, e.clientY);
    if (t === "arrow") {
      gestureRef.current = { type: "arrow", id: uid(), sx: p.x, sy: p.y };
    } else {
      gestureRef.current = { type: "create", kind: t, id: uid(), sx: p.x, sy: p.y, created: false };
    }
  };

  const onElementPointerDown = (e: React.PointerEvent, el: WhiteboardElement): void => {
    if (e.button === 1 || spaceRef.current) return; // let the canvas pan
    if (toolRef.current !== "select") return; // canvas handler creates on top
    e.stopPropagation();
    if (editingRef.current && editingRef.current !== el.id) commitEditorRef.current();
    setSelectedId(el.id);
    if (!canEditRef.current) return;
    const p = screenToWorld(e.clientX, e.clientY);
    gestureRef.current = {
      type: "move",
      id: el.id,
      sx: p.x,
      sy: p.y,
      orig: { x: el.x, y: el.y },
      origPoints: el.points ? el.points.map((pt) => ({ ...pt })) : null,
      moved: false,
    };
  };

  const onHandlePointerDown = (
    e: React.PointerEvent,
    el: WhiteboardElement,
    corner: "nw" | "ne" | "sw" | "se",
  ): void => {
    e.stopPropagation();
    if (!canEditRef.current) return;
    pushUndo();
    gestureRef.current = {
      type: "resize",
      id: el.id,
      corner,
      orig: { x: el.x, y: el.y, w: el.w, h: el.h },
    };
  };

  const onArrowPointPointerDown = (e: React.PointerEvent, el: WhiteboardElement, index: number): void => {
    e.stopPropagation();
    if (!canEditRef.current) return;
    pushUndo();
    gestureRef.current = { type: "arrowpt", id: el.id, index };
  };

  /* ---- header actions ---- */
  const patchBoard = (body: Parameters<typeof whiteboardsApi.update>[1]): void => {
    if (!board) return;
    whiteboardsApi
      .update(board.id, body)
      .then((r) => setBoard((prev) => (prev ? { ...prev, ...r.whiteboard, elements: prev.elements } : r.whiteboard)))
      .catch(loadBoard);
  };

  const commitName = (): void => {
    setEditingName(false);
    const n = nameDraft.trim();
    if (board && n && n !== board.name) {
      setBoard({ ...board, name: n });
      patchBoard({ name: n });
    }
  };

  const deleteBoard = (): void => {
    if (!board) return;
    if (!window.confirm(`Delete “${board.name}”? This can't be undone.`)) return;
    whiteboardsApi
      .remove(board.id)
      .then(() => router.push("/whiteboards"))
      .catch(() => window.alert("Couldn't delete the whiteboard."));
  };

  // Click-away closes the ⋯ menu.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => {
      setMenuOpen(false);
      setMovePick(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  /* ---- render ---- */
  if (!boardId) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.whiteboard}</span>
          <h3>No whiteboard selected</h3>
          <p>Pick a whiteboard from the hub to start sketching.</p>
          <Link href="/whiteboards" className="btn btn-soft">Browse whiteboards</Link>
        </div>
      </div>
    );
  }

  if (loading && !board) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 34, marginBottom: 20 }} />
        <span className="skel" style={{ width: "100%", height: 420, borderRadius: 14 }} />
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="page">
        <div className="form-error">{error || "Whiteboard not found."}</div>
        <Link href="/whiteboards" className="btn btn-soft">Back to Whiteboards</Link>
      </div>
    );
  }

  const editableSpaces = tree.filter((s) => permissionAtLeast(s.myPermission, "edit"));
  const selected = selectedId ? elements.find((e) => e.id === selectedId) : undefined;
  const editing = editingId ? elements.find((e) => e.id === editingId) : undefined;
  const hz = 6 / cam.z; // half handle size in world units

  const cursor = panning
    ? "grabbing"
    : spaceDown
      ? "grab"
      : tool !== "select"
        ? "crosshair"
        : "default";

  return (
    <div className="wb-shell">
      {/* -------- header -------- */}
      <header className="wb-head">
        <Link href="/whiteboards" className="doc-crumb" title="All whiteboards">
          {Icons.whiteboard}
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
            title={canEdit ? "Rename whiteboard" : board.name}
            onClick={() => {
              if (!canEdit) return;
              setNameDraft(board.name);
              setEditingName(true);
            }}
          >
            {board.name}
          </button>
        )}

        {board.spaceId ? (
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
              <span className="doc-save-dot error" />
              Couldn't save
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
            aria-label="Whiteboard options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {Icons.more}
          </button>
          {menuOpen && (
            <div className="menu doc-menu" onClick={(e) => e.stopPropagation()}>
              {canEdit && !movePick && (
                <button type="button" onClick={() => setMovePick(true)}>
                  {Icons.folder} Move to space…
                </button>
              )}
              {movePick && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setMovePick(false);
                      patchBoard({ spaceId: null });
                    }}
                  >
                    {Icons.globe} Workspace (no space)
                  </button>
                  {editableSpaces.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setMovePick(false);
                        patchBoard({ spaceId: s.id });
                      }}
                    >
                      {Icons.spaces} {s.name}
                    </button>
                  ))}
                </>
              )}
              {canEdit && !movePick && (
                <button type="button" className="danger" onClick={deleteBoard}>
                  {Icons.trash} Delete whiteboard
                </button>
              )}
              {!canEdit && <span className="doc-menu-note">You have view access to this board.</span>}
            </div>
          )}
        </span>
      </header>

      {/* -------- canvas -------- */}
      <div ref={wrapRef} className="wb-canvas-wrap" style={{ cursor }}>
        <svg
          className="wb-canvas"
          onPointerDown={onCanvasPointerDown}
          onDragStart={(e) => e.preventDefault()}
        >
          {/* dot grid, in world space so it pans/zooms with the content */}
          <defs>
            <pattern
              id="wb-grid"
              width={28 * cam.z}
              height={28 * cam.z}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${cam.x} ${cam.y})`}
            >
              <circle cx={1.1} cy={1.1} r={1.1} className="wb-grid-dot" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wb-grid)" pointerEvents="none" />

          <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
            {elements.map((el) => (
              <g
                key={el.id}
                className={`wb-el${tool === "select" ? " selectable" : ""}`}
                onPointerDown={(e) => onElementPointerDown(e, el)}
                onDoubleClick={() => openEditor(el)}
              >
                <ElementBody el={el} hideText={editingId === el.id} />
              </g>
            ))}

            {/* selection chrome */}
            {selected && selected.kind !== "arrow" && (
              <g className="wb-selection" pointerEvents="none">
                <rect
                  x={selected.x - 2 / cam.z}
                  y={selected.y - 2 / cam.z}
                  width={selected.w + 4 / cam.z}
                  height={selected.h + 4 / cam.z}
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth={1.6 / cam.z}
                />
              </g>
            )}
            {selected &&
              selected.kind !== "arrow" &&
              canEdit &&
              (["nw", "ne", "sw", "se"] as const).map((corner) => {
                const cx = corner.includes("w") ? selected.x : selected.x + selected.w;
                const cy = corner.includes("n") ? selected.y : selected.y + selected.h;
                return (
                  <rect
                    key={corner}
                    className="wb-handle"
                    x={cx - hz}
                    y={cy - hz}
                    width={hz * 2}
                    height={hz * 2}
                    style={{ cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }}
                    onPointerDown={(e) => onHandlePointerDown(e, selected, corner)}
                  />
                );
              })}
            {selected &&
              selected.kind === "arrow" &&
              (selected.points ?? []).map((pt, i) => (
                <circle
                  key={i}
                  className="wb-handle wb-handle-pt"
                  cx={pt.x}
                  cy={pt.y}
                  r={canEdit ? 7 / cam.z : 4 / cam.z}
                  style={{ cursor: canEdit ? "move" : "default" }}
                  onPointerDown={(e) => canEdit && onArrowPointPointerDown(e, selected, i)}
                />
              ))}
          </g>
        </svg>

        {/* -------- floating toolbar -------- */}
        {canEdit && (
          <div className="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
            {TOOL_META.map((t) => (
              <button
                key={t.tool}
                type="button"
                className={`wb-tool${tool === t.tool ? " active" : ""}`}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
                aria-pressed={tool === t.tool}
                onClick={() => setTool(t.tool)}
              >
                {t.icon}
              </button>
            ))}
            <span className="wb-tool-sep" />
            <div className="wb-swatches">
              {WB_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`wb-swatch${color === c ? " active" : ""}`}
                  style={{ background: c }}
                  title="Color"
                  aria-label={`Color ${c}`}
                  onClick={() => {
                    setColor(c);
                    // Recolor the selection in place.
                    if (selectedRef.current) {
                      pushUndo();
                      patchElement(selectedRef.current, { color: c });
                      markDirty();
                    }
                  }}
                />
              ))}
            </div>
            <span className="wb-tool-sep" />
            <button
              type="button"
              className="wb-tool wb-tool-danger"
              title="Delete selection (⌫)"
              aria-label="Delete selection"
              disabled={!selectedId}
              onClick={deleteSelected}
            >
              {Icons.trash}
            </button>
          </div>
        )}

        {/* -------- zoom cluster -------- */}
        <div className="wb-zoom">
          <button type="button" className="wb-zoom-btn" title="Zoom out" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>
            −
          </button>
          <button type="button" className="wb-zoom-pct" title="Fit to content" onClick={() => fitView()}>
            {Math.round(cam.z * 100)}%
          </button>
          <button type="button" className="wb-zoom-btn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>
            +
          </button>
        </div>

        {/* -------- empty hint -------- */}
        {elements.length === 0 && canEdit && (
          <div className="wb-hint">
            Pick a tool on the left — click drops a shape, dragging sizes it.
          </div>
        )}

        {/* -------- inline text editor overlay -------- */}
        {editing && editing.kind !== "arrow" && (
          <textarea
            key={editing.id}
            className={`wb-editor wb-editor-${editing.kind}`}
            style={{
              left: cam.x + editing.x * cam.z,
              top: cam.y + editing.y * cam.z,
              width: editing.w * cam.z,
              height: editing.h * cam.z,
              fontSize: (editing.fontSize ?? (editing.kind === "text" ? 18 : 14)) * cam.z,
              color: editing.kind === "sticky" ? STICKY_INK : undefined,
            }}
            value={draft}
            autoFocus
            placeholder={editing.kind === "text" ? "Type something…" : ""}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEditor}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                commitEditor();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function WhiteboardPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 34 }} />
        </div>
      }
    >
      <WhiteboardView />
    </Suspense>
  );
}
