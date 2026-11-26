"use client";

/**
 * A reusable "where should this go?" picker: Space → List, with the ability to
 * CREATE the destination inline.
 *
 * Why it exists: the Notepad's note→task flow used to build its own target list
 * with `tree.filter(s => s.lists.length > 0)`, which silently hid every space
 * that had no lists yet — so a user with a brand-new space saw it missing from
 * the picker and had no way to add a list from there. Any space the caller can
 * edit is offered here, empty or not, and both a List and a Space can be
 * created on the spot (the same affordance QuickTaskModal gives).
 *
 * Styling reuses the `np-picker` rules so it drops into the Notepad panel and
 * onto the Notes page unchanged.
 */

import { useState } from "react";
import {
  ApiError,
  hierarchyApi,
  permissionAtLeast,
  type SpaceTree,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";

/** A selectable list inside one space, labelled with its folder when nested. */
interface ListChoice {
  id: string;
  name: string;
  folderName: string | null;
}

/** Non-archived lists of a space, folder-nested ones included. */
function listsOf(space: SpaceTree): ListChoice[] {
  const direct = space.lists
    .filter((l) => !l.archived)
    .map((l) => ({ id: l.id, name: l.name, folderName: null }));
  const nested = space.folders
    .filter((f) => !f.archived)
    .flatMap((f) =>
      f.lists
        .filter((l) => !l.archived)
        .map((l) => ({ id: l.id, name: l.name, folderName: f.name })),
    );
  return [...direct, ...nested];
}

export function ListDestinationPicker({
  title,
  confirmLabel = "Add here",
  busy = false,
  onCancel,
  onPick,
}: {
  title: string;
  /** Label for the per-list action affordance (tooltip only). */
  confirmLabel?: string;
  /** External busy flag (e.g. the caller is creating the task). */
  busy?: boolean;
  onCancel: () => void;
  /** Called with a REAL list id — existing, or one just created here. */
  onPick: (listId: string) => void;
}) {
  const { tree, loading, reload } = useHierarchy();

  const [spaceId, setSpaceId] = useState("");
  // Inline create state: which form is open and what's typed in it.
  const [mode, setMode] = useState<"none" | "newSpace" | "newList">("none");
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  // Every space the caller can actually add work to — no list-count filter, so
  // an empty space is still reachable (and can be filled from right here).
  const spaces = tree.filter(
    (s) => !s.archived && permissionAtLeast(s.myPermission, "edit"),
  );
  const space = spaces.find((s) => s.id === spaceId) ?? null;
  const lists = space ? listsOf(space) : [];

  const resetCreate = (): void => {
    setMode("none");
    setDraft("");
    setError("");
  };

  const createSpace = async (): Promise<void> => {
    const name = draft.trim();
    if (!name || working) return;
    setWorking(true);
    setError("");
    try {
      const r = await hierarchyApi.createSpace({ name });
      await reload();
      resetCreate();
      // Drill straight into the new space so the next step is "add a list".
      setSpaceId(r.space.id);
      setMode("newList");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't create the space.",
      );
    } finally {
      setWorking(false);
    }
  };

  const createList = async (): Promise<void> => {
    const name = draft.trim();
    if (!name || !spaceId || working) return;
    setWorking(true);
    setError("");
    try {
      const r = await hierarchyApi.createList(spaceId, { name });
      await reload();
      resetCreate();
      // A freshly made list is almost certainly the intended destination.
      onPick(r.list.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't create the list.",
      );
    } finally {
      setWorking(false);
    }
  };

  const disabled = busy || working;

  return (
    <div className="np-picker">
      <div className="np-picker-head">
        <span>{title}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Cancel"
          onClick={onCancel}
        >
          {Icons.close}
        </button>
      </div>

      {error && <div className="np-picker-error">{error}</div>}

      {/* ---- inline create forms ---- */}
      {mode !== "none" ? (
        <div className="np-picker-create">
          <div className="np-picker-label">
            {mode === "newSpace"
              ? "Name the new Space"
              : `New List in ${space?.name ?? "this Space"}`}
          </div>
          <input
            className="input"
            autoFocus
            value={draft}
            disabled={working}
            placeholder={mode === "newSpace" ? "e.g. Marketing" : "e.g. Campaigns"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void (mode === "newSpace" ? createSpace() : createList());
              }
              if (e.key === "Escape") {
                e.preventDefault();
                resetCreate();
              }
            }}
          />
          <div className="np-picker-create-actions">
            <button
              type="button"
              className="btn btn-soft btn-sm"
              onClick={resetCreate}
              disabled={working}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={working || !draft.trim()}
              onClick={() =>
                void (mode === "newSpace" ? createSpace() : createList())
              }
            >
              {working ? <span className="spinner" /> : "Create"}
            </button>
          </div>
        </div>
      ) : !space ? (
        /* ---- step 1: pick a Space ---- */
        <div className="np-picker-scroll">
          <div className="np-picker-label">Pick a Space</div>
          {loading && spaces.length === 0 ? (
            <div className="np-picker-empty">Loading your Spaces…</div>
          ) : (
            spaces.map((s) => {
              const n = listsOf(s).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="np-pick-row"
                  disabled={disabled}
                  onClick={() => setSpaceId(s.id)}
                >
                  <span className="np-pick-ic">{Icons.spaces}</span>
                  <span className="np-pick-name">{s.name}</span>
                  <span className="np-pick-count">
                    {n === 0 ? "no lists" : n === 1 ? "1 list" : `${n} lists`}
                  </span>
                  <span className="np-pick-arrow">{Icons.chevronRight}</span>
                </button>
              );
            })
          )}
          <button
            type="button"
            className="np-pick-row np-pick-new"
            disabled={disabled}
            onClick={() => {
              setDraft("");
              setError("");
              setMode("newSpace");
            }}
          >
            <span className="np-pick-ic">{Icons.plus}</span>
            <span className="np-pick-name">New Space…</span>
          </button>
        </div>
      ) : (
        /* ---- step 2: pick a List in that Space ---- */
        <div className="np-picker-scroll">
          <button
            type="button"
            className="np-pick-back"
            onClick={() => setSpaceId("")}
          >
            {Icons.chevronLeft}
            Spaces
          </button>
          <div className="np-picker-label">
            {lists.length > 0 ? `Pick a List in ${space.name}` : space.name}
          </div>
          {lists.length === 0 && (
            <div className="np-picker-empty">
              This Space has no Lists yet — create one below.
            </div>
          )}
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              className="np-pick-row"
              title={confirmLabel}
              disabled={disabled}
              onClick={() => onPick(l.id)}
            >
              <span className="np-pick-ic">{Icons.list}</span>
              <span className="np-pick-name">
                {l.folderName ? `${l.folderName} / ${l.name}` : l.name}
              </span>
              <span className="np-pick-arrow">{Icons.plus}</span>
            </button>
          ))}
          <button
            type="button"
            className="np-pick-row np-pick-new"
            disabled={disabled}
            onClick={() => {
              setDraft("");
              setError("");
              setMode("newList");
            }}
          >
            <span className="np-pick-ic">{Icons.plus}</span>
            <span className="np-pick-name">New List here…</span>
          </button>
        </div>
      )}
    </div>
  );
}
