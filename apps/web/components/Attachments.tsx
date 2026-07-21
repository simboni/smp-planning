"use client";

/**
 * Module 12 — Attachments & Proofing.
 *
 * The "Attachments" section for the Task panel: a grid of uploaded files
 * (image thumbnails, inline clip players, generic file tiles), drag-and-drop
 * + button upload with a 5 MB client guard, per-file download / delete, an
 * annotation-count badge, and two entry points into the richer flows:
 *
 *   • clicking an image opens the {@link ProofViewer} proofing modal;
 *   • "Record clip" mounts the {@link ClipRecorder} screen recorder.
 *
 * All auth'd blobs are fetched via `filesApi.blobUrl` into object URLs that
 * are revoked on unmount / list change.
 */

import { useEffect, useRef, useState } from "react";
import { ApiError, filesApi, type TaskFile } from "@/lib/api";
import { capturePhoto, isNativeApp } from "@/lib/native";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { ProofViewer } from "@/components/ProofViewer";
import { ClipRecorder } from "@/components/ClipRecorder";

const MAX_BYTES = 5 * 1024 * 1024;

/** format.ts has no formatBytes — a tiny local one. */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const isImage = (f: TaskFile): boolean => f.mime.startsWith("image/");
const isVideo = (f: TaskFile): boolean => f.mime.startsWith("video/") || f.isClip;

