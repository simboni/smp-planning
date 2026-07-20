"use client";

/**
 * Module 11 — the public form card. Renders a form's fields with
 * validation, a submit flow and a success screen. Used verbatim by BOTH
 * the anonymous `/f?token=` page and the builder's live preview, so the
 * preview is pixel-for-pixel what respondents will see.
 *
 * No auth, no storage — this component must stay safe for visitors
 * without an account.
 */

import { useMemo, useState } from "react";
import { ApiError, type FormField, type PublicForm } from "@/lib/api";
import { Icons } from "@/components/icons";

type Values = Record<string, string | boolean>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emptyValues(fields: FormField[]): Values {
  const v: Values = {};
  for (const f of fields) v[f.id] = f.type === "checkbox" ? false : "";
  return v;
}

/**
 * Conditional visibility (M21): a field with `visibleIf` shows only when
 * the referenced field's current answer — stringified ("true"/"false"
 * for checkboxes) — equals the configured value.
 */
function isVisible(field: FormField, values: Values): boolean {
  const cond = field.visibleIf;
  if (!cond) return true;
  const raw = values[cond.fieldId];
  const asString = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw ?? "");
  return asString === cond.equals;
}

/** Per-field validation message, or null when the value is fine. */
function validateField(field: FormField, value: string | boolean): string | null {
  if (field.type === "checkbox") {
    if (field.required && value !== true) return "This box must be checked.";
    return null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return field.required ? "This field is required." : null;
  if (field.type === "email" && !EMAIL_RE.test(text)) {
    return "Enter a valid email address.";
  }
  if (field.type === "number" && Number.isNaN(Number(text))) {
    return "Enter a number.";
  }
  return null;
}

export function FormRenderer({
  form,
  preview = false,
  onSubmit,
}: {
  form: PublicForm;
  /** Builder preview — validate and show the flow, but never POST. */
  preview?: boolean;
  /** Real submission handler (the `/f` page POSTs here). */
  onSubmit?: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Values>(() => emptyValues(form.fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Fields can change under a live preview — keep unknown ids harmless.
  const fields = form.fields;

  // Only currently-visible fields render, validate and submit — recomputed
  // live as answers change so conditions react in real time.
  const visibleFields = useMemo(
    () => fields.filter((f) => isVisible(f, values)),
    [fields, values],
  );

  const requiredCount = useMemo(
    () => visibleFields.filter((f) => f.required).length,
    [visibleFields],
  );

  const setValue = (id: string, v: string | boolean): void => {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const reset = (): void => {
    setValues(emptyValues(fields));
    setErrors({});
    setSubmitError("");
    setDone(false);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;

    const problems: Record<string, string> = {};
    for (const f of visibleFields) {
      const msg = validateField(f, values[f.id] ?? (f.type === "checkbox" ? false : ""));
      if (msg) problems[f.id] = msg;
    }
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    const payload: Record<string, unknown> = {};
    for (const f of visibleFields) {
      const raw = values[f.id];
      if (f.type === "checkbox") payload[f.id] = raw === true;
      else {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (!text) continue; // optional & empty — omit
        payload[f.id] = f.type === "number" ? Number(text) : text;
      }
    }

    if (preview || !onSubmit) {
      setDone(true);
      return;
    }
    setBusy(true);
    setSubmitError("");
    try {
      await onSubmit(payload);
      setDone(true);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError && err.status !== 0
          ? err.message
          : "Couldn't send your response. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="pub-card pub-success" role="status">
        <span className="pub-success-ic">{Icons.checkCircle}</span>
        <h2>Thanks — your request is in! ✅</h2>
        <p>
          {preview
            ? "This is the success screen respondents will see."
            : "We've received your response and the team has been notified."}
        </p>
        <button type="button" className="btn btn-soft" onClick={reset}>
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form className="pub-card" onSubmit={(e) => void submit(e)} noValidate>
      <div className="pub-card-head">
        <h1 className="pub-form-name">{form.name || "Untitled form"}</h1>
        {form.description && <p className="pub-form-desc">{form.description}</p>}
      </div>

      {submitError && <div className="form-error">{submitError}</div>}

      {fields.length === 0 ? (
        <p className="pub-no-fields">This form doesn't have any questions yet.</p>
      ) : (
        visibleFields.map((f) => {
          const err = errors[f.id];
          const value = values[f.id] ?? (f.type === "checkbox" ? false : "");
          const inputId = `pf-${f.id}`;
          return (
            <div className={`pub-field${err ? " has-error" : ""}`} key={f.id}>
              {f.type === "checkbox" ? (
                <label className="pub-check" htmlFor={inputId}>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => setValue(f.id, e.target.checked)}
                  />
                  <span className="pub-check-label">
                    {f.label || "Untitled question"}
                    {f.required && <span className="pub-req" aria-hidden="true"> *</span>}
                  </span>
                </label>
              ) : (
                <>
                  <label className="pub-label" htmlFor={inputId}>
                    {f.label || "Untitled question"}
                    {f.required && <span className="pub-req" aria-hidden="true"> *</span>}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea
                      id={inputId}
                      className="input pub-textarea"
                      rows={4}
                      value={typeof value === "string" ? value : ""}
                      placeholder="Type your answer…"
                      onChange={(e) => setValue(f.id, e.target.value)}
                    />
                  ) : f.type === "select" ? (
                    <select
                      id={inputId}
                      className="input"
                      value={typeof value === "string" ? value : ""}
                      onChange={(e) => setValue(f.id, e.target.value)}
                    >
                      <option value="">Choose an option…</option>
                      {(f.options ?? []).map((opt, i) => (
                        <option key={`${opt}-${i}`} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={inputId}
                      className="input"
                      type={
                        f.type === "email"
                          ? "email"
                          : f.type === "number"
                            ? "number"
                            : f.type === "date"
                              ? "date"
                              : "text"
                      }
                      value={typeof value === "string" ? value : ""}
                      placeholder={
                        f.type === "email"
                          ? "you@example.com"
                          : f.type === "number"
                            ? "0"
                            : f.type === "date"
                              ? ""
                              : "Type your answer…"
                      }
                      onChange={(e) => setValue(f.id, e.target.value)}
                    />
                  )}
                </>
              )}
              {err && <div className="pub-field-err">{err}</div>}
            </div>
          );
        })
      )}

      <div className="pub-foot">
        {requiredCount > 0 && (
          <span className="pub-req-note">
            <span className="pub-req">*</span> Required
          </span>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-lg pub-submit"
          disabled={busy || fields.length === 0}
        >
          {busy ? <span className="spinner" /> : "Submit"}
        </button>
      </div>
    </form>
  );
}
