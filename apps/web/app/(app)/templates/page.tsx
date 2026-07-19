"use client";

/**
 * Module 14 — the Template Center. A grid of saved templates grouped by kind
 * (Task / List / Doc / Space). "Use" opens a target picker (from the shared
 * hierarchy), applies the template and routes to the created entity. Anything
 * can be saved as a template from its ⋯ menu elsewhere in the app.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  templatesApi,
  TEMPLATE_KIND_LABEL,
  type Template,
  type TemplateKind,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons, type IconKey } from "@/components/icons";
import { showToast } from "@/lib/toast";

const KIND_ORDER: TemplateKind[] = ["task", "list", "doc", "space"];
const KIND_ICON: Record<TemplateKind, IconKey> = {
  task: "tasks",
  list: "list",
  doc: "docs",
  space: "spaces",
};

/* -- apply dialog --------------------------------------------------- */
function ApplyDialog({
  template,
  onClose,
  onApplied,
}: {
  template: Template;
  onClose: () => void;
  onApplied: (createdId: string, kind: TemplateKind) => void;
}) {
  const { tree } = useHierarchy();
  const [name, setName] = useState(template.name);
  const [targetListId, setTargetListId] = useState("");
  const [targetSpaceId, setTargetSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Flatten every list across the tree for the task picker.
  const allLists = useMemo(
    () =>
      tree.flatMap((s) => [
        ...s.lists.map((l) => ({ id: l.id, label: `${s.name} / ${l.name}` })),
        ...s.folders.flatMap((f) =>
          f.lists.map((l) => ({ id: l.id, label: `${s.name} / ${f.name} / ${l.name}` })),
        ),
      ]),
    [tree],
  );

  const needsList = template.kind === "task";
  const needsSpace = template.kind === "list";
  const optionalSpace = template.kind === "doc";

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (needsList && !targetListId) {
      setError("Pick a list to add this task to.");
      return;
    }
    if (needsSpace && !targetSpaceId) {
      setError("Pick a space to create this list in.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body: { targetListId?: string; targetSpaceId?: string; name?: string } = {};
      if (name.trim()) body.name = name.trim();
      if (needsList) body.targetListId = targetListId;
      if (needsSpace) body.targetSpaceId = targetSpaceId;
      if (optionalSpace && targetSpaceId) body.targetSpaceId = targetSpaceId;
      const r = await templatesApi.apply(template.id, body);
      onApplied(r.createdId, r.kind);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't apply the template.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <h3>Use “{template.name}”</h3>
            <p className="muted">Creates a new {TEMPLATE_KIND_LABEL[template.kind].toLowerCase()} from this template.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder={template.name}
          />
        </label>

        {needsList && (
          <label className="field">
            <span className="field-label">Add to list</span>
            <select className="input" value={targetListId} onChange={(e) => setTargetListId(e.target.value)}>
              <option value="">Select a list…</option>
              {allLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {(needsSpace || optionalSpace) && (
          <label className="field">
            <span className="field-label">{needsSpace ? "Create in space" : "Attach to space (optional)"}</span>
            <select className="input" value={targetSpaceId} onChange={(e) => setTargetSpaceId(e.target.value)}>
              <option value="">{needsSpace ? "Select a space…" : "Workspace (no space)"}</option>
              {tree.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const router = useRouter();
  const { reload } = useHierarchy();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<Template | null>(null);

  const load = (): void => {
    templatesApi
      .list()
      .then((r) => setTemplates(r.templates))
      .catch(() => setError("Couldn't load templates."));
  };

  useEffect(load, []);

  const remove = (t: Template): void => {
    if (!window.confirm(`Delete the “${t.name}” template? This can't be undone.`)) return;
    setTemplates((prev) => (prev ? prev.filter((x) => x.id !== t.id) : prev));
    templatesApi
      .remove(t.id)
      .then(() => showToast("Template deleted."))
      .catch(() => {
        showToast("Couldn't delete the template.");
        load();
      });
  };

  const onApplied = (createdId: string, kind: TemplateKind): void => {
    setApplying(null);
    void reload(); // new list/space shows up in the sidebar
    showToast("Created from template.");
    if (kind === "list") router.push(`/list?id=${createdId}`);
    else if (kind === "doc") router.push(`/doc?id=${createdId}`);
    else if (kind === "space") router.push(`/space?id=${createdId}`);
    else if (kind === "task" && applying?.kind === "task") {
      // task lands in the picked list; deep-link via that list is unknown here,
      // so open the task by id (list page resolves its list from the task).
      router.push(`/list?task=${createdId}`);
    }
  };

  const byKind = useMemo(() => {
    const map: Record<TemplateKind, Template[]> = { task: [], list: [], doc: [], space: [] };
    (templates ?? []).forEach((t) => {
      if (map[t.kind]) map[t.kind].push(t);
    });
    return map;
  }, [templates]);

  return (
    <div className="page">
      <div className="section-title">
        <h2>Template Center</h2>
        <span className="muted">Reusable blueprints for tasks, lists, docs & spaces</span>
      </div>

      <div className="tpl-hint card">
        <span className="tpl-hint-ic">{Icons.info}</span>
        <span>
          Save any task, list, space or doc as a template from its <strong>⋯</strong> menu. Saved
          templates appear here, ready to reuse across your workspace.
        </span>
      </div>

      {error && <div className="form-error">{error}</div>}

      {templates === null ? (
        <div className="tpl-grid">
          <span className="skel" style={{ height: 132, borderRadius: 14 }} />
          <span className="skel" style={{ height: 132, borderRadius: 14 }} />
          <span className="skel" style={{ height: 132, borderRadius: 14 }} />
        </div>
      ) : templates.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.copy}</span>
            <h3>No templates yet</h3>
            <p>Save something as a template from its ⋯ menu to see it here.</p>
          </div>
        </div>
      ) : (
        KIND_ORDER.filter((k) => byKind[k].length > 0).map((k) => (
          <div key={k} className="tpl-kind">
            <div className="tpl-kind-head">
              <span className="tpl-kind-ic">{Icons[KIND_ICON[k]]}</span>
              <h3>{TEMPLATE_KIND_LABEL[k]} templates</h3>
              <span className="badge badge-soft">{byKind[k].length}</span>
            </div>
            <div className="tpl-grid">
              {byKind[k].map((t) => (
                <div key={t.id} className="tpl-card">
                  <div className="tpl-card-top">
                    <span className="tpl-card-icon">{t.icon || Icons[KIND_ICON[k]]}</span>
                    <span className={`badge tpl-badge tpl-badge-${k}`}>{TEMPLATE_KIND_LABEL[k]}</span>
                    <button
                      type="button"
                      className="icon-btn tpl-del"
                      aria-label="Delete template"
                      title="Delete template"
                      onClick={() => remove(t)}
                    >
                      {Icons.trash}
                    </button>
                  </div>
                  <h4 className="tpl-card-name">{t.name}</h4>
                  <p className="tpl-card-desc">{t.description || "No description."}</p>
                  <button type="button" className="btn btn-primary btn-sm tpl-use" onClick={() => setApplying(t)}>
                    {Icons.plus} Use template
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {applying && (
        <ApplyDialog template={applying} onClose={() => setApplying(null)} onApplied={onApplied} />
      )}
    </div>
  );
}
