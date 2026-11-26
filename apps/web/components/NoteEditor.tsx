"use client";

/**
 * One editable note — shared by the Notepad panel and the Notes page so both
 * surfaces behave identically and there is only one copy of the save logic.
 *
 * Saving rules (the previous inline version swallowed every failure with
 * `.catch(() => undefined)`, so a note could silently fail to save and the
 * user would never know):
 *   - debounce 700ms after the last keystroke;
 *   - flush any pending text on blur and on unmount (panel close / navigation);
 *   - a monotonic sequence number so a slow earlier response can't be treated
 *     as the latest state;
 *   - failures are surfaced on the row AND retried on the next edit, never
 *     hidden.
 */

import { useEffect, useRef, useState } from "react";
import { notesApi, type Note } from "@/lib/api";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";

type SaveState = "idle" | "saving" | "saved" | "error";

export function NoteEditor({
  note,
  autoFocus = false,
  onDelete,
  onToTask,
  onSaved,
}: {
  note: Note;
  autoFocus?: boolean;
  onDelete: (id: string) => void;
  onToTask: (note: Note) => void;
  /** Fired after a successful save with the text that landed on the server. */
  onSaved?: (id: string, content: string) => void;
}) {
  const [text, setText] = useState(note.content);
  const [state, setState] = useState<SaveState>("idle");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last value known to be ON the server (or in flight toward it). */
  const savedRef = useRef(note.content);
  const seqRef = useRef(0);

  // Autosize to content.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  const save = (value: string): void => {
    if (value === savedRef.current) return;
    const seq = ++seqRef.current;
    setState("saving");
    notesApi
      .update(note.id, { content: value })
      .then(() => {
        if (seq !== seqRef.current) return; // a newer save is in flight
        savedRef.current = value;
        setState("saved");
        onSaved?.(note.id, value);
      })
      .catch(() => {
        if (seq !== seqRef.current) return;
        // Leave savedRef alone so the next edit (or blur) retries this text.
        setState("error");
      });
  };

  const queueSave = (value: string): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      save(value);
    }, 700);
  };

  const flush = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const value = areaRef.current?.value;
    if (value !== undefined) save(value);
  };

  // Flush pending text when the row goes away (panel close / navigation).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const value = areaRef.current?.value;
      if (value !== undefined && value !== savedRef.current) {
        // Fire-and-forget on unmount: there's no component left to tell.
        notesApi.update(note.id, { content: value }).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = text !== savedRef.current;

  return (
    <div className={`np-note${state === "error" ? " np-note-error" : ""}`}>
      <textarea
        ref={areaRef}
        className="np-area"
        placeholder="Jot something down…"
        value={text}
        rows={1}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          queueSave(e.target.value);
        }}
        onBlur={flush}
      />
      <div className="np-note-foot">
        <span className="np-time">
          {state === "saving"
            ? "Saving…"
            : state === "error"
              ? "Not saved — retrying on your next edit"
              : dirty
                ? "Unsaved"
                : state === "saved"
                  ? "Saved"
                  : timeAgo(note.updatedAt)}
        </span>
        <span className="np-note-actions">
          {state === "error" && (
            <button
              type="button"
              className="np-mini"
              title="Try saving again"
              onClick={flush}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="np-mini"
            title="Turn into a task"
            onClick={() => {
              flush();
              onToTask({ ...note, content: text });
            }}
          >
            → task
          </button>
          <button
            type="button"
            className="icon-btn np-del"
            aria-label="Delete note"
            onClick={() => onDelete(note.id)}
          >
            {Icons.trash}
          </button>
        </span>
      </div>
    </div>
  );
}
