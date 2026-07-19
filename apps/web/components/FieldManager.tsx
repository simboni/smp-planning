"use client";

/**
 * FieldManager — a modal to manage a space's custom fields (Module 4).
 * Mirrors the StatusManager shell. Add a field (name + type + config),
 * rename, edit dropdown/label options (add / rename / recolor / remove),
 * tweak money currency & rating max, reorder (up/down) and delete.
 * Every mutation refetches the modal's own list and calls `onChanged` so
 * the Task panel underneath re-renders its Custom Fields section.
 */

import { useEffect, useState } from "react";
import {
  ApiError,
  FIELD_TYPE_LABEL,
  fieldsApi,
  type CustomFieldDef,
  type CustomFieldType,
  type FieldOption,
} from "@/lib/api";
import { Icons } from "@/components/icons";

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

const TYPE_ORDER: CustomFieldType[] = [
  "text",
  "number",
  "money",
  "date",
  "dropdown",
  "labels",
  "checkbox",
  "url",
  "email",
  "phone",
  "rating",
  "progress",
];

const hasOptions = (t: CustomFieldType): boolean => t === "dropdown" || t === "labels";

/** Client-side id for a freshly added option row. */
const newOptionId = (): string =>
  `opt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function FieldManager({
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
  const [fields, setFields] = useState<CustomFieldDef[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CustomFieldType>("text");
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  const [swatchFor, setSwatchFor] = useState<string | null>(null);
  const [newOption, setNewOption] = useState("");

  const load = async (): Promise<void> => {
    try {
      const r = await fieldsApi.spaceFields(spaceId);
      setFields([...r.fields].sort((a, b) => a.position - b.position));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load fields.");
      setFields([]);
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

  /* -- field mutations ----------------------------------------------- */
  const add = (): void => {
    const name = newName.trim();
    if (!name) return;
    const config =
      newType === "money"
        ? { currency: "USD" }
        : newType === "rating"
          ? { max: 5 }
          : hasOptions(newType)
            ? { options: [] }
            : {};
    setNewName("");
    void run(async () => {
      const r = await fieldsApi.createField(spaceId, { name, type: newType, config });
      if (hasOptions(newType)) setOpenOptions(r.field.id);
    });
  };

  const rename = (f: CustomFieldDef, name: string): void => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === f.name) return;
    void run(() => fieldsApi.updateField(f.id, { name: trimmed }));
  };

  const reorder = (id: string, dir: -1 | 1): void => {
    if (!fields) return;
    const i = fields.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= fields.length) return;
    const a = fields[i];
    const b = fields[j];
    // Optimistic swap for a snappy feel.
    setFields((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    void run(async () => {
      await fieldsApi.updateField(a.id, { position: j });
      await fieldsApi.updateField(b.id, { position: i });
    });
  };

  const remove = (f: CustomFieldDef): void => {
    if (!window.confirm(`Delete the “${f.name}” field? Its values on tasks are lost.`)) return;
    void run(() => fieldsApi.deleteField(f.id));
  };

  /* -- config mutations ---------------------------------------------- */
  const setCurrency = (f: CustomFieldDef, currency: string): void => {
    const v = currency.trim().toUpperCase();
    if (!v || v === (f.config.currency ?? "")) return;
    void run(() => fieldsApi.updateField(f.id, { config: { ...f.config, currency: v } }));
  };

  const setMax = (f: CustomFieldDef, raw: string): void => {
    const v = Math.max(1, Math.min(10, parseInt(raw, 10) || 5));
    if (v === (f.config.max ?? 5)) return;
    void run(() => fieldsApi.updateField(f.id, { config: { ...f.config, max: v } }));
  };

  const saveOptions = (f: CustomFieldDef, options: FieldOption[]): void => {
    void run(() => fieldsApi.updateField(f.id, { config: { ...f.config, options } }));
  };

  const addOption = (f: CustomFieldDef): void => {
    const name = newOption.trim();
    if (!name) return;
    setNewOption("");
    const color = SWATCHES[(f.config.options?.length ?? 0) % SWATCHES.length];
    saveOptions(f, [...(f.config.options ?? []), { id: newOptionId(), name, color }]);
  };

  const renameOption = (f: CustomFieldDef, optId: string, name: string): void => {
    const v = name.trim();
    const opts = f.config.options ?? [];
    const cur = opts.find((o) => o.id === optId);
    if (!v || !cur || v === cur.name) return;
    saveOptions(f, opts.map((o) => (o.id === optId ? { ...o, name: v } : o)));
  };

  const recolorOption = (f: CustomFieldDef, optId: string, color: string): void => {
    setSwatchFor(null);
    saveOptions(f, (f.config.options ?? []).map((o) => (o.id === optId ? { ...o, color } : o)));
  };

  const removeOption = (f: CustomFieldDef, optId: string): void => {
    saveOptions(f, (f.config.options ?? []).filter((o) => o.id !== optId));
  };

  /* -- render -------------------------------------------------------- */
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal field-mgr"
        role="dialog"
        aria-modal="true"
        aria-label="Manage custom fields"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.sliders}</span>
            <div>
              <h2>Custom fields</h2>
              <p className="muted share-sub">
                Extra columns for every task in {spaceName ? `“${spaceName}”` : "this space"}.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {fields === null ? (
            <div className="share-loading">
              <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 44 }} />
            </div>
          ) : (
            <>
              <div className="stm-list">
                {fields.map((f, i) => (
                  <div className="fm-field" key={f.id}>
                    <div className="stm-row">
                      <span className="fm-type-badge">{FIELD_TYPE_LABEL[f.type]}</span>

                      <input
                        className="input stm-name"
                        defaultValue={f.name}
                        disabled={busy}
                        onBlur={(e) => rename(f, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />

                      {f.type === "money" && (
                        <input
                          className="input fm-config-input"
                          defaultValue={f.config.currency ?? "USD"}
                          maxLength={3}
                          title="Currency code"
                          disabled={busy}
                          onBlur={(e) => setCurrency(f, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      )}
                      {f.type === "rating" && (
                        <label className="fm-config-lbl" title="Maximum stars">
                          max
                          <input
                            className="input fm-config-input"
                            type="number"
                            min={1}
                            max={10}
                            defaultValue={f.config.max ?? 5}
                            disabled={busy}
                            onBlur={(e) => setMax(f, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                          />
                        </label>
                      )}
                      {hasOptions(f.type) && (
                        <button
                          type="button"
                          className={`btn btn-ghost btn-sm fm-opt-toggle${openOptions === f.id ? " on" : ""}`}
                          disabled={busy}
                          onClick={() => {
                            setNewOption("");
                            setOpenOptions((k) => (k === f.id ? null : f.id));
                          }}
                        >
                          {(f.config.options ?? []).length} option
                          {(f.config.options ?? []).length === 1 ? "" : "s"}
                          <span className={`fm-opt-caret${openOptions === f.id ? " open" : ""}`}>
                            {Icons.chevronDown}
                          </span>
                        </button>
                      )}

                      <div className="stm-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          title="Move up"
                          disabled={busy || i === 0}
                          onClick={() => reorder(f.id, -1)}
                        >
                          {Icons.arrowUp}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Move down"
                          disabled={busy || i === fields.length - 1}
                          onClick={() => reorder(f.id, 1)}
                        >
                          {Icons.arrowDown}
                        </button>
                        <button
                          type="button"
                          className="icon-btn stm-del"
                          title="Delete field"
                          disabled={busy}
                          onClick={() => remove(f)}
                        >
                          {Icons.trash}
                        </button>
                      </div>
                    </div>

                    {hasOptions(f.type) && openOptions === f.id && (
                      <div className="fm-options">
                        {(f.config.options ?? []).map((o) => (
                          <div className="fm-option" key={o.id}>
                            <div className="stm-swatch-wrap">
                              <button
                                type="button"
                                className="fm-opt-swatch"
                                style={{ background: o.color }}
                                title="Change color"
                                disabled={busy}
                                onClick={() =>
                                  setSwatchFor((k) => (k === `${f.id}:${o.id}` ? null : `${f.id}:${o.id}`))
                                }
                              />
                              {swatchFor === `${f.id}:${o.id}` && (
                                <div className="stm-swatches" onClick={(e) => e.stopPropagation()}>
                                  {SWATCHES.map((c) => (
                                    <button
                                      key={c}
                                      type="button"
                                      className="tree-swatch"
                                      style={{ background: c }}
                                      onClick={() => recolorOption(f, o.id, c)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                            <input
                              className="input fm-opt-name"
                              defaultValue={o.name}
                              disabled={busy}
                              onBlur={(e) => renameOption(f, o.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                            <button
                              type="button"
                              className="icon-btn stm-del"
                              title="Remove option"
                              disabled={busy}
                              onClick={() => removeOption(f, o.id)}
                            >
                              {Icons.close}
                            </button>
                          </div>
                        ))}
                        <div className="fm-option fm-option-add">
                          <span className="fm-opt-swatch ghost" />
                          <input
                            className="input fm-opt-name"
                            placeholder="New option…"
                            value={newOption}
                            disabled={busy}
                            onChange={(e) => setNewOption(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addOption(f);
                            }}
                          />
                          <button
                            type="button"
                            className="icon-btn"
                            title="Add option"
                            disabled={busy || !newOption.trim()}
                            onClick={() => addOption(f)}
                          >
                            {Icons.plus}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {fields.length === 0 && (
                  <div className="share-empty">
                    No custom fields yet — add your first below.
                  </div>
                )}
              </div>

              <div className="stm-add">
                <input
                  className="input"
                  placeholder="New field name…"
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
                  onChange={(e) => setNewType(e.target.value as CustomFieldType)}
                  aria-label="Type for new field"
                >
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABEL[t]}
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
