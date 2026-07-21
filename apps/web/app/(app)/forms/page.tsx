"use client";

/**
 * Module 11 — Forms home: every intake form in the workspace.
 *
 * Rows show the target list, field count, an Active/Inactive toggle pill
 * and an "updated ago" stamp. "New Form" asks for a name + target list,
 * creates the form with no fields yet and drops you straight into the
 * builder. Each row can copy its public link, rotate the token (breaking
 * old links), rename or delete.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  formsApi,
  permissionAtLeast,
  type FormSummary,
  type List,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { copyToClipboard, publicFormUrl, timeAgo } from "@/lib/format";
import { isNativeApp, share } from "@/lib/native";

/** Flattened, permission-filtered list choices grouped by space. */
interface ListChoiceGroup {
  spaceId: string;
  spaceName: string;
  lists: List[];
}

function useListChoices(): ListChoiceGroup[] {
  const { tree } = useHierarchy();
  return useMemo(
    () =>
      tree
        .filter((s) => permissionAtLeast(s.myPermission, "edit"))
        .map((s) => ({
          spaceId: s.id,
          spaceName: s.name,
          lists: [
            ...s.lists.filter((l) => !l.archived),
            ...s.folders.flatMap((f) => f.lists.filter((l) => !l.archived)),
          ],
        }))
        .filter((g) => g.lists.length > 0),
    [tree],
  );
}

function NewFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const groups = useListChoices();
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Preselect the first available list so Enter-to-create just works.
  useEffect(() => {
    if (!listId && groups.length > 0) setListId(groups[0].lists[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || !listId || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await formsApi.create({ name: trimmed, listId, fields: [] });
      onCreated(r.form.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the form.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.clipboard}</span>
            <div>
              <h2>New Form</h2>
              <p className="muted share-sub">
                Submissions become tasks in the list you pick.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="form-name">Name</label>
            <input
              id="form-name"
              className="input"
              placeholder="e.g. Bug report"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="form-list">Target list</label>
            {groups.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.86rem" }}>
                You need edit access to at least one list before you can create a form.
              </p>
            ) : (
              <select
                id="form-list"
                className="input"
                value={listId}
                onChange={(e) => setListId(e.target.value)}
              >
                {groups.map((g) => (
                  <optgroup key={g.spaceId} label={g.spaceName}>
                    {g.lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim() || !listId || busy}
              onClick={() => void submit()}
            >
              {busy ? "Creating…" : "Create & open builder"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormRow({
  form,
  onChanged,
  onToast,
}: {
  form: FormSummary;
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const toggleActive = (): void => {
    formsApi
      .update(form.id, { active: !form.active })
      .then(onChanged)
      .catch(() => undefined);
  };

  const copyLink = (): void => {
    const url = publicFormUrl(form.publicToken);
    void (async () => {
      // In the native shell, prefer the OS share sheet; fall back to copy.
      if (isNativeApp() && (await share({ title: form.name, url }))) return;
      const ok = await copyToClipboard(url);
      onToast(ok ? "Public link copied to your clipboard." : "Couldn't copy the link.");
    })();
  };

  const rotate = (): void => {
    setMenuOpen(false);
    if (
      !window.confirm(
        `Rotate the public link for “${form.name}”?\n\nEveryone with the current link loses access — you'll need to share the new one.`,
      )
    )
      return;
    formsApi
      .rotateToken(form.id)
      .then(() => {
        onToast("Link rotated — old links no longer work.");
        onChanged();
      })
      .catch(() => onToast("Couldn't rotate the link."));
  };

  const commitRename = (): void => {
    setRenaming(false);
    const v = renameVal.trim();
    if (!v || v === form.name) return;
    formsApi.update(form.id, { name: v }).then(onChanged).catch(() => undefined);
  };

  const remove = (): void => {
    setMenuOpen(false);
    if (!window.confirm(`Delete “${form.name}”? Its public link stops working immediately.`))
      return;
    formsApi.remove(form.id).then(onChanged).catch(() => undefined);
  };

  return (
    <div className={`frm-row${form.active ? "" : " inactive"}`}>
      <span className="frm-row-ic">{Icons.clipboard}</span>

      <span className="frm-row-main">
        {renaming ? (
          <input
            className="dp-rename"
            value={renameVal}
            autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <Link href={`/form-builder?id=${form.id}`} className="frm-row-name">
            {form.name}
          </Link>
        )}
        <span className="frm-row-meta">
          <Link href={`/list?id=${form.listId}`} className="frm-list-chip">
            {Icons.list}
            {form.listName}
          </Link>
          <span className="muted">
            {form.fieldCount} {form.fieldCount === 1 ? "field" : "fields"} · updated{" "}
            {timeAgo(form.updatedAt)}
          </span>
        </span>
      </span>

      <button
        type="button"
        className={`frm-active-pill${form.active ? " on" : ""}`}
        onClick={toggleActive}
        title={form.active ? "Accepting responses — click to pause" : "Paused — click to activate"}
      >
        <span className="frm-active-dot" />
        {form.active ? "Active" : "Inactive"}
      </button>

      <Link href={`/form-builder?id=${form.id}`} className="btn btn-ghost btn-sm">
        {Icons.edit} Open builder
      </Link>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
        {Icons.link} Copy public link
      </button>

      <span className="dp-menu-wrap">
        <button
          type="button"
          className="icon-btn"
          aria-label="Form menu"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          {Icons.more}
        </button>
        {menuOpen && (
          <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setRenameVal(form.name);
                setRenaming(true);
                setMenuOpen(false);
              }}
            >
              {Icons.edit} Rename
            </button>
            <button type="button" onClick={rotate}>
              {Icons.repeat} Rotate public link
            </button>
            <button type="button" className="danger" onClick={remove}>
              {Icons.trash} Delete form
            </button>
          </div>
        )}
      </span>
    </div>
  );
}

export default function FormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const load = (): void => {
    formsApi
      .list()
      .then((r) => {
        setForms(r.forms);
        setError("");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load your forms.");
        setForms([]);
      });
  };

  useEffect(load, []);

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Forms</h1>
          <p className="sub">Public intake forms that turn submissions into tasks.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          {Icons.plus}
          New Form
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {forms === null ? (
        <div className="frm-rows">
          <span className="skel" style={{ height: 64, borderRadius: 12 }} />
          <span className="skel" style={{ height: 64, borderRadius: 12 }} />
          <span className="skel" style={{ height: 64, borderRadius: 12 }} />
        </div>
      ) : forms.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.clipboard}</span>
          <h3>No forms yet</h3>
          <p>
            Build a form, share its public link, and every submission lands as a task —
            no account needed on the other end.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {Icons.plus}
            Create your first form
          </button>
        </div>
      ) : (
        <div className="frm-rows">
          {forms.map((f) => (
            <FormRow key={f.id} form={f} onChanged={load} onToast={showToast} />
          ))}
        </div>
      )}

      {creating && (
        <NewFormModal
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/form-builder?id=${id}`)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {Icons.checkCircle}
          {toast}
        </div>
      )}
    </div>
  );
}
