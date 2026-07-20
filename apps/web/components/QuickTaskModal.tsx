"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, hierarchyApi, tasksApi } from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { showToast } from "@/lib/toast";

const LAST_LIST_KEY = "stackup.lastList";
const NEW_LIST = "__new_list__";
const NEW_SPACE = "__new_space__";

/**
 * Global "New task" quick-add. Opened from the always-visible topbar button so
 * a task is never more than one click away, from any page.
 *
 * Default flow: type a name, pick an EXISTING list, Create. But you can also
 * create the destination on the fly without leaving the modal — choose
 * "＋ New list…" to reveal a Space picker + list name (and "＋ New space…" to
 * name a brand-new space too). On Create it provisions space → list → task in
 * one step, refreshes the sidebar, and drops you into the new list.
 */
export function QuickTaskModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { tree, loading, reload } = useHierarchy();

  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [spaceSel, setSpaceSel] = useState("");
  const [newListName, setNewListName] = useState("");
  const [newSpaceName, setNewSpaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Flatten to selectable existing lists (Space / [Folder /] List).
  const lists = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    for (const s of tree) {
      for (const l of s.lists) out.push({ id: l.id, label: `${s.name} / ${l.name}` });
      for (const f of s.folders)
        for (const l of f.lists)
          out.push({ id: l.id, label: `${s.name} / ${f.name} / ${l.name}` });
    }
    return out;
  }, [tree]);

  // Default destination: last-used list, else the first list, else "new list".
  useEffect(() => {
    if (loading || listId) return;
    if (lists.length === 0) {
      setListId(NEW_LIST);
      setSpaceSel(tree.length ? tree[0].id : NEW_SPACE);
      return;
    }
    const last = typeof window !== "undefined" ? localStorage.getItem(LAST_LIST_KEY) : null;
    setListId(last && lists.some((l) => l.id === last) ? last : lists[0].id);
  }, [loading, lists, listId, tree]);

  const creatingList = listId === NEW_LIST;
  const creatingSpace = creatingList && spaceSel === NEW_SPACE;

  const onPickList = (v: string) => {
    setListId(v);
    if (v === NEW_LIST && !spaceSel) setSpaceSel(tree.length ? tree[0].id : NEW_SPACE);
  };

  const canSubmit =
    !!name.trim() &&
    (creatingList
      ? !!newListName.trim() && (!creatingSpace || !!newSpaceName.trim())
      : !!listId);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setError("");
    try {
      let targetListId = listId;
      if (creatingList) {
        const spaceId = creatingSpace
          ? (await hierarchyApi.createSpace({ name: newSpaceName.trim() })).space.id
          : spaceSel;
        targetListId = (
          await hierarchyApi.createList(spaceId, { name: newListName.trim() })
        ).list.id;
      }
      const r = await tasksApi.create(targetListId, { name: name.trim() });
      localStorage.setItem(LAST_LIST_KEY, targetListId);
      await reload(); // new space/list shows up in the sidebar
      showToast(`Task created: “${name.trim().slice(0, 40)}”`);
      onClose();
      router.push(`/list?id=${targetListId}&task=${r.task.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the task.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal qt-modal"
        role="dialog"
        aria-modal="true"
        aria-label="New task"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.tasks}</span>
            <div>
              <h3>New task</h3>
              <p className="muted">Add a task to any list — new or existing.</p>
            </div>
          </div>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <form className="qt-body" onSubmit={(e) => void submit(e)}>
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="qt-name">
              Task name
            </label>
            <input
              id="qt-name"
              ref={inputRef}
              className="input input-lg"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What needs to get done?"
              autoComplete="off"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="qt-list">
              Add to list
            </label>
            <select
              id="qt-list"
              className="input"
              value={listId}
              onChange={(e) => onPickList(e.target.value)}
            >
              {loading && <option>Loading…</option>}
              {lists.length > 0 && (
                <optgroup label="Existing lists">
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={NEW_LIST}>＋ New list…</option>
            </select>
          </div>

          {/* Inline create-new destination — the "floating" create flow. */}
          {creatingList && (
            <div className="qt-nested">
              <div className="field">
                <label className="label" htmlFor="qt-space">
                  In space
                </label>
                <select
                  id="qt-space"
                  className="input"
                  value={spaceSel}
                  onChange={(e) => setSpaceSel(e.target.value)}
                >
                  {tree.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value={NEW_SPACE}>＋ New space…</option>
                </select>
              </div>

              {creatingSpace && (
                <div className="field">
                  <label className="label" htmlFor="qt-newspace">
                    New space name
                  </label>
                  <input
                    id="qt-newspace"
                    className="input"
                    value={newSpaceName}
                    onChange={(e) => setNewSpaceName(e.target.value)}
                    placeholder="e.g. Marketing"
                    autoComplete="off"
                  />
                </div>
              )}

              <div className="field">
                <label className="label" htmlFor="qt-newlist">
                  New list name
                </label>
                <input
                  id="qt-newlist"
                  className="input"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="e.g. Campaigns"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg btn-block"
            type="submit"
            disabled={busy || !canSubmit}
          >
            {busy ? (
              <span className="spinner" />
            ) : creatingList ? (
              "Create list & task"
            ) : (
              "Create task"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
