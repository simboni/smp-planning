"use client";

/**
 * Module 12 — the screen-clip recorder.
 *
 * Mounted from {@link Attachments}. Immediately requests a screen-share via
 * `getDisplayMedia`, records to a `video/webm` Blob with `MediaRecorder`,
 * shows a red "● Recording…" pill + elapsed timer + Stop, then uploads the
 * clip as a task file (`isClip:true`). Guards a 5 MB ceiling and the case
 * where display capture is unavailable or denied.
 */

import { useEffect, useRef, useState } from "react";
import { ApiError, filesApi } from "@/lib/api";
import { Icons } from "@/components/icons";

const MAX_BYTES = 5 * 1024 * 1024;

type Phase = "requesting" | "recording" | "processing" | "error";

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== "string") {
        reject(new Error("Unexpected read result."));
        return;
      }
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read clip."));
    reader.readAsDataURL(blob);
  });
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ClipRecorder({
  taskId,
  onDone,
  onCancel,
}: {
  taskId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("requesting");
  const [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false); // guard double-finish

  const stopTimer = (): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopTracks = (): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const finishWithBlob = async (): Promise<void> => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopTimer();
    setPhase("processing");
    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    chunksRef.current = [];
    stopTracks();

    if (blob.size === 0) {
      onCancel();
      return;
    }
    if (blob.size > MAX_BYTES) {
      setPhase("error");
      setMessage("Clip too long (max 5MB) — record a shorter clip");
      return;
    }
    try {
      const dataBase64 = await readBase64(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      await filesApi.upload(taskId, {
        name: `Clip ${stamp}.webm`,
        mime: "video/webm",
        dataBase64,
        isClip: true,
      });
      onDone();
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof ApiError ? err.message : "Couldn't upload the clip.");
    }
  };

  // Kick off capture on mount.
  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
      if (!md || typeof md.getDisplayMedia !== "function" || typeof MediaRecorder === "undefined") {
        setPhase("error");
        setMessage("Screen recording isn't supported in this browser.");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await md.getDisplayMedia({ video: true, audio: true });
      } catch {
        if (!cancelled) {
          setPhase("error");
          setMessage("Screen capture was blocked or cancelled.");
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      let recorder: MediaRecorder;
      try {
        recorder = MediaRecorder.isTypeSupported("video/webm")
          ? new MediaRecorder(stream, { mimeType: "video/webm" })
          : new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        setPhase("error");
        setMessage("Couldn't start the recorder.");
        return;
      }
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void finishWithBlob();
      // If the user ends the share from the browser's own UI, stop cleanly.
      stream.getVideoTracks().forEach((t) => {
        t.onended = () => {
          if (recorderRef.current && recorderRef.current.state !== "inactive") {
            recorderRef.current.stop();
          }
        };
      });

      recorder.start();
      setPhase("recording");
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 500);
    };

    void start();

    return () => {
      cancelled = true;
      stopTimer();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      stopTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = (): void => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else void finishWithBlob();
  };

  return (
    <div className="modal-scrim" style={{ alignItems: "center", zIndex: 95 }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Record a clip"
        style={{ width: "min(420px, 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body" style={{ alignItems: "center" }}>
            <span className="modal-ic">{Icons.play}</span>
            <div>
              <h2>Record a clip</h2>
              <span className="share-sub muted">Capture your screen · max 5 MB</span>
            </div>
          </div>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          {phase === "requesting" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)" }}>
              <span className="spinner" /> Waiting for screen-share permission…
            </div>
          )}

          {phase === "recording" && (
            <>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 999,
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--danger)",
                    animation: "timer-pulse 1s ease-in-out infinite",
                  }}
                />
                Recording…
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "1.6rem", fontWeight: 700 }}>
                {fmtElapsed(elapsed)}
              </span>
              <button type="button" className="btn btn-primary" onClick={stop}>
                {Icons.stop} Stop &amp; save
              </button>
            </>
          )}

          {phase === "processing" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)" }}>
              <span className="spinner" /> Uploading clip…
            </div>
          )}

          {phase === "error" && (
            <>
              <div className="form-error" style={{ width: "100%", textAlign: "center" }}>
                {message}
              </div>
              <button type="button" className="btn btn-ghost" onClick={onCancel}>
                Close
              </button>
            </>
          )}
        </div>

        {phase !== "error" && phase !== "processing" && (
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
