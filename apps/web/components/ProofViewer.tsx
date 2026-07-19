"use client";

/**
 * Module 12 — the proofing modal (the showpiece).
 *
 * A near-full-screen viewer for an image attachment. The image fills the
 * left; clicking it (when editing) drops a numbered pin at the fractional
 * click position and opens an inline composer. Existing annotations render
 * as numbered pins and as rows in the right rail; hovering either side
 * highlights the other. Rows can be resolved (dim + strike) or deleted by
 * their author. Esc / the ✕ closes.
 */

import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  annotationsApi,
  filesApi,
  getUser,
  type ProofAnnotation,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor, initials, timeAgo } from "@/lib/format";

export function ProofViewer({
  fileId,
  fileName,
  canEdit,
  onClose,
}: {
  fileId: string;
  fileName: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [ann, setAnn] = useState<ProofAnnotation[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  // A pending pin the user is composing (fractional coords) + its text.
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [draftBody, setDraftBody] = useState("");

  const me = getUser();
  const urlRef = useRef<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const list = await annotationsApi.list(fileId);
      setAnn(
        [...list].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      );
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load annotations.");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Load the image blob.
  useEffect(() => {
    let cancelled = false;
    void filesApi
      .blobUrl(fileId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        urlRef.current = u;
        setUrl(u);
      })
      .catch(() => setError("Couldn't load the image."));
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [fileId]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (draft) {
          setDraft(null);
          setDraftBody("");
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, draft]);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const onImageClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!canEdit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setDraft({ x, y });
    setDraftBody("");
  };

  const submitDraft = (): void => {
    if (!draft) return;
    const body = draftBody.trim();
    if (!body) {
      setDraft(null);
      return;
    }
    const pin = draft;
    setDraft(null);
    setDraftBody("");
    void run(() => annotationsApi.add(fileId, { x: pin.x, y: pin.y, body }));
  };

  const toggleResolve = (a: ProofAnnotation): void => {
    void run(() => annotationsApi.update(a.id, { resolved: a.resolvedAt === null }));
  };
  const removeAnn = (a: ProofAnnotation): void => {
    void run(() => annotationsApi.remove(a.id));
  };

  const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      style={{ alignItems: "center", padding: "4vh 3vw", zIndex: 90 }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Proofing ${fileName}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1180px, 100%)",
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          height: "min(88vh, 900px)",
        }}
      >
        {/* header */}
        <div className="modal-head" style={{ padding: "12px 16px" }}>
          <div className="modal-head-body" style={{ alignItems: "center" }}>
            <span className="modal-ic" style={{ width: 32, height: 32 }}>
              {Icons.eye}
            </span>
            <div style={{ minWidth: 0 }}>
              <h2
                style={{
                  fontSize: "0.98rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={fileName}
              >
                {fileName}
              </h2>
              <span className="share-sub muted" style={{ fontSize: "0.78rem" }}>
                {canEdit ? "Click the image to add a comment" : "Proofing"}
              </span>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        {error && (
          <div className="form-error" style={{ margin: "8px 16px 0" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* image / pin stage */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--card-2)",
              padding: 16,
              overflow: "auto",
            }}
          >
            {!url ? (
              <span className="spinner" />
            ) : (
              <div
                style={{
                  position: "relative",
                  display: "inline-block",
                  cursor: canEdit ? "crosshair" : "default",
                  lineHeight: 0,
                }}
                onClick={onImageClick}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={fileName}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "72vh",
                    borderRadius: 6,
                    boxShadow: "var(--shadow-2)",
                    display: "block",
                  }}
                />
                {(ann ?? []).map((a, i) => {
                  const resolved = a.resolvedAt !== null;
                  const on = active === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActive(a.id);
                      }}
                      onMouseEnter={() => setActive(a.id)}
                      onMouseLeave={() => setActive((c) => (c === a.id ? null : c))}
                      title={a.body}
                      style={{
                        position: "absolute",
                        left: pct(a.x),
                        top: pct(a.y),
                        transform: "translate(-50%, -50%)",
                        width: on ? 30 : 26,
                        height: on ? 30 : 26,
                        borderRadius: "50%",
                        border: "2px solid #fff",
                        background: resolved ? "var(--ok)" : "var(--brand)",
                        color: "#fff",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        boxShadow: on ? "0 0 0 4px var(--brand-soft-2)" : "var(--shadow-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: resolved ? 0.75 : 1,
                        transition: "width .1s ease, height .1s ease",
                        zIndex: on ? 3 : 2,
                        padding: 0,
                      }}
                    >
                      {resolved ? Icons.check : i + 1}
                    </button>
                  );
                })}

                {/* pending draft pin + composer */}
                {draft && (
                  <div
                    style={{
                      position: "absolute",
                      left: pct(draft.x),
                      top: pct(draft.y),
                      transform: "translate(-50%, -50%)",
                      zIndex: 5,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        transform: "translate(-50%, -50%)",
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        border: "2px solid #fff",
                        background: "var(--brand)",
                        boxShadow: "0 0 0 4px var(--brand-soft-2)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 18,
                        top: 18,
                        width: 240,
                        background: "var(--card)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-md)",
                        boxShadow: "var(--shadow-3)",
                        padding: 10,
                        lineHeight: 1.4,
                      }}
                    >
                      <textarea
                        className="cm-input"
                        autoFocus
                        rows={3}
                        placeholder="Add a comment…"
                        value={draftBody}
                        style={{ width: "100%", resize: "none" }}
                        onChange={(e) => setDraftBody(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            submitDraft();
                          }
                        }}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setDraft(null);
                            setDraftBody("");
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy || !draftBody.trim()}
                          onClick={submitDraft}
                        >
                          {Icons.send} Comment
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* right rail */}
          <div
            style={{
              width: 320,
              flexShrink: 0,
              borderLeft: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--line-soft)",
                fontSize: "0.8rem",
                fontWeight: 700,
                color: "var(--ink-2)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {Icons.chat} Comments
              {ann && ann.length > 0 && <span className="tp-count-badge">{ann.length}</span>}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
              {ann === null ? (
                <>
                  <span className="skel" style={{ height: 44, marginBottom: 8, display: "block" }} />
                  <span className="skel" style={{ height: 44, display: "block" }} />
                </>
              ) : ann.length === 0 ? (
                <div className="tp-empty tp-empty-pad">
                  {canEdit ? "No comments — click the image to add one." : "No comments."}
                </div>
              ) : (
                ann.map((a, i) => {
                  const resolved = a.resolvedAt !== null;
                  const mine = me !== null && a.author.id === me.id;
                  const on = active === a.id;
                  return (
                    <div
                      key={a.id}
                      onMouseEnter={() => setActive(a.id)}
                      onMouseLeave={() => setActive((c) => (c === a.id ? null : c))}
                      style={{
                        display: "flex",
                        gap: 8,
                        padding: 8,
                        borderRadius: "var(--r-sm)",
                        marginBottom: 4,
                        background: on ? "var(--brand-soft)" : "transparent",
                        opacity: resolved ? 0.6 : 1,
                        transition: "background .1s ease",
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: resolved ? "var(--ok)" : "var(--brand)",
                          color: "#fff",
                          fontSize: "0.72rem",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {resolved ? Icons.check : i + 1}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            className="avatar avatar-sm"
                            style={{
                              background: colorFor(a.author.id),
                              width: 18,
                              height: 18,
                              fontSize: "0.55rem",
                            }}
                            title={a.author.fullName}
                          >
                            {initials(a.author.fullName)}
                          </span>
                          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--ink)" }}>
                            {a.author.fullName}
                          </span>
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                            {timeAgo(a.createdAt)}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.83rem",
                            color: "var(--ink-2)",
                            marginTop: 3,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            textDecoration: resolved ? "line-through" : "none",
                          }}
                        >
                          {a.body}
                        </div>
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          <button
                            type="button"
                            className={`cm-action cm-resolve${resolved ? " on" : ""}`}
                            onClick={() => toggleResolve(a)}
                            disabled={busy}
                          >
                            {Icons.checkCircle}
                            {resolved ? "Reopen" : "Resolve"}
                          </button>
                          {mine && (
                            <button
                              type="button"
                              className="cm-action danger"
                              onClick={() => removeAnn(a)}
                              disabled={busy}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
