"use client";

/**
 * Module 7 — the Doc editor. `/doc?id=<docId>` (static export: no [id] routes).
 *
 * Left: the doc's pages as a nested tree (built client-side from the flat
 * list) with add / inline-rename / move / delete. Right: a calm rich-text
 * editor — one contentEditable surface, a slim sticky toolbar driven by
 * `document.execCommand` (deprecated but dependency-free and fine here),
 * and an 800ms debounced autosave with a subtle "Saving… / Saved" pill.
 *
 * Live updates: `doc.changed` events refresh the page tree, and refetch the
 * open page's content when someone ELSE edited it (heuristic: we haven't
 * typed in the last 2s). There is no CRDT/OT merge — concurrent edits are
 * last-write-wins, so a remote refetch simply replaces the local buffer.
 */

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  getUser,
  docsApi,
  permissionAtLeast,
  type Doc,
  type DocPage,
  type DocPageMeta,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { FavoriteStar } from "@/components/FavoriteStar";
import { PublicShareButton } from "@/components/PublicShareButton";
import { saveEntityAsTemplate } from "@/lib/toast";
import { DOC_EMOJI } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * Page tree (client-side, from the flat meta list).
 * ------------------------------------------------------------------ */
interface PageNode extends DocPageMeta {
  children: PageNode[];
}