/** Read a File as base64 (strips the `data:…;base64,` prefix). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== "string") {
        reject(new Error("Unexpected file read result."));
        return;
      }
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read file."));
    reader.readAsDataURL(file);
  });
}

export function Attachments({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<TaskFile[] | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");
  const [viewer, setViewer] = useState<{ id: string; name: string } | null>(null);
  const [recording, setRecording] = useState(false);
  // Native shell only — enables the "Take photo" camera button.
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNativeApp()), []);

  // fileId -> object URL, for image thumbnails and inline clip players.
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  const load = async (): Promise<void> => {
    try {
      const list = await filesApi.list(taskId);
      setFiles(list);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load attachments.");
    }
  };

  useEffect(() => {
    setFiles(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Build object URLs for previewable files; revoke ones no longer present.
  useEffect(() => {
    if (!files) return;
    let cancelled = false;
    const need = files.filter((f) => isImage(f) || isVideo(f));
    const wantIds = new Set(need.map((f) => f.id));

    // Revoke URLs for files that disappeared.
    for (const [id, url] of Object.entries(urlsRef.current)) {
      if (!wantIds.has(id)) {
        URL.revokeObjectURL(url);
        delete urlsRef.current[id];
      }
    }

    void Promise.all(
      need
        .filter((f) => !urlsRef.current[f.id])
        .map(async (f) => {
          try {
            const url = await filesApi.blobUrl(f.id);
            if (cancelled) {
              URL.revokeObjectURL(url);
              return;
            }
            urlsRef.current[f.id] = url;
          } catch {
            /* leave preview blank on failure */
          }
        }),
    ).then(() => {
      if (!cancelled) setUrls({ ...urlsRef.current });
    });

    return () => {
      cancelled = true;
    };
  }, [files]);

  // Revoke everything on unmount.
  useEffect(() => {
    return () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = {};
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const uploadFiles = async (list: FileList | File[]): Promise<void> => {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setUploading(true);
    setError("");
    try {
      for (const file of arr) {
        if (file.size > MAX_BYTES) {
          flash("Max 5MB");
          continue;
        }
        const dataBase64 = await readBase64(file);
        const created = await filesApi.upload(taskId, {
          name: file.name,
          mime: file.type || "application/octet-stream",
          dataBase64,
        });
        // Optimistic add — the refetch below reconciles.
        setFiles((prev) => (prev ? [created, ...prev.filter((p) => p.id !== created.id)] : [created]));
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  /** Native only: snap (or pick) a photo and upload it as an attachment. */
  const takePhoto = async (): Promise<void> => {
    const photo = await capturePhoto();
    if (!photo) return; // cancelled or not native
    setUploading(true);
    setError("");
    try {
      const created = await filesApi.upload(taskId, {
        name: photo.name,
        mime: photo.mime,
        dataBase64: photo.base64,
      });
      setFiles((prev) => (prev ? [created, ...prev.filter((p) => p.id !== created.id)] : [created]));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    if (!canEdit) return;
    if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files);
  };

  const download = async (f: TaskFile): Promise<void> => {
    try {
      const url = await filesApi.blobUrl(f.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      flash("Couldn't download file");
    }
  };

  const remove = (f: TaskFile): void => {
    if (!window.confirm(`Delete “${f.name}”?`)) return;
    void (async () => {
      try {
        await filesApi.remove(f.id);
        const u = urlsRef.current[f.id];
        if (u) {
          URL.revokeObjectURL(u);
          delete urlsRef.current[f.id];
        }
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't delete file.");
      }
    })();
  };

  const count = files?.length ?? 0;

  return (
    <section className="tp-section">
      <div className="tp-section-head">
        <h3 className="tp-section-title">
          {Icons.paperclip} Attachments
          {count > 0 && <span className="tp-count-badge">{count}</span>}
        </h3>
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            {native && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void takePhoto()}
                disabled={uploading}
              >
                📷 Take photo
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRecording(true)}
            >
              🎥 Record clip
            </button>
            <button
              type="button"
              className="btn btn-soft btn-sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {Icons.plus} Upload
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && <div className="form-error">{error}</div>}

      {canEdit && (
        <div
          className={`att-drop${dragging ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (canEdit) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "14px 16px",
            marginBottom: 12,
            border: `1.5px dashed ${dragging ? "var(--brand)" : "var(--line)"}`,
            borderRadius: "var(--r-md)",
            background: dragging ? "var(--brand-soft)" : "var(--card-2)",
            color: "var(--muted)",
            fontSize: "0.85rem",
            cursor: "pointer",
            transition: "border-color .12s ease, background .12s ease",
          }}
        >
          {uploading ? (
            <>
              <span className="spinner" style={{ width: 15, height: 15 }} /> Uploading…
            </>
          ) : (
            <>
              {Icons.paperclip} Drop files here or click to upload · max 5 MB
            </>
          )}
        </div>
      )}

      {files === null ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
          <span className="skel" style={{ height: 120 }} />
          <span className="skel" style={{ height: 120 }} />
        </div>
      ) : files.length === 0 ? (
        <div className="tp-empty tp-empty-pad">No attachments yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
          {files.map((f) => (
            <FileTile
              key={f.id}
              file={f}
              url={urls[f.id]}
              canEdit={canEdit}
              onOpenProof={() => setViewer({ id: f.id, name: f.name })}
              onDownload={() => void download(f)}
              onDelete={() => remove(f)}
            />
          ))}
        </div>
      )}

      {viewer && (
        <ProofViewer
          fileId={viewer.id}
          fileName={viewer.name}
          canEdit={canEdit}
          onClose={() => {
            setViewer(null);
            void load(); // annotation counts may have changed
          }}
        />
      )}

      {recording && (
        <ClipRecorder
          taskId={taskId}
          onDone={() => {
            setRecording(false);
            void load();
          }}
          onCancel={() => setRecording(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * A single file tile.
 * ------------------------------------------------------------------ */
function FileTile({
  file,
  url,
  canEdit,
  onOpenProof,
  onDownload,
  onDelete,
}: {
  file: TaskFile;
  url: string | undefined;
  canEdit: boolean;
  onOpenProof: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const image = isImage(file);
  const video = isVideo(file);

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        background: "var(--card)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-1)",
      }}
    >
      {/* preview */}
      <div
        style={{
          position: "relative",
          height: 108,
          background: "var(--card-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: image ? "pointer" : "default",
        }}
        onClick={image ? onOpenProof : undefined}
        title={image ? "Open proofing view" : undefined}
      >
        {image ? (
          url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={file.name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span className="spinner" style={{ width: 16, height: 16 }} />
          )
        ) : video ? (
          url ? (
            <video
              src={url}
              controls
              style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
            />
          ) : (
            <span className="spinner" style={{ width: 16, height: 16 }} />
          )
        ) : (
          <span style={{ color: "var(--muted)", display: "inline-flex", alignItems: "center" }}>
            {file.isClip ? Icons.play : Icons.paperclip}
          </span>
        )}
        {file.annotationCount > 0 && (
          <span
            className="tp-count-badge"
            style={{ position: "absolute", top: 6, right: 6, background: "var(--brand)", color: "#fff" }}
            title={`${file.annotationCount} annotation${file.annotationCount === 1 ? "" : "s"}`}
          >
            {Icons.chat} {file.annotationCount}
          </span>
        )}
        {image && (
          <span
            style={{
              position: "absolute",
              bottom: 6,
              left: 6,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: 999,
              background: "rgba(10,12,20,0.62)",
              color: "#fff",
              fontSize: "0.7rem",
              fontWeight: 600,
            }}
          >
            {Icons.eye} Proof
          </span>
        )}
      </div>

      {/* meta */}
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{
            fontSize: "0.82rem",
            fontWeight: 600,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={file.name}
        >
          {file.name}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Avatar
            name={file.author.fullName}
            id={file.author.id}
            avatarUrl={file.author.avatarUrl}
            className="avatar-sm"
            title={file.author.fullName}
          />
          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
            {formatBytes(file.sizeBytes)} · {timeAgo(file.createdAt)}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="icon-btn"
            title="Download"
            onClick={onDownload}
            style={{ width: 26, height: 26 }}
          >
            {Icons.arrowDown}
          </button>
          {canEdit && (
            <button
              type="button"
              className="icon-btn"
              title="Delete"
              onClick={onDelete}
              style={{ width: 26, height: 26 }}
            >
              {Icons.close}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
