"use client";

/**
 * "New form" — a small, self-contained modal for creating a form from the
 * sidebar tree, scoped to a space, folder, or list the user clicked.
 *
 * Forms attach to a list in the data model, so when the scope is a space or
 * folder (which hold lists, not forms directly) the user picks one of the
 * lists inside it — or creates a new list right here. On a list scope the
 * target is fixed. On success we hand the new form id back so the caller can
 * drop the user straight into the form builder.
 */

import { useState } from "react";
import { ApiError, formsApi, hierarchyApi, type List } from "@/lib/api";
import { Icons } from "@/components/icons";

const NEW_LIST = "__new_list__";

export function NewFormModal({
  scopeLabel,
  spaceId,
  folderId,
  lists,
  defaultListId,
  onClose,
  onCreated,
  onReload,
}: {
  /** e.g. "in Marketing" — shown in the modal subtitle. */
  scopeLabel: string;
  /** Space the new list would be created in, when the user picks "new list". */
  spaceId: string;
  /** Folder to nest a new list in (null = space root). */
  folderId: string | null;
  /** Existing lists the form can target within this scope. */
  lists: Pick<List, "id" | "name">[];
  /** Preselected target (used for the list scope). */
  defaultListId?: string;
  onClose: () => void;
  onCreated: (formId: string) => void;
  /** Refresh the sidebar tree after a new list is created. */
  onReload: () => void;
}) {
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<string>(
    defaultListId ?? lists[0]?.id ?? (lists.length === 0 ? NEW_LIST : ""),
  );
  const [newListName, setNewListName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const creatingList = choice === NEW_LIST;
  const canCreate =
    !busy && (creatingList ? newListName.trim().length > 0 : !!choice);

  const create = async (): Promise<void> => {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    try {
      let listId = choice;
      if (creatingList) {
        const created = await hierarchyApi.createList(spaceId, {
          name: newListName.trim(),
          folderId: folderId ?? undefined,
        });
        listId = created.list.id;
        onReload();
      }
      const r = await formsApi.create({
        name: name.trim() || "Untitled form",
        listId,
        fields: [],
      });
      onCreated(r.form.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the form.");
      setBusy(false);
    }
  };

  return (
    <div className="sx-scrim" onClick={onClose}>
      <div
        className="nf"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nf-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nf-head">
          <span className="nf-ic">{Icons.docs}</span>
          <div>
            <h2 id="nf-title" className="nf-title">
              New form
            </h2>
            <p className="nf-sub muted">Collect responses {scopeLabel}</p>
          </div>
        </div>

        <label className="label" htmlFor="nf-name">
          Form name
        </label>
        <input
          id="nf-name"
          className="input"
          value={name}
          placeholder="e.g. Customer feedback"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creatingList) void create();
          }}
        />

        <label className="label" htmlFor="nf-list">
          Target list
        </label>
        <p className="nf-hint muted">Submissions become tasks in this list.</p>
        <select
          id="nf-list"
          className="input"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          {lists.length === 0 && <option value="">— No lists here yet —</option>}
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value={NEW_LIST}>＋ Create a new list…</option>
        </select>

        {creatingList && (
          <input
            className="input nf-newlist"
            value={newListName}
            placeholder="New list name"
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
        )}

        {error && <div className="nf-error">{error}</div>}

        <div className="nf-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void create()}
            disabled={!canCreate}
          >
            {busy ? (
              <>
                <span className="aib-spin" aria-hidden="true" /> Creating…
              </>
            ) : (
              "Create form"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
