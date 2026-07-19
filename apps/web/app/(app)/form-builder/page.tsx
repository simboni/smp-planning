"use client";

/**
 * Module 11 — the two-pane form builder (`/form-builder?id=…`).
 *
 * LEFT: the form's settings (name, description, target list, Active
 * toggle, public link) and the field list — add from a type menu,
 * reorder by dragging the grip or with ↑/↓, edit label/required/options,
 * and mark at most one field as the task title.
 *
 * RIGHT: a live preview rendered by the exact component the public
 * `/f?token=` page uses, so what you see is what respondents get.
 *
 * Edits autosave with an 800ms debounce (same "Saving… / Saved" pill as
 * the doc editor).
 */

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  formsApi,
  FORM_FIELD_TYPE_LABEL,
  type FormDetail,
  type FormField,
  type FormFieldType,
} from "@/lib/api";
import { FormRenderer } from "@/components/FormRenderer";
import { Icons } from "@/components/icons";
import { copyToClipboard, publicFormUrl } from "@/lib/format";

type SaveState = "idle" | "saving" | "saved";

/** The editable slice of the form the builder round-trips on PATCH. */
interface Draft {
  name: string;
  description: string;
  active: boolean;
  fields: FormField[];
}

const FIELD_TYPES: FormFieldType[] = [
  "text",
  "textarea",
  "email",
  "number",
  "select",
  "date",
  "checkbox",
];

const TYPE_ICON: Record<FormFieldType, keyof typeof Icons> = {
  text: "edit",
  textarea: "docs",
  email: "mail",
  number: "hash",
  select: "chevronDown",
  date: "calendar",
  checkbox: "checkSquare",
};

/** Field types whose value can sensibly become a task title. */
const TITLE_CAPABLE: FormFieldType[] = ["text", "textarea", "email"];

function newFieldId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function defaultLabel(type: FormFieldType): string {
  switch (type) {
    case "textarea": return "Tell us more";
    case "email": return "Your email";
    case "number": return "Amount";
    case "select": return "Pick one";
    case "date": return "When?";
    case "checkbox": return "I agree";
    default: return "Your answer";
  }
}

/* ------------------------------------------------------------------ *
 * One field editor card.
 * ------------------------------------------------------------------ */
