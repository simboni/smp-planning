"use client";

/**
 * The Spaces tree — the navigational spine of StackUp, living in the sidebar.
 *
 * Renders Spaces → Folders → Lists with ClickUp-style inline interactions:
 *   - click a row to expand/collapse (persisted in localStorage)
 *   - hover `+` to add a child, `⋯` for the full action menu
 *   - inline text inputs for create + rename (Enter = commit, Esc = cancel)
 *   - a small swatch popover for "change color"
 *   - native HTML5 drag-and-drop to reorder within a container, plus
 *     "Move up / Move down" menu items as a always-works fallback
 *
 * All mutations hit `hierarchyApi` and then `reload()` the shared tree so the
 * sidebar and the space/list pages stay in sync; reorder is optimistic.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  hierarchyApi,
  type FolderWithLists,
  type List,
  type SpaceTree,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";

const EXPANDED_KEY = "stackup.tree.expanded";

/** On-brand swatches for the color popover. */
const SWATCHES = [
  "#7B68EE",
  "#5B5FEF",
  "#00B8D9",
  "#36B37E",
  "#FFAB00",
  "#FF7452",
  "#E5578C",
  "#8777D9",
];

/* Persisted expand/collapse set --------------------------------------- */
function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}
function saveExpanded(set: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/* Drag payload --------------------------------------------------------- */
type DragKind = "space" | "folder" | "list";
interface DragState {
  kind: DragKind;
  id: string;
  container: string; // only reorder within an identical container key
}

type CreateCtx =
  | { type: "space" }
  | { type: "folder"; spaceId: string }
  | { type: "list"; spaceId: string; folderId: string | null };

/** Inline create/rename field. Hoisted to module scope so it keeps focus
 *  across parent re-renders. Enter commits, Esc cancels, blur commits — each
 *  guarded so it only fires once. */
function InlineInput({
  placeholder,
  initial = "",
  onCommit,
  onCancel,
  indent,
}: {
  placeholder: string;
  initial?: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  indent: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = (v: string): void => {
    if (done.current) return;
    done.current = true;
    onCommit(v);
  };
  const cancel = (): void => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  return (
    <div className="tree-input-row" style={{ paddingLeft: indent }}>
      <input
        ref={ref}
        className="tree-input"
        defaultValue={initial}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          else if (e.key === "Escape") cancel();
        }}
        onBlur={(e) => commit(e.target.value)}
      />
    </div>
  );
}

