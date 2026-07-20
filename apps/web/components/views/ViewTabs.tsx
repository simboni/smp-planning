"use client";

/**
 * ViewTabs (Module 5) — the tab bar: five built-in view kinds, the list's
 * saved views (name + kind icon), and a "+ View" menu that saves the
 * current kind + config as a named view (with a shared toggle when the
 * user can edit the space). Saved tabs expose rename/delete via a ⋯
 * button or right-click, gated by ownership/permission.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import type { View, ViewKind } from "@/lib/api";
import { Icons } from "@/components/icons";
import { Popover } from "@/components/views/ViewBits";

export const KIND_META: Record<ViewKind, { label: string; icon: ReactNode }> = {
  list: { label: "List", icon: Icons.list },
  board: { label: "Board", icon: Icons.board },
  calendar: { label: "Calendar", icon: Icons.calendar },
  table: { label: "Table", icon: Icons.table },
  gantt: { label: "Gantt", icon: Icons.gantt },
  timeline: { label: "Timeline", icon: Icons.calendar },
};

const KINDS: ViewKind[] = ["list", "board", "calendar", "table", "gantt", "timeline"];

export interface ActiveTab {
  kind: ViewKind;
  /** Set when a saved view is active (its id), null for a built-in tab. */
  viewId: string | null;
}

export function ViewTabs({
  active,
  savedViews,
  canEdit,
  currentUserId,
  onSelectBuiltin,
  onSelectView,
  onSaveView,
  onRenameView,
  onDeleteView,
}: {
  active: ActiveTab;
  savedViews: View[];
  canEdit: boolean;
  currentUserId: string | null;
  onSelectBuiltin: (kind: ViewKind) => void;
  onSelectView: (view: View) => void;
  onSaveView: (name: string, isShared: boolean) => void;
  onRenameView: (view: View, name: string) => void;
  onDeleteView: (view: View) => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null); // view id
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  const canManage = (v: View): boolean =>
    v.createdBy === currentUserId || (v.isShared && canEdit);

  const commitCreate = (): void => {
    const n = name.trim();
    if (!n) return;
    onSaveView(n, canEdit && shared);
    setCreating(false);
    setName("");
    setShared(false);
  };

  return (
    <div className="view-tabs" role="tablist">
      {KINDS.map((k) => {
        const on = active.viewId === null && active.kind === k;
        return (
          <button
            key={k}
            role="tab"
            aria-selected={on}
            className={`view-tab${on ? " active" : ""}`}
            onClick={() => onSelectBuiltin(k)}
          >
            <span className="view-tab-ic">{KIND_META[k].icon}</span>
            {KIND_META[k].label}
          </button>
        );
      })}

      {savedViews.length > 0 && <span className="view-tabs-sep" />}

      {savedViews.map((v) => {
        const on = active.viewId === v.id;
        const manage = canManage(v);
        return (
          <span className="view-tab-wrap" key={v.id}>
            <button
              role="tab"
              aria-selected={on}
              className={`view-tab saved${on ? " active" : ""}`}
              title={v.isShared ? "Shared view" : "Personal view"}
              onClick={() => onSelectView(v)}
              onContextMenu={(e) => {
                if (!manage) return;
                e.preventDefault();
                setMenuFor(menuFor === v.id ? null : v.id);
                setRenaming(null);
              }}
            >
              <span className="view-tab-ic">{KIND_META[v.kind].icon}</span>
              {v.name}
              {v.isShared && <span className="view-tab-shared" title="Shared">{Icons.team}</span>}
            </button>
            {manage && (
              <button
                type="button"
                className="view-tab-more"
                aria-label={`${v.name} options`}
                onClick={() => {
                  setMenuFor(menuFor === v.id ? null : v.id);
                  setRenaming(null);
                }}
              >
                {Icons.more}
              </button>
            )}
            {menuFor === v.id && (
              <Popover onClose={() => setMenuFor(null)} className="tp-pop-menu view-tab-menu">
                {renaming === v.id ? (
                  <div className="vt-rename">
                    <input
                      autoFocus
                      className="input vt-rename-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const n = renameDraft.trim();
                          if (n && n !== v.name) onRenameView(v, n);
                          setMenuFor(null);
                          setRenaming(null);
                        } else if (e.key === "Escape") {
                          setRenaming(null);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tp-menu-opt"
                      onClick={() => {
                        setRenaming(v.id);
                        setRenameDraft(v.name);
                      }}
                    >
                      {Icons.edit}
                      <span>Rename</span>
                    </button>
                    <button
                      type="button"
                      className="tp-menu-opt danger"
                      onClick={() => {
                        setMenuFor(null);
                        onDeleteView(v);
                      }}
                    >
                      {Icons.trash}
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </Popover>
            )}
          </span>
        );
      })}

      {/* + View */}
      <span className="tp-pop-anchor view-tab-addwrap">
        <button
          type="button"
          className="view-tab view-tab-add"
          onClick={() => setCreating((v) => !v)}
        >
          {Icons.plus} View
        </button>
        {creating && (
          <Popover onClose={() => setCreating(false)} className="fb-pop vt-create">
            <div className="fb-pop-title">Save current view</div>
            <input
              autoFocus
              className="input"
              placeholder="View name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreate();
                else if (e.key === "Escape") setCreating(false);
              }}
            />
            {canEdit && (
              <label className="vt-shared-toggle">
                <input
                  type="checkbox"
                  checked={shared}
                  onChange={(e) => setShared(e.target.checked)}
                />
                Share with everyone in this space
              </label>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm btn-block"
              disabled={!name.trim()}
              onClick={commitCreate}
            >
              Save view
            </button>
          </Popover>
        )}
      </span>
    </div>
  );
}
