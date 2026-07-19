"use client";

/**
 * StatusManager — a modal to manage a space's task statuses (workflow).
 * Mirrors the ShareDialog shell. Add, rename, recolor (swatch), retype
 * (Not started / Active / Done), reorder (up/down) and delete statuses.
 * Every mutation refetches the modal's own list and calls `onChanged` so the
 * List view underneath reflects the new workflow immediately.
 */

import { useEffect, useState } from "react";
import {
  ApiError,
  statusesApi,
  type Status,
  type StatusType,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";

const SWATCHES = [
  "#8A8F9C",
  "#7B68EE",
  "#5B5FEF",
  "#00B8D9",
  "#36B37E",
  "#FFAB00",
  "#FF7452",
  "#E5578C",
];

const TYPE_OPTS: { value: StatusType; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
];

export function StatusManager({
  spaceId,
  spaceName,
  onClose,
  onChanged,
}: {
  spaceId: string;
  spaceName?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<StatusType>("not_started");
  const [swatchFor, setSwatchFor] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const r = await statusesApi.list(spaceId);
      setStatuses([...r.statuses].sort((a, b) => a.position - b.position));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load statuses.");
      setStatuses([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const add = (): void => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    void run(() => statusesApi.create(spaceId, { name, type: newType }));
  };

  const rename = (s: Status, name: string): void => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === s.name) return;
    void run(() => statusesApi.update(s.id, { name: trimmed }));
  };

  const recolor = (s: Status, color: string): void => {
    setSwatchFor(null);
    void run(() => statusesApi.update(s.id, { color }));
  };

  const retype = (s: Status, type: StatusType): void => {
    if (type === s.type) return;
    void run(() => statusesApi.update(s.id, { type }));
  };

  const reorder = (id: string, dir: -1 | 1): void => {
    if (!statuses) return;
    const ids = statuses.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // Optimistic reorder for a snappy feel.
    setStatuses((prev) =>
      prev ? ids.map((x) => prev.find((s) => s.id === x)!).filter(Boolean) : prev,
    );
    void run(() => statusesApi.reorder(spaceId, ids));
  };

  const remove = (s: Status): void => {
    if (!window.confirm(`Delete the “${s.name}” status? Tasks may need reassigning.`)) return;
    void run(() => statusesApi.remove(s.id));
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal status-mgr"
        role="dialog"
        aria-modal="true"
        aria-label="Manage statuses"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.circle}</span>
            <div>
              <h2>Statuses</h2>
              <p className="muted share-sub">
                The workflow for {spaceName ? `“${spaceName}”` : "this space"}.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {statuses === null ? (
            <div className="share-loading">
              <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 44 }} />
            </div>
          ) : (
            <>
              <div className="stm-list">
                {statuses.map((s, i) => (
                  <div className="stm-row" key={s.id}>
                    <div className="stm-swatch-wrap">
                      <button
                        type="button"
                        className="stm-swatch"
                        style={{ background: s.color || colorFor(s.id) }}
                        title="Change color"
                        disabled={busy}
                        onClick={() => setSwatchFor((k) => (k === s.id ? null : s.id))}
                      />
                      {swatchFor === s.id && (
                        <div className="stm-swatches" onClick={(e) => e.stopPropagation()}>
                          {SWATCHES.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className="tree-swatch"
                              style={{ background: c }}
                              onClick={() => recolor(s, c)}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <input
                      className="input stm-name"
                      defaultValue={s.name}
                      disabled={busy}
                      onBlur={(e) => rename(s, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />

                    <select
                      className="input stm-type"
                      value={s.type}
                      disabled={busy}
                      onChange={(e) => retype(s, e.target.value as StatusType)}
                      aria-label={`Type for ${s.name}`}
                    >
                      {TYPE_OPTS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    <div className="stm-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move up"
                        disabled={busy || i === 0}
                        onClick={() => reorder(s.id, -1)}
                      >
                        {Icons.arrowUp}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move down"
                        disabled={busy || i === statuses.length - 1}
                        onClick={() => reorder(s.id, 1)}
                      >
                        {Icons.arrowDown}
                      </button>
                      <button
                        type="button"
                        className="icon-btn stm-del"
                        title="Delete status"
                        disabled={busy || statuses.length <= 1}
                        onClick={() => remove(s)}
                      >
                        {Icons.trash}
                      </button>
                    </div>
                  </div>
                ))}
                {statuses.length === 0 && (
                  <div className="share-empty">No statuses yet — add your first below.</div>
                )}
              </div>

              <div className="stm-add">
                <input
                  className="input"
                  placeholder="New status name…"
                  value={newName}
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") add();
                  }}
                />
                <select
                  className="input stm-type"
                  value={newType}
                  disabled={busy}
                  onChange={(e) => setNewType(e.target.value as StatusType)}
                  aria-label="Type for new status"
                >
                  {TYPE_OPTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !newName.trim()}
                  onClick={add}
                >
                  {Icons.plus} Add
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