function FieldCard({
  field,
  index,
  count,
  dragIdx,
  overIdx,
  onChange,
  onMove,
  onRemove,
  onSetTitle,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  field: FormField;
  index: number;
  count: number;
  dragIdx: number | null;
  overIdx: number | null;
  onChange: (patch: Partial<FormField>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onSetTitle: (on: boolean) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [dragArmed, setDragArmed] = useState(false);
  const isSelect = field.type === "select";
  const titleCapable = TITLE_CAPABLE.includes(field.type);

  const setOption = (i: number, value: string): void => {
    const opts = [...(field.options ?? [])];
    opts[i] = value;
    onChange({ options: opts });
  };
  const addOption = (): void => {
    onChange({ options: [...(field.options ?? []), `Option ${(field.options?.length ?? 0) + 1}`] });
  };
  const removeOption = (i: number): void => {
    onChange({ options: (field.options ?? []).filter((_, x) => x !== i) });
  };

  return (
    <div
      className={`fb-field${dragIdx === index ? " dragging" : ""}${
        overIdx === index && dragIdx !== null && dragIdx !== index ? " drop-target" : ""
      }`}
      draggable={dragArmed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={() => {
        setDragArmed(false);
        onDragEnd();
      }}
    >
      <div className="fb-field-head">
        <span
          className="fb-grip"
          title="Drag to reorder"
          onMouseDown={() => setDragArmed(true)}
          onMouseUp={() => setDragArmed(false)}
        >
          {Icons.grip}
        </span>
        <input
          className="input fb-label-input"
          value={field.label}
          placeholder="Question label"
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <span className="fb-type-chip">
          {Icons[TYPE_ICON[field.type]]}
          {FORM_FIELD_TYPE_LABEL[field.type]}
        </span>
        <span className="fb-field-tools">
          <button
            type="button"
            className="icon-btn"
            aria-label="Move up"
            title="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            {Icons.arrowUp}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Move down"
            title="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            {Icons.arrowDown}
          </button>
          <button
            type="button"
            className="icon-btn fb-remove"
            aria-label="Remove field"
            title="Remove field"
            onClick={onRemove}
          >
            {Icons.trash}
          </button>
        </span>
      </div>

      {isSelect && (
        <div className="fb-options">
          <span className="fb-options-title">Options</span>
          {(field.options ?? []).map((opt, i) => (
            <div className="fb-option" key={i}>
              <input
                className="input"
                value={opt}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOption(i, e.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove option"
                onClick={() => removeOption(i)}
              >
                {Icons.close}
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addOption}>
            {Icons.plus} Add option
          </button>
        </div>
      )}

      <div className="fb-field-foot">
        <button
          type="button"
          className={`fb-flag${field.required ? " on" : ""}`}
          onClick={() => onChange({ required: !field.required })}
        >
          <span className={`switch${field.required ? " on" : ""}`} aria-hidden="true" />
          Required
        </button>
        {titleCapable && (
          <button
            type="button"
            className={`fb-flag${field.asTitle ? " on" : ""}`}
            title="The answer to this question becomes the created task's name (one field max)."
            onClick={() => onSetTitle(!field.asTitle)}
          >
            <span className={`fb-radio${field.asTitle ? " on" : ""}`} aria-hidden="true" />
            Use as task title
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The builder view.
 * ------------------------------------------------------------------ */
function FormBuilderView() {
  const search = useSearchParams();
  const formId = search.get("id");

  const [form, setForm] = useState<FormDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState("");

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formIdRef = useRef<string | null>(null);
  formIdRef.current = formId;

  useEffect(() => {
    if (!formId) {
      setLoading(false);
      return;
    }
    formsApi
      .get(formId)
      .then((r) => {
        setForm(r.form);
        setDraft({
          name: r.form.name,
          description: r.form.description ?? "",
          active: r.form.active,
          fields: r.form.fields ?? [],
        });
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this form."),
      )
      .finally(() => setLoading(false));
  }, [formId]);

  /* ---- autosave (800ms debounce, doc-editor style pill) ---- */
  const flushNow = useCallback((): void => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const d = draftRef.current;
    const id = formIdRef.current;
    if (!dirtyRef.current || !d || !id) return;
    dirtyRef.current = false;
    setSaveState("saving");
    formsApi
      .update(id, {
        name: d.name.trim() || "Untitled form",
        description: d.description.trim() ? d.description : null,
        fields: d.fields,
        active: d.active,
      })
      .then(() => setSaveState("saved"))
      .catch(() => {
        dirtyRef.current = true;
        setSaveState("idle");
      });
  }, []);

  // Flush any pending edit when leaving the page.
  useEffect(() => flushNow, [flushNow]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // Click-away closes the add-field menu.
  useEffect(() => {
    if (!addOpen) return;
    const close = (): void => setAddOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [addOpen]);

  const update = useCallback(
    (patch: Partial<Draft> | ((prev: Draft) => Draft)): void => {
      setDraft((prev) => {
        if (!prev) return prev;
        return typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      });
      dirtyRef.current = true;
      setSaveState("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushNow, 800);
    },
    [flushNow],
  );

  const showToast = (msg: string): void => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2600);
  };

  /* ---- field mutations ---- */
  const addField = (type: FormFieldType): void => {
    setAddOpen(false);
    update((prev) => ({
      ...prev,
      fields: [
        ...prev.fields,
        {
          id: newFieldId(),
          label: defaultLabel(type),
          type,
          required: false,
          ...(type === "select" ? { options: ["Option 1", "Option 2"] } : {}),
        },
      ],
    }));
  };

  const patchField = (id: string, patch: Partial<FormField>): void => {
    update((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  };

  const removeField = (id: string): void => {
    update((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== id) }));
  };

  const moveField = (from: number, to: number): void => {
    update((prev) => {
      if (to < 0 || to >= prev.fields.length || from === to) return prev;
      const fields = [...prev.fields];
      const [moved] = fields.splice(from, 1);
      fields.splice(to, 0, moved);
      return { ...prev, fields };
    });
  };

  /** "Use as task title" is radio-like: turning one on clears the rest. */
  const setTitleField = (id: string, on: boolean): void => {
    update((prev) => ({
      ...prev,
      fields: prev.fields.map((f) =>
        f.id === id ? { ...f, asTitle: on } : on ? { ...f, asTitle: false } : f,
      ),
    }));
  };

  const copyLink = (): void => {
    if (!form) return;
    void copyToClipboard(publicFormUrl(form.publicToken)).then((ok) =>
      showToast(ok ? "Public link copied to your clipboard." : "Couldn't copy the link."),
    );
  };

  /* ---- guards ---- */
  if (!formId) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.clipboard}</span>
          <h3>No form selected</h3>
          <p>Open a form from the Forms page to edit it here.</p>
          <Link href="/forms" className="btn btn-soft">Go to Forms</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 32, marginBottom: 18 }} />
        <span className="skel" style={{ width: "100%", height: 120, marginBottom: 10 }} />
        <span className="skel" style={{ width: "100%", height: 120 }} />
      </div>
    );
  }

  if (error || !form || !draft) {
    return (
      <div className="page">
        <div className="form-error">{error || "Form not found."}</div>
        <Link href="/forms" className="btn btn-soft">Back to Forms</Link>
      </div>
    );
  }

  return (
    <div className="page fb-page">
      {/* ---- header ---- */}
      <div className="fb-head">
        <Link href="/forms" className="btn btn-ghost btn-sm fb-back">
          {Icons.chevronLeft} Forms
        </Link>
        <h1 className="fb-title">{draft.name.trim() || "Untitled form"}</h1>
        <span
          className={`doc-save${saveState === "idle" ? " hidden" : ""}`}
          aria-live="polite"
        >
          {saveState === "saving" ? (
            <>
              <span className="doc-save-dot pulsing" />
              Saving…
            </>
          ) : (
            <>
              <span className="doc-save-dot" />
              Saved · just now
            </>
          )}
        </span>
        <span className="topbar-spacer" />
        <button
          type="button"
          className={`frm-active-pill${draft.active ? " on" : ""}`}
          onClick={() => update({ active: !draft.active })}
          title={draft.active ? "Accepting responses — click to pause" : "Paused — click to activate"}
        >
          <span className="frm-active-dot" />
          {draft.active ? "Active" : "Inactive"}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={copyLink}>
          {Icons.link} Copy public link
        </button>
      </div>

      <div className="fb-panes">
        {/* ---- LEFT: settings + fields ---- */}
        <div className="fb-editor">
          <div className="card fb-meta">
            <div className="field">
              <label className="label" htmlFor="fb-name">Form name</label>
              <input
                id="fb-name"
                className="input"
                value={draft.name}
                placeholder="Untitled form"
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="fb-desc">Description</label>
              <textarea
                id="fb-desc"
                className="input fb-desc"
                rows={2}
                value={draft.description}
                placeholder="What is this form for? Respondents see this under the title."
                onChange={(e) => update({ description: e.target.value })}
              />
            </div>
            <div className="fb-meta-row">
              <span className="label" style={{ marginBottom: 0 }}>Submissions go to</span>
              <Link href={`/list?id=${form.listId}`} className="frm-list-chip">
                {Icons.list}
                {form.listName}
              </Link>
            </div>
          </div>

          <div className="fb-fields-head">
            <h3>Fields</h3>
            <span className="badge badge-soft">{draft.fields.length}</span>
            <span className="topbar-spacer" />
            <span className="dp-menu-wrap">
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddOpen((v) => !v);
                }}
              >
                {Icons.plus} Add field
              </button>
              {addOpen && (
                <div
                  className="menu dp-menu fb-add-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  {FIELD_TYPES.map((t) => (
                    <button key={t} type="button" onClick={() => addField(t)}>
                      {Icons[TYPE_ICON[t]]} {FORM_FIELD_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </div>

          {draft.fields.length === 0 ? (
            <div className="sp-group-empty">
              No questions yet — add your first field to start building.
            </div>
          ) : (
            <div className="fb-fields" onDragLeave={() => setOverIdx(null)}>
              {draft.fields.map((f, i) => (
                <FieldCard
                  key={f.id}
                  field={f}
                  index={i}
                  count={draft.fields.length}
                  dragIdx={dragIdx}
                  overIdx={overIdx}
                  onChange={(patch) => patchField(f.id, patch)}
                  onMove={(dir) => moveField(i, i + dir)}
                  onRemove={() => removeField(f.id)}
                  onSetTitle={(on) => setTitleField(f.id, on)}
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => {
                    if (dragIdx === null) return;
                    e.preventDefault();
                    setOverIdx(i);
                  }}
                  onDrop={() => {
                    if (dragIdx !== null) moveField(dragIdx, i);
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* ---- RIGHT: live preview (the real public renderer) ---- */}
        <div className="fb-preview">
          <div className="fb-preview-tag">
            {Icons.eye} Live preview — exactly what respondents see
          </div>
          <div className="fb-preview-stage">
            <FormRenderer
              preview
              form={{
                name: draft.name.trim() || "Untitled form",
                description: draft.description.trim() || null,
                fields: draft.fields,
              }}
            />
          </div>
        </div>
      </div>

      {toast && (
        <div className="toast" role="status">
          {Icons.checkCircle}
          {toast}
        </div>
      )}
    </div>
  );
}

export default function FormBuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 32 }} />
        </div>
      }
    >
      <FormBuilderView />
    </Suspense>
  );
}
