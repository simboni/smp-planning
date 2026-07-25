"use client";

/**
 * "New doc" from the sidebar tree — create a blank doc OR upload a file
 * (PDF / Word / anything), both landing in the container's space so the
 * space's members (e.g. a department's roster) see it.
 */

import { useEffect, useRef, useState } from "react";
import { ApiError, docsApi, type Doc } from "@/lib/api";
import { Icons } from "@/components/icons";
import { DOC_EMOJI } from "@/lib/format";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function TreeDocModal({
  spaceId,
  scopeLabel,
  onClose,
  onDone,
}: {
  /** Space the doc/upload attaches to. */
  spaceId: string;
  /** e.g. "in Marketing" — shown in the subtitle. */
  scopeLabel: string;
  onClose: () => void;
  /** Created/uploaded doc; `openEditor` is false for uploads. */
  onDone: (doc: Doc, openEditor: boolean) => void;
}) {
  const [tab, setTab] = useState<"create" | "upload">("create");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(DOC_EMOJI[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (f: File | null): void => {
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      setError("Max file size is 5 MB.");
      return;
    }
    setError("");
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const canSubmit = tab === "create" ? !!name.trim() : !!file;

  const submit = async (): Promise<void> => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError("");
    try {
      if (tab === "create") {
        const r = await docsApi.create({ name: name.trim(), icon, spaceId });
        onDone(r.doc, true);
      } else {
        const dataBase64 = await readBase64(file!);
        const r = await docsApi.upload({
          name: name.trim() || file!.name,
          mime: file!.type || "application/octet-stream",
          dataBase64,
          spaceId,
        });
        onDone(r.doc, false);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : tab === "create"
            ? "Couldn't create the doc."
            : "Couldn't upload the file.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New doc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.docs}</span>
            <div>
              <h2>New doc</h2>
              <p className="muted share-sub">
                Write one, or upload a PDF / Word file {scopeLabel}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          <div className="chips" role="tablist" aria-label="Doc type">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "create"}
              className={`chip${tab === "create" ? " active" : ""}`}
              onClick={() => setTab("create")}
            >
              {Icons.edit} Write a doc
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "upload"}
              className={`chip${tab === "upload" ? " active" : ""}`}
              onClick={() => setTab("upload")}
            >
              {Icons.paperclip} Upload a file
            </button>
          </div>

          {error && <div className="form-error tree-doc-err">{error}</div>}

          {tab === "upload" && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,image/*,application/pdf"
                style={{ display: "none" }}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className={`doc-upload-zone${file ? " has-file" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pick(e.dataTransfer.files?.[0] ?? null);
                }}
              >
                {file ? (
                  <>
                    <span className="doc-upload-name">{file.name}</span>
                    <span className="muted">
                      {formatBytes(file.size)} — click to change
                    </span>
                  </>
                ) : (
                  <>
                    {Icons.paperclip}
                    <span>Drop a file here or click to choose (max 5 MB)</span>
                  </>
                )}
              </button>
            </>
          )}

          <div className="field">
            <label className="label" htmlFor="tree-doc-name">Name</label>
            <input
              id="tree-doc-name"
              className="input"
              placeholder={tab === "create" ? "e.g. Meeting notes" : "Document name"}
              value={name}
              autoFocus={tab === "create"}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          {tab === "create" && (
            <div className="field">
              <span className="label">Icon</span>
              <div className="emoji-row">
                {DOC_EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`emoji-opt${icon === e ? " active" : ""}`}
                    onClick={() => setIcon(e)}
                    aria-label={`Icon ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit || busy}
              onClick={() => void submit()}
            >
              {busy ? (
                <span className="spinner" />
              ) : tab === "create" ? (
                "Create doc"
              ) : (
                "Upload"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