export function HierarchyTree() {
  const { tree, loading, error, reload, setTree } = useHierarchy();
  const pathname = usePathname();
  const search = useSearchParams();
  const activeListId = pathname === "/list" ? search.get("id") : null;
  const activeSpaceId = pathname === "/space" ? search.get("id") : null;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<CreateCtx | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null); // "space:id" | "folder:id" | "list:id"
  const [menu, setMenu] = useState<string | null>(null); // same key form
  const [colorFor_, setColorPicker] = useState<string | null>(null); // "space:id" | "list:id"
  const [busy, setBusy] = useState(false);
  const drag = useRef<DragState | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(loadExpanded());
  }, []);

  // Close menus / popovers on outside click.
  useEffect(() => {
    if (!menu && !colorFor_) return;
    const close = (): void => {
      setMenu(null);
      setColorPicker(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu, colorFor_]);

  const isOpen = (id: string): boolean => expanded.has(id);
  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpanded(next);
      return next;
    });
  };
  const ensureOpen = (id: string): void => {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveExpanded(next);
      return next;
    });
  };

  /* -- mutations ----------------------------------------------------- */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch {
      await reload(); // resync on failure
    } finally {
      setBusy(false);
    }
  };

  const commitCreate = async (name: string): Promise<void> => {
    const ctx = creating;
    const trimmed = name.trim();
    setCreating(null);
    if (!ctx || !trimmed) return;
    await run(async () => {
      if (ctx.type === "space") {
        await hierarchyApi.createSpace({ name: trimmed });
      } else if (ctx.type === "folder") {
        ensureOpen(ctx.spaceId);
        await hierarchyApi.createFolder(ctx.spaceId, { name: trimmed });
      } else {
        ensureOpen(ctx.spaceId);
        if (ctx.folderId) ensureOpen(ctx.folderId);
        await hierarchyApi.createList(ctx.spaceId, {
          name: trimmed,
          folderId: ctx.folderId,
        });
      }
    });
  };

  const commitRename = async (key: string, name: string): Promise<void> => {
    const trimmed = name.trim();
    setRenaming(null);
    if (!trimmed) return;
    const [kind, id] = key.split(":");
    await run(async () => {
      if (kind === "space") await hierarchyApi.updateSpace(id, { name: trimmed });
      else if (kind === "folder") await hierarchyApi.updateFolder(id, { name: trimmed });
      else await hierarchyApi.updateList(id, { name: trimmed });
    });
  };

  const doDelete = (kind: DragKind, id: string, label: string): void => {
    setMenu(null);
    const what =
      kind === "space" ? "space (and everything in it)" : kind === "folder" ? "folder (and its lists)" : "list";
    if (!window.confirm(`Delete “${label}” ${what}? This can’t be undone.`)) return;
    void run(async () => {
      if (kind === "space") await hierarchyApi.deleteSpace(id);
      else if (kind === "folder") await hierarchyApi.deleteFolder(id);
      else await hierarchyApi.deleteList(id);
    });
  };

  const doArchive = (kind: DragKind, id: string): void => {
    setMenu(null);
    void run(async () => {
      if (kind === "space") await hierarchyApi.updateSpace(id, { archived: true });
      else if (kind === "folder") await hierarchyApi.updateFolder(id, { archived: true });
      else await hierarchyApi.updateList(id, { archived: true });
    });
  };

  const togglePrivate = (space: SpaceTree): void => {
    setMenu(null);
    void run(() => hierarchyApi.updateSpace(space.id, { isPrivate: !space.isPrivate }));
  };

  const changeColor = (kind: "space" | "list", id: string, color: string): void => {
    setColorPicker(null);
    void run(async () => {
      if (kind === "space") await hierarchyApi.updateSpace(id, { color });
      else await hierarchyApi.updateList(id, { color });
    });
  };

  /* -- reordering (menu-driven, always reliable) --------------------- */
  const move = (list: { id: string }[], id: string, dir: -1 | 1): string[] | null => {
    const ids = list.map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return ids;
  };

  const reorderSpaces = (ids: string[]): void => {
    setTree((prev) => ids.map((id) => prev.find((s) => s.id === id)!).filter(Boolean));
    void hierarchyApi.reorderSpaces(ids).catch(() => void reload());
  };
  const reorderFolders = (spaceId: string, ids: string[]): void => {
    setTree((prev) =>
      prev.map((s) =>
        s.id === spaceId
          ? { ...s, folders: ids.map((id) => s.folders.find((f) => f.id === id)!).filter(Boolean) }
          : s,
      ),
    );
    void hierarchyApi.reorderFolders(spaceId, ids).catch(() => void reload());
  };
  const reorderLists = (spaceId: string, folderId: string | null, ids: string[]): void => {
    setTree((prev) =>
      prev.map((s) => {
        if (s.id !== spaceId) return s;
        if (folderId === null) {
          return { ...s, lists: ids.map((id) => s.lists.find((l) => l.id === id)!).filter(Boolean) };
        }
        return {
          ...s,
          folders: s.folders.map((f) =>
            f.id === folderId
              ? { ...f, lists: ids.map((id) => f.lists.find((l) => l.id === id)!).filter(Boolean) }
              : f,
          ),
        };
      }),
    );
    void hierarchyApi.reorderLists(spaceId, folderId, ids).catch(() => void reload());
  };

  /* -- native drag-and-drop ------------------------------------------ */
  const onDrop = (
    target: { kind: DragKind; id: string; container: string },
    ctx: {
      spaces?: SpaceTree[];
      folders?: FolderWithLists[];
      lists?: List[];
      spaceId?: string;
      folderId?: string | null;
    },
  ): void => {
    const d = drag.current;
    setDragOverKey(null);
    drag.current = null;
    if (!d || d.container !== target.container || d.id === target.id) return;

    const reorderWithin = (items: { id: string }[]): string[] => {
      const ids = items.map((x) => x.id).filter((id) => id !== d.id);
      const at = ids.indexOf(target.id);
      ids.splice(at < 0 ? ids.length : at, 0, d.id);
      return ids;
    };

    if (target.kind === "space" && ctx.spaces) reorderSpaces(reorderWithin(ctx.spaces));
    else if (target.kind === "folder" && ctx.folders && ctx.spaceId)
      reorderFolders(ctx.spaceId, reorderWithin(ctx.folders));
    else if (target.kind === "list" && ctx.lists && ctx.spaceId !== undefined)
      reorderLists(ctx.spaceId, ctx.folderId ?? null, reorderWithin(ctx.lists));
  };

  const dragProps = (
    self: DragState,
    target: Parameters<typeof onDrop>[0],
    ctx: Parameters<typeof onDrop>[1],
  ) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      drag.current = self;
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", self.id);
      } catch {
        /* some browsers require a payload */
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (drag.current && drag.current.container === target.container) {
        e.preventDefault();
        setDragOverKey(`${target.kind}:${target.id}`);
      }
    },
    onDragLeave: () => setDragOverKey((k) => (k === `${target.kind}:${target.id}` ? null : k)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      onDrop(target, ctx);
    },
    onDragEnd: () => {
      drag.current = null;
      setDragOverKey(null);
    },
  });

  /* -- small building blocks ----------------------------------------- */
  const menuKey = (kind: string, id: string): string => `${kind}:${id}`;

  const MenuButton = ({ k, title }: { k: string; title: string }) => (
    <button
      type="button"
      className="tree-act"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setColorPicker(null);
        setMenu((m) => (m === k ? null : k));
      }}
    >
      {Icons.more}
    </button>
  );

  const AddButton = ({ title, onClick }: { title: string; onClick: () => void }) => (
    <button
      type="button"
      className="tree-act"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
    >
      {Icons.plus}
    </button>
  );

  const ColorPopover = ({
    kind,
    id,
  }: {
    kind: "space" | "list";
    id: string;
  }) => (
    <div className="tree-swatches" onClick={(e) => e.stopPropagation()}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className="tree-swatch"
          style={{ background: c }}
          title={c}
          onClick={() => changeColor(kind, id, c)}
        />
      ))}
    </div>
  );

  /* -- render -------------------------------------------------------- */
  const renderList = (
    list: List,
    spaceId: string,
    folderId: string | null,
    bucket: List[],
    indent: number,
  ) => {
    const k = menuKey("list", list.id);
    const container = `lists:${spaceId}:${folderId ?? "root"}`;
    const active = activeListId === list.id;
    const dot = list.color || colorFor(list.id);
    return (
      <div key={list.id} className="tree-item">
        {renaming === k ? (
          <InlineInput
            indent={indent}
            initial={list.name}
            placeholder="List name"
            onCommit={(v) => void commitRename(k, v)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <div
            className={`tree-row${active ? " active" : ""}${
              dragOverKey === `list:${list.id}` ? " dragover" : ""
            }`}
            style={{ paddingLeft: indent }}
            {...dragProps(
              { kind: "list", id: list.id, container },
              { kind: "list", id: list.id, container },
              { lists: bucket, spaceId, folderId },
            )}
          >
            <Link href={`/list?id=${list.id}`} className="tree-label">
              <span className="tree-dot" style={{ background: dot }} />
              <span className="tree-name">{list.name}</span>
            </Link>
            <span className="tree-actions">
              <MenuButton k={k} title="List actions" />
            </span>
            {menu === k && (
              <div className="tree-menu" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setMenu(null); setRenaming(k); }}>
                  {Icons.edit} Rename
                </button>
                <button type="button" onClick={() => { setMenu(null); setColorPicker(k); }}>
                  {Icons.palette} Change color
                </button>
                <button
                  type="button"
                  onClick={() => { const ids = move(bucket, list.id, -1); if (ids) reorderLists(spaceId, folderId, ids); setMenu(null); }}
                >
                  {Icons.arrowUp} Move up
                </button>
                <button
                  type="button"
                  onClick={() => { const ids = move(bucket, list.id, 1); if (ids) reorderLists(spaceId, folderId, ids); setMenu(null); }}
                >
                  {Icons.arrowDown} Move down
                </button>
                <button type="button" onClick={() => doArchive("list", list.id)}>
                  {Icons.archive} Archive
                </button>
                <button type="button" className="danger" onClick={() => doDelete("list", list.id, list.name)}>
                  {Icons.trash} Delete
                </button>
              </div>
            )}
            {colorFor_ === k && <ColorPopover kind="list" id={list.id} />}
          </div>
        )}
      </div>
    );
  };

  const renderFolder = (folder: FolderWithLists, space: SpaceTree, indent: number) => {
    const k = menuKey("folder", folder.id);
    const open = isOpen(folder.id);
    const container = `folders:${space.id}`;
    return (
      <div key={folder.id} className="tree-item">
        {renaming === k ? (
          <InlineInput
            indent={indent}
            initial={folder.name}
            placeholder="Folder name"
            onCommit={(v) => void commitRename(k, v)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <div
            className={`tree-row${dragOverKey === `folder:${folder.id}` ? " dragover" : ""}`}
            style={{ paddingLeft: indent }}
            onClick={() => toggle(folder.id)}
            {...dragProps(
              { kind: "folder", id: folder.id, container },
              { kind: "folder", id: folder.id, container },
              { folders: space.folders, spaceId: space.id },
            )}
          >
            <span className="tree-label">
              <span className={`tree-caret${open ? " open" : ""}`}>{Icons.chevronRight}</span>
              <span className="tree-ic">{open ? Icons.folderOpen : Icons.folder}</span>
              <span className="tree-name">{folder.name}</span>
            </span>
            <span className="tree-actions">
              <AddButton
                title="Add list"
                onClick={() => { ensureOpen(folder.id); setCreating({ type: "list", spaceId: space.id, folderId: folder.id }); }}
              />
              <MenuButton k={k} title="Folder actions" />
            </span>
            {menu === k && (
              <div className="tree-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => { ensureOpen(folder.id); setMenu(null); setCreating({ type: "list", spaceId: space.id, folderId: folder.id }); }}
                >
                  {Icons.plus} Add list
                </button>
                <button type="button" onClick={() => { setMenu(null); setRenaming(k); }}>
                  {Icons.edit} Rename
                </button>
                <button
                  type="button"
                  onClick={() => { const ids = move(space.folders, folder.id, -1); if (ids) reorderFolders(space.id, ids); setMenu(null); }}
                >
                  {Icons.arrowUp} Move up
                </button>
                <button
                  type="button"
                  onClick={() => { const ids = move(space.folders, folder.id, 1); if (ids) reorderFolders(space.id, ids); setMenu(null); }}
                >
                  {Icons.arrowDown} Move down
                </button>
                <button type="button" onClick={() => doArchive("folder", folder.id)}>
                  {Icons.archive} Archive
                </button>
                <button type="button" className="danger" onClick={() => doDelete("folder", folder.id, folder.name)}>
                  {Icons.trash} Delete
                </button>
              </div>
            )}
          </div>
        )}

        {open && (
          <div className="tree-children">
            {folder.lists.map((l) => renderList(l, space.id, folder.id, folder.lists, indent + 34))}
            {creating?.type === "list" &&
              creating.spaceId === space.id &&
              creating.folderId === folder.id && (
                <InlineInput
                  indent={indent + 34}
                  placeholder="List name"
                  onCommit={(v) => void commitCreate(v)}
                  onCancel={() => setCreating(null)}
                />
              )}
            {folder.lists.length === 0 &&
              !(creating?.type === "list" && creating.folderId === folder.id) && (
                <div className="tree-empty" style={{ paddingLeft: indent + 34 }}>
                  No lists yet
                </div>
              )}
          </div>
        )}
      </div>
    );
  };

  const renderSpace = (space: SpaceTree) => {
    const k = menuKey("space", space.id);
    const open = isOpen(space.id);
    const dot = space.color || colorFor(space.id);
    const active = activeSpaceId === space.id;
    return (
      <div key={space.id} className="tree-item">
        {renaming === k ? (
          <InlineInput
            indent={10}
            initial={space.name}
            placeholder="Space name"
            onCommit={(v) => void commitRename(k, v)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <div
            className={`tree-row tree-space${active ? " active" : ""}${
              dragOverKey === `space:${space.id}` ? " dragover" : ""
            }`}
            style={{ paddingLeft: 10 }}
            onClick={() => toggle(space.id)}
            {...dragProps(
              { kind: "space", id: space.id, container: "spaces" },
              { kind: "space", id: space.id, container: "spaces" },
              { spaces: tree },
            )}
          >
            <span className="tree-label">
              <span className={`tree-caret${open ? " open" : ""}`}>{Icons.chevronRight}</span>
              {space.icon ? (
                <span className="tree-emoji">{space.icon}</span>
              ) : (
                <span className="tree-dot lg" style={{ background: dot }} />
              )}
              <span className="tree-name strong">{space.name}</span>
              {space.isPrivate && <span className="tree-lock" title="Private">{Icons.lock}</span>}
            </span>
            <span className="tree-actions">
              <AddButton
                title="Add list"
                onClick={() => { ensureOpen(space.id); setCreating({ type: "list", spaceId: space.id, folderId: null }); }}
              />
              <MenuButton k={k} title="Space actions" />
            </span>
            {menu === k && (
              <div className="tree-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => { ensureOpen(space.id); setMenu(null); setCreating({ type: "folder", spaceId: space.id }); }}
                >
                  {Icons.folder} Add folder
                </button>
                <button
                  type="button"
                  onClick={() => { ensureOpen(space.id); setMenu(null); setCreating({ type: "list", spaceId: space.id, folderId: null }); }}
                >
                  {Icons.list} Add list
                </button>
                <button type="button" onClick={() => { setMenu(null); setRenaming(k); }}>
                  {Icons.edit} Rename
                </button>
                <button type="button" onClick={() => { setMenu(null); setColorPicker(k); }}>
                  {Icons.palette} Change color
                </button>
                <button type="button" onClick={() => togglePrivate(space)}>
                  {Icons.lock} {space.isPrivate ? "Make public" : "Make private"}
                </button>
                <button
                  type="button"
                  onClick={() => { const ids = move(tree, space.id, -1); if (ids) reorderSpaces(ids); setMenu(null); }}
                >
                  {Icons.arrowUp} Move up
                </button>
                <button
                  type="button"
                  onClick={() => { const ids = move(tree, space.id, 1); if (ids) reorderSpaces(ids); setMenu(null); }}
                >
                  {Icons.arrowDown} Move down
                </button>
                <button type="button" onClick={() => doArchive("space", space.id)}>
                  {Icons.archive} Archive
                </button>
                <button type="button" className="danger" onClick={() => doDelete("space", space.id, space.name)}>
                  {Icons.trash} Delete
                </button>
              </div>
            )}
            {colorFor_ === k && <ColorPopover kind="space" id={space.id} />}
          </div>
        )}

        {open && (
          <div className="tree-children">
            {space.folders.map((f) => renderFolder(f, space, 24))}

            {creating?.type === "folder" && creating.spaceId === space.id && (
              <InlineInput
                indent={24}
                placeholder="Folder name"
                onCommit={(v) => void commitCreate(v)}
                onCancel={() => setCreating(null)}
              />
            )}

            {space.lists.map((l) => renderList(l, space.id, null, space.lists, 24))}

            {creating?.type === "list" &&
              creating.spaceId === space.id &&
              creating.folderId === null && (
                <InlineInput
                  indent={24}
                  placeholder="List name"
                  onCommit={(v) => void commitCreate(v)}
                  onCancel={() => setCreating(null)}
                />
              )}

            {space.folders.length === 0 &&
              space.lists.length === 0 &&
              !(creating && "spaceId" in creating && creating.spaceId === space.id) && (
                <div className="tree-empty" style={{ paddingLeft: 24 }}>
                  Empty — add a folder or list
                </div>
              )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="nav-section tree-section">
      <div className="nav-title tree-head">
        <span>Spaces</span>
        <button
          type="button"
          className="tree-act tree-head-add"
          title="Create space"
          onClick={() => setCreating({ type: "space" })}
        >
          {Icons.plus}
        </button>
      </div>

      <Link
        href="/everything"
        className={`navlink tree-everything${pathname === "/everything" ? " active" : ""}`}
      >
        {Icons.everything}
        Everything
      </Link>

      <div className="tree">
        {loading && tree.length === 0 ? (
          <div className="tree-loading">
            <span className="skel" style={{ width: "80%", height: 12, marginBottom: 8 }} />
            <span className="skel" style={{ width: "65%", height: 12, marginBottom: 8 }} />
            <span className="skel" style={{ width: "72%", height: 12 }} />
          </div>
        ) : error && tree.length === 0 ? (
          <button type="button" className="tree-error" onClick={() => void reload()}>
            Couldn’t load spaces — retry
          </button>
        ) : (
          <>
            {tree.map((s) => renderSpace(s))}

            {creating?.type === "space" && (
              <InlineInput
                indent={10}
                placeholder="Space name"
                onCommit={(v) => void commitCreate(v)}
                onCancel={() => setCreating(null)}
              />
            )}

            {tree.length === 0 && creating?.type !== "space" && (
              <button
                type="button"
                className="tree-create-first"
                onClick={() => setCreating({ type: "space" })}
              >
                {Icons.plus} Create a space
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