function buildTree(pages: DocPageMeta[]): PageNode[] {
  const byId = new Map<string, PageNode>();
  for (const p of pages) byId.set(p.id, { ...p, children: [] });
  const roots: PageNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentPageId ? byId.get(node.parentPageId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: PageNode[]): void => {
    nodes.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Siblings of a page (same parent), in tree order. */
function siblingsOf(pages: DocPageMeta[], pageId: string): DocPageMeta[] {
  const me = pages.find((p) => p.id === pageId);
  if (!me) return [];
  return pages
    .filter((p) => (p.parentPageId ?? null) === (me.parentPageId ?? null))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

/* ------------------------------------------------------------------ *
 * Toolbar — execCommand + selectionchange state sync.
 * ------------------------------------------------------------------ */
interface ToolState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: string;
  ul: boolean;
  ol: boolean;
}

const EMPTY_TOOLS: ToolState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  block: "p",
  ul: false,
  ol: false,
};

function Toolbar({
  exec,
  editorRef,
}: {
  exec: (cmd: string, value?: string) => void;
  editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [t, setT] = useState<ToolState>(EMPTY_TOOLS);

  // Keep button states in sync with the caret. selectionchange fires a lot
  // but queryCommandState is cheap; we bail early when focus is elsewhere.
  useEffect(() => {
    const update = (): void => {
      const el = editorRef.current;
      if (!el || !el.contains(document.getSelection()?.anchorNode ?? null)) return;
      try {
        setT({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
          underline: document.queryCommandState("underline"),
          strike: document.queryCommandState("strikeThrough"),
          block: (document.queryCommandValue("formatBlock") || "p").toLowerCase(),
          ul: document.queryCommandState("insertUnorderedList"),
          ol: document.queryCommandState("insertOrderedList"),
        });
      } catch {
        /* selection in a weird place — keep the last state */
      }
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [editorRef]);

  const block = (tag: string): void => {
    // Toggle back to a paragraph when the block is already applied.
    exec("formatBlock", t.block === tag ? "<p>" : `<${tag}>`);
  };

  const link = (): void => {
    const url = window.prompt("Link URL", "https://");
    if (!url || url === "https://") return;
    exec("createLink", url);
  };

  const clear = (): void => {
    exec("removeFormat");
    exec("unlink");
    exec("formatBlock", "<p>");
  };

  const B = ({
    on,
    label,
    title,
    onClick,
    className,
  }: {
    on?: boolean;
    label: React.ReactNode;
    title: string;
    onClick: () => void;
    className?: string;
  }) => (
    <button
      type="button"
      className={`dt-btn${on ? " on" : ""}${className ? ` ${className}` : ""}`}
      title={title}
      aria-pressed={on ?? false}
      onMouseDown={(e) => e.preventDefault() /* keep the editor selection */}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      <div className="dt-group">
        <B on={t.bold} label={<strong>B</strong>} title="Bold (⌘B)" onClick={() => exec("bold")} />
        <B on={t.italic} label={<em>I</em>} title="Italic (⌘I)" onClick={() => exec("italic")} />
        <B on={t.underline} label={<u>U</u>} title="Underline (⌘U)" onClick={() => exec("underline")} />
        <B on={t.strike} label={<s>S</s>} title="Strikethrough" onClick={() => exec("strikeThrough")} />
      </div>
      <span className="dt-sep" />
      <div className="dt-group">
        <B on={t.block === "h1"} label="H1" title="Heading 1" onClick={() => block("h1")} />
        <B on={t.block === "h2"} label="H2" title="Heading 2" onClick={() => block("h2")} />
        <B on={t.block === "h3"} label="H3" title="Heading 3" onClick={() => block("h3")} />
      </div>
      <span className="dt-sep" />
      <div className="dt-group">
        <B on={t.ul} label="•≡" title="Bulleted list" onClick={() => exec("insertUnorderedList")} />
        <B on={t.ol} label="1≡" title="Numbered list" onClick={() => exec("insertOrderedList")} />
        <B
          on={t.block === "blockquote"}
          label="❝"
          title="Quote"
          onClick={() => block("blockquote")}
        />
        <B
          on={t.block === "pre"}
          label="</>"
          title="Code block"
          className="dt-code"
          onClick={() => block("pre")}
        />
      </div>
      <span className="dt-sep" />
      <div className="dt-group">
        <B label={Icons.link} title="Link" onClick={link} />
        <B label="⌫" title="Clear formatting" onClick={clear} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tree rail row (recursive).
 * ------------------------------------------------------------------ */
function TreeNode({
  node,
  depth,
  selectedId,
  collapsed,
  canEdit,
  siblingIndex,
  siblingCount,
  onSelect,
  onToggle,
  onAddChild,
  onRename,
  onMove,
  onDelete,
  renamingId,
  setRenamingId,
  menuId,
  setMenuId,
}: {
  node: PageNode;
  depth: number;
  selectedId: string | null;
  collapsed: Set<string>;
  canEdit: boolean;
  siblingIndex: number;
  siblingCount: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  menuId: string | null;
  setMenuId: (id: string | null) => void;
}) {
  const isCollapsed = collapsed.has(node.id);
  const renaming = renamingId === node.id;
  const [draft, setDraft] = useState(node.title);

  useEffect(() => {
    if (renaming) setDraft(node.title);
  }, [renaming, node.title]);

  const commitRename = (): void => {
    setRenamingId(null);
    const title = draft.trim();
    if (title && title !== node.title) onRename(node.id, title);
  };

  return (
    <div className="dp-branch">
      <div
        className={`dp-row${selectedId === node.id ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.id)}
        onDoubleClick={(e) => {
          if (!canEdit) return;
          e.stopPropagation();
          setRenamingId(node.id);
        }}
      >
        <button
          type="button"
          className={`dp-caret${node.children.length === 0 ? " leaf" : ""}${isCollapsed ? "" : " open"}`}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          tabIndex={node.children.length === 0 ? -1 : 0}
          onClick={(e) => {
            e.stopPropagation();
            if (node.children.length > 0) onToggle(node.id);
          }}
        >
          {Icons.chevronRight}
        </button>

        {renaming ? (
          <input
            className="dp-rename"
            value={draft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") setRenamingId(null);
            }}
          />
        ) : (
          <span className="dp-title">{node.title || "Untitled"}</span>
        )}

        {canEdit && !renaming && (
          <span className="dp-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="dp-act"
              title="Add subpage"
              aria-label="Add subpage"
              onClick={() => onAddChild(node.id)}
            >
              {Icons.plus}
            </button>
            <span className="dp-menu-wrap">
              <button
                type="button"
                className="dp-act"
                title="Page options"
                aria-label="Page options"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId(menuId === node.id ? null : node.id);
                }}
              >
                {Icons.more}
              </button>
              {menuId === node.id && (
                <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuId(null);
                      setRenamingId(node.id);
                    }}
                  >
                    {Icons.edit} Rename
                  </button>
                  <button
                    type="button"
                    disabled={siblingIndex === 0}
                    onClick={() => {
                      setMenuId(null);
                      onMove(node.id, -1);
                    }}
                  >
                    {Icons.arrowUp} Move up
                  </button>
                  <button
                    type="button"
                    disabled={siblingIndex >= siblingCount - 1}
                    onClick={() => {
                      setMenuId(null);
                      onMove(node.id, 1);
                    }}
                  >
                    {Icons.arrowDown} Move down
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setMenuId(null);
                      onDelete(node.id);
                    }}
                  >
                    {Icons.trash} Delete
                  </button>
                </div>
              )}
            </span>
          </span>
        )}
      </div>

      {!isCollapsed &&
        node.children.map((child, i) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            collapsed={collapsed}
            canEdit={canEdit}
            siblingIndex={i}
            siblingCount={node.children.length}
            onSelect={onSelect}
            onToggle={onToggle}
            onAddChild={onAddChild}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
            renamingId={renamingId}
            setRenamingId={setRenamingId}
            menuId={menuId}
            setMenuId={setMenuId}
          />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The doc view.
 * ------------------------------------------------------------------ */
type SaveState = "idle" | "saving" | "saved" | "error";

function DocView() {
  const search = useSearchParams();
  const router = useRouter();
  const docId = search.get("id");
  const { tree } = useHierarchy();

  const [doc, setDoc] = useState<Doc | null>(null);
  const [pages, setPages] = useState<DocPageMeta[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<DocPage | null>(null);
  const [pageError, setPageError] = useState("");
  const [title, setTitle] = useState("");
  const [contentVersion, setContentVersion] = useState(0);
  const [saveError, setSaveError] = useState("");

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  const [docMenu, setDocMenu] = useState(false);
  const [iconPick, setIconPick] = useState(false);
  const [movePick, setMovePick] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const [saveState, setSaveState] = useState<SaveState>("idle");

  const editorRef = useRef<HTMLDivElement | null>(null);
  const dirtyRef = useRef(false);
  /** A remote edit arrived while typing — apply it once the editor is idle. */
  const pendingRemoteRef = useRef(false);
  /** Mirror of the live buffer — survives ref detach so the unmount flush works. */
  const latestHtmlRef = useRef<string>("");
  const lastEditRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monotonic save id — only the newest response may update UI state. */
  const saveSeqRef = useRef(0);
  const flushRef = useRef<(() => void) | null>(null);
  const refetchOpenPageRef = useRef<(() => void) | null>(null);
  const pageIdRef = useRef<string | null>(null);
  pageIdRef.current = page?.id ?? null;

  /* ---- permissions: attached docs follow the space's grant ---- */
  const space = doc?.spaceId ? tree.find((s) => s.id === doc.spaceId) : null;
  const canEdit = doc
    ? !doc.spaceId || (space ? permissionAtLeast(space.myPermission, "edit") : false)
    : false;

  /* ---- data loading ---- */
  const loadDoc = useCallback((): void => {
    if (!docId) return;
    docsApi
      .get(docId)
      .then((r) => {
        setDoc(r.doc);
        setPages(r.pages);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this doc."),
      )
      .finally(() => setLoading(false));
  }, [docId]);

  useEffect(loadDoc, [loadDoc]);

  // Keep a valid selection: first root page by default, recover on delete.
  const roots = useMemo(() => buildTree(pages), [pages]);
  useEffect(() => {
    if (pages.length === 0) return;
    if (!selectedId || !pages.some((p) => p.id === selectedId)) {
      setSelectedId(roots[0]?.id ?? pages[0].id);
    }
  }, [pages, roots, selectedId]);

  // Fetch the selected page's content.
  useEffect(() => {
    if (!selectedId) return;
    let stale = false;
    setPageError("");
    docsApi
      .getPage(selectedId)
      .then((r) => {
        if (stale) return;
        setPage(r.page);
        setTitle(r.page.title);
        setContentVersion((v) => v + 1);
        setSaveState("idle");
      })
      .catch((err) => {
        if (!stale)
          setPageError(
            err instanceof ApiError ? err.message : "Couldn't load this page.",
          );
      });
    return () => {
      stale = true;
    };
  }, [selectedId]);

  /* ---- autosave ---- */
  const flushNow = useCallback((): void => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirtyRef.current || !pageIdRef.current) return;
    // editorRef is already null during unmount cleanup — fall back to the
    // mirror so navigating away never loses the last keystrokes.
    const html = editorRef.current?.innerHTML ?? latestHtmlRef.current;
    if (!html && !editorRef.current) return;
    const id = pageIdRef.current;
    dirtyRef.current = false;
    // Sequence saves: a slow request must never let an older payload land
    // after a newer one (that would silently resurrect stale text).
    const seq = ++saveSeqRef.current;
    setSaveState("saving");
    docsApi
      .updatePage(id, { content: html })
      .then(() => {
        if (seq !== saveSeqRef.current) return; // superseded by a newer save
        setSaveState("saved");
        setSaveError("");
        // A remote edit that arrived mid-typing can now be applied safely.
        if (pendingRemoteRef.current && !dirtyRef.current) refetchOpenPageRef.current?.();
      })
      .catch((err) => {
        if (seq !== saveSeqRef.current) return;
        // Keep the text dirty so the next flush retries it, and SAY so —
        // a silent failure is what makes writing look like it vanished.
        dirtyRef.current = true;
        setSaveState("error");
        setSaveError(
          err instanceof ApiError ? err.message : "Couldn't save — will retry.",
        );
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => flushRef.current?.(), 4000);
      });
  }, []);

  const markDirty = useCallback((): void => {
    dirtyRef.current = true;
    if (editorRef.current) latestHtmlRef.current = editorRef.current.innerHTML;
    lastEditRef.current = Date.now();
    setSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushNow, 800);
  }, [flushNow]);

  // Save any pending edit when leaving the page entirely.
  useEffect(() => flushNow, [flushNow]);

  // Closing the tab / backgrounding the app (mobile) is the last chance to
  // persist — 'pagehide' fires where 'beforeunload' is unreliable on iOS.
  useEffect(() => {
    const save = (): void => flushNow();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") save();
    });
    return () => {
      window.removeEventListener("pagehide", save);
    };
  }, [flushNow]);

  // Mirror the callbacks into refs so the save routine can call the latest
  // versions without re-creating itself (which would restart the debounce).
  useEffect(() => {
    flushRef.current = flushNow;
  }, [flushNow]);
  /**
   * Leaving the editor is the safe moment to apply a remote edit that landed
   * while typing (the realtime handler deferred it).
   */
  const handleBlur = useCallback((): void => {
    flushNow();
    if (pendingRemoteRef.current && !dirtyRef.current) {
      window.setTimeout(() => {
        if (!dirtyRef.current) refetchOpenPageRef.current?.();
      }, 400);
    }
  }, [flushNow]);

  const exec = useCallback(
    (cmd: string, value?: string): void => {
      editorRef.current?.focus();
      try {
        // Emit <span style> rather than <font>: the server's allow-list keeps
        // styles but drops <font>, which is why colour/size formatting used
        // to disappear after a reload.
        document.execCommand("styleWithCSS", false, "true");
        document.execCommand(cmd, false, value);
      } catch {
        /* unsupported command — ignore */
      }
      markDirty();
    },
    [markDirty],
  );

  /* ---- page selection (flush the old buffer first) ---- */
  const selectPage = (id: string): void => {
    if (id === selectedId) return;
    flushNow();
    setRailOpen(false);
    setSelectedId(id);
  };

  /* ---- tree mutations ---- */
  const addPage = (parentPageId: string | null): void => {
    if (!docId) return;
    flushNow();
    docsApi
      .createPage(docId, { parentPageId })
      .then((r) => {
        setPages((prev) => [
          ...prev,
          {
            id: r.page.id,
            parentPageId: r.page.parentPageId,
            title: r.page.title,
            position: r.page.position,
            updatedAt: r.page.updatedAt,
          },
        ]);
        if (parentPageId) {
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(parentPageId);
            return next;
          });
        }
        setSelectedId(r.page.id);
        setRenamingId(r.page.id);
      })
      .catch(() => undefined);
  };

  const renamePage = (id: string, newTitle: string): void => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, title: newTitle } : p)));
    if (page?.id === id) {
      setPage({ ...page, title: newTitle });
      setTitle(newTitle);
    }
    docsApi.updatePage(id, { title: newTitle }).catch(loadDoc);
  };

  const movePage = (id: string, dir: -1 | 1): void => {
    const sibs = siblingsOf(pages, id);
    const idx = sibs.findIndex((p) => p.id === id);
    const swap = sibs[idx + dir];
    if (idx < 0 || !swap) return;
    // Optimistic swap of the two sort keys, then reconcile with the server.
    setPages((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, position: swap.position }
          : p.id === swap.id
            ? { ...p, position: sibs[idx].position }
            : p,
      ),
    );
    docsApi.updatePage(id, { position: swap.position }).then(loadDoc).catch(loadDoc);
  };

  const deletePage = (id: string): void => {
    if (pages.length <= 1) {
      window.alert("A doc always keeps at least one page.");
      return;
    }
    const target = pages.find((p) => p.id === id);
    if (!window.confirm(`Delete “${target?.title || "Untitled"}” and its subpages?`)) return;
    docsApi
      .removePage(id)
      .then(loadDoc)
      .catch((err) =>
        window.alert(err instanceof ApiError ? err.message : "Couldn't delete the page."),
      );
  };

  /* ---- title save ---- */
  const commitTitle = (): void => {
    if (!page) return;
    const t = title.trim() || "Untitled";
    if (t !== page.title) renamePage(page.id, t);
    else setTitle(page.title);
  };

  /* ---- doc header actions ---- */
  const patchDoc = (body: Parameters<typeof docsApi.update>[1]): void => {
    if (!doc) return;
    docsApi
      .update(doc.id, body)
      .then((r) => setDoc(r.doc))
      .catch(loadDoc);
  };

  const commitDocName = (): void => {
    setEditingName(false);
    const n = nameDraft.trim();
    if (doc && n && n !== doc.name) patchDoc({ name: n });
  };

  const deleteDoc = (): void => {
    if (!doc) return;
    if (!window.confirm(`Delete “${doc.name}” and all of its pages?`)) return;
    docsApi
      .remove(doc.id)
      .then(() => router.push("/docs"))
      .catch(() => window.alert("Couldn't delete the doc."));
  };

  /**
   * Pull the open page from the server and re-seed the editor. Only ever
   * called when the editor is NOT in use (see the realtime handler).
   */
  const refetchOpenPage = useCallback((): void => {
    const id = pageIdRef.current;
    if (!id) return;
    pendingRemoteRef.current = false;
    docsApi
      .getPage(id)
      .then((r) => {
        if (pageIdRef.current !== r.page.id) return;
        // Re-check on ARRIVAL: typing may have resumed while this was in
        // flight, and remounting now would wipe those keystrokes.
        const busyNow =
          dirtyRef.current ||
          Date.now() - lastEditRef.current < 3000 ||
          (typeof document !== "undefined" &&
            editorRef.current !== null &&
            document.activeElement === editorRef.current);
        if (busyNow) {
          pendingRemoteRef.current = true;
          return;
        }
        // A no-op refetch must not remount either (it would drop the caret).
        if (editorRef.current && r.page.content === editorRef.current.innerHTML) {
          setPage(r.page);
          setTitle(r.page.title);
          return;
        }
        setPage(r.page);
        setTitle(r.page.title);
        setContentVersion((v) => v + 1);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refetchOpenPageRef.current = refetchOpenPage;
  }, [refetchOpenPage]);

  /* ---- realtime ---- */
  useRealtime(
    (e) => {
      if (e.type !== "doc.changed" || !docId || e.payload.docId !== docId) return;
      // OUR OWN autosave echoes back here. Re-seeding the buffer on that echo
      // destroys the caret and drops whatever was typed since the save — the
      // "shaky editor / disappearing text" bug. Ignore anything we caused.
      const actorId = (e.payload as { actorUserId?: string }).actorUserId;
      if (actorId && actorId === getUser()?.id) return;

      // Someone else touched this doc — refresh the tree (titles, order).
      loadDoc();

      // Only re-seed the OPEN page from a remote edit, and never while this
      // editor is in use: a focused or dirty buffer keeps what the user is
      // writing. The refresh is deferred to the next blur rather than lost.
      if (e.payload.pageId !== pageIdRef.current) return;
      const editorBusy =
        dirtyRef.current ||
        Date.now() - lastEditRef.current < 3000 ||
        (typeof document !== "undefined" &&
          editorRef.current !== null &&
          document.activeElement === editorRef.current);
      if (editorBusy) {
        pendingRemoteRef.current = true;
        return;
      }
      refetchOpenPage();
    },
    [docId, loadDoc, refetchOpenPage],
  );

  // Click-away closes any open menu/popovers.
  useEffect(() => {
    if (!menuId && !docMenu && !iconPick && !movePick) return;
    const close = (): void => {
      setMenuId(null);
      setDocMenu(false);
      setIconPick(false);
      setMovePick(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuId, docMenu, iconPick, movePick]);

  /* ---- render ---- */
  if (!docId) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.docs}</span>
          <h3>No doc selected</h3>
          <p>Pick a doc from the Docs page to start reading or writing.</p>
          <Link href="/docs" className="btn btn-soft">Browse docs</Link>
        </div>
      </div>
    );
  }

  if (loading && !doc) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 34, marginBottom: 20 }} />
        <span className="skel" style={{ width: "100%", height: 18, marginBottom: 10 }} />
        <span className="skel" style={{ width: "88%", height: 18, marginBottom: 10 }} />
        <span className="skel" style={{ width: "70%", height: 18 }} />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="page">
        <div className="form-error">{error || "Doc not found."}</div>
        <Link href="/docs" className="btn btn-soft">Back to Docs</Link>
      </div>
    );
  }

  const editableSpaces = tree.filter((s) => permissionAtLeast(s.myPermission, "edit"));

  return (
    <div className="doc-shell">
      {/* -------- page tree rail -------- */}
      <aside className={`doc-tree${railOpen ? " open" : ""}`}>
        <div className="doc-tree-head">
          <span className="doc-tree-title">Pages</span>
          {canEdit && (
            <button
              type="button"
              className="dp-act"
              title="Add page"
              aria-label="Add page"
              onClick={() => addPage(null)}
            >
              {Icons.plus}
            </button>
          )}
        </div>
        <div className="doc-tree-scroll">
          {roots.map((node, i) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              collapsed={collapsed}
              canEdit={canEdit}
              siblingIndex={i}
              siblingCount={roots.length}
              onSelect={selectPage}
              onToggle={(id) =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onAddChild={addPage}
              onRename={renamePage}
              onMove={movePage}
              onDelete={deletePage}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              menuId={menuId}
              setMenuId={setMenuId}
            />
          ))}
        </div>
      </aside>
      <div
        className={`doc-tree-scrim${railOpen ? " show" : ""}`}
        onClick={() => setRailOpen(false)}
        aria-hidden="true"
      />

      {/* -------- editor column -------- */}
      <div className="doc-main">
        <header className="doc-head">
          <button
            type="button"
            className="doc-rail-btn"
            aria-label="Pages"
            onClick={() => setRailOpen((v) => !v)}
          >
            {Icons.list}
          </button>

          <Link href="/docs" className="doc-crumb" title="All docs">
            {Icons.docs}
          </Link>
          <span className="doc-crumb-sep">/</span>

          <span className="doc-icon-wrap">
            <button
              type="button"
              className="doc-icon-btn"
              aria-label="Change icon"
              disabled={!canEdit}
              onClick={(e) => {
                e.stopPropagation();
                setIconPick((v) => !v);
                setDocMenu(false);
              }}
            >
              {doc.icon || "📄"}
            </button>
            {iconPick && (
              <div className="doc-emoji-pop" onClick={(e) => e.stopPropagation()}>
                {DOC_EMOJI.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className={`emoji-opt${doc.icon === em ? " active" : ""}`}
                    onClick={() => {
                      setIconPick(false);
                      patchDoc({ icon: em });
                    }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </span>

          {editingName ? (
            <input
              className="doc-name-input"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitDocName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDocName();
                else if (e.key === "Escape") setEditingName(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="doc-name"
              title={canEdit ? "Rename doc" : doc.name}
              onClick={() => {
                if (!canEdit) return;
                setNameDraft(doc.name);
                setEditingName(true);
              }}
            >
              {doc.name}
            </button>
          )}

          {doc.spaceId ? (
            <span className="doc-chip doc-chip-space">{doc.spaceName ?? space?.name ?? "Space"}</span>
          ) : doc.isPrivate ? (
            <span className="doc-chip doc-chip-private">{Icons.lock} Private</span>
          ) : (
            <span className="doc-chip">{Icons.globe} Workspace</span>
          )}
          {!canEdit && <span className="doc-chip doc-chip-ro">{Icons.eye} Read-only</span>}

          <FavoriteStar type="doc" id={doc.id} name={doc.name} />
          <PublicShareButton type="doc" id={doc.id} name={doc.name} />

          <span className="doc-head-spacer" />

          <span
            className={`doc-save${saveState === "idle" ? " hidden" : ""}`}
            aria-live="polite"
          >
            {saveState === "saving" ? (
              <>
                <span className="doc-save-dot pulsing" />
                Saving…
              </>
            ) : saveState === "error" ? (
              <button
                type="button"
                className="doc-save-retry"
                title={saveError || "Retry now"}
                onClick={() => flushNow()}
              >
                <span className="doc-save-dot failed" />
                Not saved — retry
              </button>
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
              aria-label="Doc options"
              onClick={(e) => {
                e.stopPropagation();
                setDocMenu((v) => !v);
                setIconPick(false);
              }}
            >
              {Icons.more}
            </button>
            {docMenu && (
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
                        setDocMenu(false);
                        setMovePick(false);
                        patchDoc({ spaceId: null });
                      }}
                    >
                      {Icons.globe} Workspace (no space)
                    </button>
                    {editableSpaces.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setDocMenu(false);
                          setMovePick(false);
                          patchDoc({ spaceId: s.id, isPrivate: false });
                        }}
                      >
                        {Icons.spaces} {s.name}
                      </button>
                    ))}
                  </>
                )}
                {canEdit && !doc.spaceId && !movePick && (
                  <button
                    type="button"
                    onClick={() => {
                      setDocMenu(false);
                      patchDoc({ isPrivate: !doc.isPrivate });
                    }}
                  >
                    {doc.isPrivate ? (
                      <>{Icons.globe} Make workspace-visible</>
                    ) : (
                      <>{Icons.lock} Make private</>
                    )}
                  </button>
                )}
                {canEdit && !movePick && (
                  <button
                    type="button"
                    onClick={() => {
                      setDocMenu(false);
                      void saveEntityAsTemplate("doc", doc.id, `${doc.name} template`);
                    }}
                  >
                    {Icons.copy} Save as template
                  </button>
                )}
                {canEdit && !movePick && (
                  <button type="button" className="danger" onClick={deleteDoc}>
                    {Icons.trash} Delete doc
                  </button>
                )}
                {!canEdit && (
                  <span className="doc-menu-note">You have view access to this doc.</span>
                )}
              </div>
            )}
          </span>
        </header>

        {canEdit && page && <Toolbar exec={exec} editorRef={editorRef} />}

        <div className="doc-scroll">
          {pageError ? (
            <div className="doc-page-pad">
              <div className="form-error">{pageError}</div>
            </div>
          ) : !page ? (
            <div className="doc-page-pad">
              <span className="skel" style={{ width: 320, height: 38, marginBottom: 22 }} />
              <span className="skel" style={{ width: "100%", height: 16, marginBottom: 10 }} />
              <span className="skel" style={{ width: "82%", height: 16 }} />
            </div>
          ) : (
            <div className="doc-page-pad">
              <input
                className="doc-title"
                placeholder="Untitled"
                value={title}
                readOnly={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTitle();
                    editorRef.current?.focus();
                  }
                }}
              />
              {/*
               * The buffer is seeded once per page/version via
               * dangerouslySetInnerHTML (server-sanitized HTML) and then owned
               * by the browser — React never reconciles the typing. The key
               * remounts it on page switch or remote refetch.
               */}
              <div
                key={`${page.id}:${contentVersion}`}
                ref={editorRef}
                className={`doc-prose${canEdit ? "" : " readonly"}`}
                contentEditable={canEdit}
                suppressContentEditableWarning
                spellCheck
                data-placeholder="Start writing — or press / on your keyboard someday. For now, just write."
                dangerouslySetInnerHTML={{ __html: page.content || "" }}
                onInput={markDirty}
                onBlur={handleBlur}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DocPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 34 }} />
        </div>
      }
    >
      <DocView />
    </Suspense>
  );
}
