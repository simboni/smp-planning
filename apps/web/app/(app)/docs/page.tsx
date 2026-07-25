"use client";

/**
 * Module 7 — Docs home: every doc you can see, plus creation.
 *
 * Cards show the doc's emoji, name, where it lives (space chip /
 * Workspace / Private), page count and a relative "updated" time.
 * "New Doc" opens a small modal: name, emoji from a preset row, an
 * optional Space (from the shared hierarchy) and a Private toggle
 * that only applies when the doc stays unattached.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  docsApi,
  filesApi,
  permissionAtLeast,
  type Doc,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { DOC_EMOJI, timeAgo } from "@/lib/format";
import { showToast } from "@/lib/toast";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human label for an uploaded document's type. */
function mimeLabel(mime: string | null | undefined): string {
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf") return "PDF";
  if (m.includes("word") || m.includes("wordprocessing")) return "Word";
  if (m.includes("spreadsheet") || m.includes("excel") || m === "text/csv") return "Sheet";
  if (m.includes("presentation") || m.includes("powerpoint")) return "Slides";
  if (m.startsWith("image/")) return "Image";
  return "File";
}

/** FileReader → bare base64 (same pattern as task attachments). */
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

function NewDocModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (doc: Doc) => void;
}) {
  const { tree } = useHierarchy();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(DOC_EMOJI[0]);
  const [spaceId, setSpaceId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const spaces = tree.filter((s) => permissionAtLeast(s.myPermission, "edit"));

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await docsApi.create({
        name: trimmed,
        icon,
        spaceId: spaceId || null,
        isPrivate: spaceId ? false : isPrivate,
      });
      onCreated(r.doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the doc.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.docs}</span>
            <div>
              <h2>New Doc</h2>
              <p className="muted share-sub">A home for specs, wikis and long-form thinking.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="doc-name">Name</label>
            <input
              id="doc-name"
              className="input"
              placeholder="e.g. Engineering Wiki"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

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

          <div className="field">
            <label className="label" htmlFor="doc-space">Location</label>
            <select
              id="doc-space"
              className="input"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              <option value="">Workspace (no space)</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon ? `${s.icon} ` : ""}{s.name}
                </option>
              ))}
            </select>
          </div>

          {!spaceId && (
            <button
              type="button"
              className={`doc-priv-toggle${isPrivate ? " on" : ""}`}
              onClick={() => setIsPrivate((v) => !v)}
            >
              <span className="doc-priv-ic">{Icons.lock}</span>
              <span className="doc-priv-text">
                <span className="doc-priv-title">Private</span>
                <span className="doc-priv-sub">Only you can see this doc.</span>
              </span>
              <span className={`switch${isPrivate ? " on" : ""}`} aria-hidden="true" />
            </button>
          )}

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim() || busy}
              onClick={() => void submit()}
            >
              {busy ? "Creating…" : "Create Doc"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Upload-document modal: PDF / Word / any file becomes a first-class doc,
 * with the same location + privacy choices as a created doc. Attaching to a
 * department's home space shares it with the whole department.
 */
function UploadDocModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: (doc: Doc) => void;
}) {
  const { tree } = useHierarchy();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const spaces = tree.filter((s) => permissionAtLeast(s.myPermission, "edit"));

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

  const submit = async (): Promise<void> => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const dataBase64 = await readBase64(file);
      const r = await docsApi.upload({
        name: name.trim() || file.name,
        mime: file.type || "application/octet-stream",
        dataBase64,
        spaceId: spaceId || null,
        isPrivate: spaceId ? false : isPrivate,
      });
      onUploaded(r.doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload the file.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.paperclip ?? Icons.docs}</span>
            <div>
              <h2>Upload document</h2>
              <p className="muted share-sub">
                PDFs, Word files and more — living beside your docs (max 5 MB).
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,image/*,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className={`doc-upload-zone${file ? " has-file" : ""}`}
            onClick={() => inputRef.current?.click()}
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
                  {mimeLabel(file.type)} · {formatBytes(file.size)} — click to change
                </span>
              </>
            ) : (
              <>
                {Icons.paperclip ?? Icons.docs}
                <span>Drop a file here or click to choose</span>
              </>
            )}
          </button>

          <div className="field">
            <label className="label" htmlFor="up-name">Name</label>
            <input
              id="up-name"
              className="input"
              placeholder="Document name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="up-space">Location</label>
            <select
              id="up-space"
              className="input"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              <option value="">Workspace (no space)</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon ? `${s.icon} ` : ""}{s.name}
                </option>
              ))}
            </select>
          </div>

          {!spaceId && (
            <button
              type="button"
              className={`doc-priv-toggle${isPrivate ? " on" : ""}`}
              onClick={() => setIsPrivate((v) => !v)}
            >
              <span className="doc-priv-ic">{Icons.lock}</span>
              <span className="doc-priv-text">
                <span className="doc-priv-title">Private</span>
                <span className="doc-priv-sub">Only you can see this document.</span>
              </span>
              <span className={`switch${isPrivate ? " on" : ""}`} aria-hidden="true" />
            </button>
          )}

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || busy}
              onClick={() => void submit()}
            >
              {busy ? <span className="spinner" /> : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DocsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = (): void => {
    docsApi
      .list()
      .then((r) => setDocs(r.docs ?? []))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load your docs.");
        setDocs([]);
      });
  };

  useEffect(() => {
    load();
  }, []);

  /** Open an uploaded document: PDFs/images view in a new tab, else download. */
  const openUpload = async (d: Doc): Promise<void> => {
    if (!d.fileId) return;
    try {
      const url = await filesApi.blobUrl(d.fileId);
      const m = (d.fileMime ?? "").toLowerCase();
      if (m === "application/pdf" || m.startsWith("image/")) {
        window.open(url, "_blank", "noopener");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = d.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch {
      showToast("Couldn't open the document.");
    }
  };

  const removeUpload = async (d: Doc): Promise<void> => {
    if (!window.confirm(`Delete “${d.name}”? The file is removed for everyone.`)) return;
    try {
      await docsApi.remove(d.id);
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't delete it.");
    }
  };

  const sorted = useMemo(
    () =>
      [...(docs ?? [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [docs],
  );

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Docs</h1>
          <p className="sub">Wikis, specs and notes — living next to the work.</p>
        </div>
        <div className="hr-head-actions">
          <button type="button" className="btn btn-soft" onClick={() => setUploading(true)}>
            {Icons.paperclip ?? Icons.docs}
            Upload
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {Icons.plus}
            New Doc
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {docs === null ? (
        <div className="docs-grid">
          <span className="skel" style={{ height: 128, borderRadius: 14 }} />
          <span className="skel" style={{ height: 128, borderRadius: 14 }} />
          <span className="skel" style={{ height: 128, borderRadius: 14 }} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.docs}</span>
          <h3>No docs yet</h3>
          <p>Start a wiki for your team or a private scratch doc for yourself.</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {Icons.plus}
            Create your first doc
          </button>
        </div>
      ) : (
        <div className="docs-grid">
          {sorted.map((d) =>
            d.fileId ? (
              <button
                key={d.id}
                type="button"
                className="doc-card card-hover doc-card-upload"
                onClick={() => void openUpload(d)}
                title="Open document"
              >
                <span className="doc-card-ic" aria-hidden="true">{d.icon || "📎"}</span>
                <span className="doc-card-name">{d.name}</span>
                <span className="doc-card-meta">
                  {d.spaceId ? (
                    <span className="doc-chip doc-chip-space">{d.spaceName ?? "Space"}</span>
                  ) : d.isPrivate ? (
                    <span className="doc-chip doc-chip-private">{Icons.lock} Private</span>
                  ) : (
                    <span className="doc-chip">{Icons.globe} Workspace</span>
                  )}
                  <span className="doc-card-sub">
                    {mimeLabel(d.fileMime)}
                    {d.fileSizeBytes ? ` · ${formatBytes(d.fileSizeBytes)}` : ""} ·{" "}
                    {timeAgo(d.updatedAt)}
                  </span>
                </span>
                <span
                  className="icon-btn doc-card-del"
                  role="button"
                  aria-label={`Delete ${d.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeUpload(d);
                  }}
                >
                  {Icons.trash ?? Icons.close}
                </span>
              </button>
            ) : (
              <Link key={d.id} href={`/doc?id=${d.id}`} className="doc-card card-hover">
                <span className="doc-card-ic" aria-hidden="true">{d.icon || "📄"}</span>
                <span className="doc-card-name">{d.name}</span>
                <span className="doc-card-meta">
                  {d.spaceId ? (
                    <span className="doc-chip doc-chip-space">{d.spaceName ?? "Space"}</span>
                  ) : d.isPrivate ? (
                    <span className="doc-chip doc-chip-private">{Icons.lock} Private</span>
                  ) : (
                    <span className="doc-chip">{Icons.globe} Workspace</span>
                  )}
                  <span className="doc-card-sub">
                    {d.pageCount} {d.pageCount === 1 ? "page" : "pages"} · {timeAgo(d.updatedAt)}
                  </span>
                </span>
              </Link>
            ),
          )}
        </div>
      )}

      {creating && (
        <NewDocModal
          onClose={() => setCreating(false)}
          onCreated={(doc) => router.push(`/doc?id=${doc.id}`)}
        />
      )}

      {uploading && (
        <UploadDocModal
          onClose={() => setUploading(false)}
          onUploaded={(doc) => {
            setUploading(false);
            load();
            showToast(`Uploaded “${doc.name}”`);
          }}
        />
      )}
    </div>
  );
}
