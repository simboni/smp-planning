"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, hierarchyApi, tasksApi, type HierarchyTree } from "@/lib/api";
import { Icons } from "@/components/icons";
import { showToast } from "@/lib/toast";

const LAST_LIST_KEY = "stackup.lastList";

/**
 * Global "New task" quick-add. Opened from the always-visible topbar button so
 * a task is never more than one click away, from any page. Type a name, pick
 * the destination list (Space / Folder / List — remembered between opens), and
 * Create. On success it drops you into that list with the new task open.
 */
export function QuickTaskModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [tree, setTree] = useState<HierarchyTree["spaces"] | null>(null);
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
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

  useEffect(() => {
    hierarchyApi
      .getTree()
      .then((t) => setTree(t.spaces))
      .catch(() => setTree([]));
  }, []);

  // Flatten to selectable lists with a readable "Space / Folder / List" label.
  const lists = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    for (const s of tree ?? []) {
      for (const l of s.lists) out.push({ id: l.id, label: `${s.name} / ${l.name}` });
      for (const f of s.folders)
        for (const l of f.lists)
          out.push({ id: l.id, label: `${s.name} / ${f.name} / ${l.name}` });
    }
    return out;
  }, [tree]);

  // Default the destination: last-used list if still valid, else the first one.
  useEffect(() => {
    if (!lists.length || listId) return;
    const last = typeof window !== "undefined" ? localStorage.getItem(LAST_LIST_KEY) : null;
    setListId(last && lists.some((l) => l.id === last) ? last : lists[0].id);
  }, [lists, listId]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !name.trim() || !listId) return;
    setBusy(true);
    setError("");
    try {
      const r = await tasksApi.create(listId, { name: name.trim() });
      localStorage.setItem(LAST_LIST_KEY, listId);
      showToast(`Task created: “${name.trim().slice(0, 40)}”`);
      onClose();
      router.push(`/list?id=${listId}&task=${r.task.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the task.");
      setBusy(false);
    }
  };

  const noLists = tree !== null && lists.length === 0;

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
              <p className="muted">Add a task to any list — it lands there instantly.</p>
            </div>
          </div>
          <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        {noLists ? (
          <div className="qt-body">
            <div className="empty-state">
              <span className="empty-ic">{Icons.list}</span>
              <h3>No lists yet</h3>
              <p>Create a Space and a List first, then you can add tasks to it.</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  router.push("/everything");
                }}
              >
                {Icons.plus} Create a space
              </button>
            </div>
          </div>
        ) : (
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
                onChange={(e) => setListId(e.target.value)}
              >
                {tree === null ? (
                  <option>Loading lists…</option>
                ) : (
                  lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            <button
              className="btn btn-primary btn-lg btn-block"
              type="submit"
              disabled={busy || !name.trim() || !listId}
            >
              {busy ? <span className="spinner" /> : "Create task"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
