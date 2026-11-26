"use client";

/**
 * One editable note: autosizing textarea, debounced autosave, and a visible
 * save state. Shared by the 🗒 panel, the Notes page and the Home card, which
 * all read and write the same server-side notes.
 *
 * A failed save is shown on the note with a retry (it used to be swallowed,
 * so a note could look saved and be gone on the next load).
 */

import { useEffect, useRef, useState } from "react";
import { notesApi, type Note } from "@/lib/api";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { notesChanged } from "@/lib/notes";

type SaveState = "idle" | "saving" | "saved" | "error";

export function NoteEditor({
  note,
  autoFocus = false,
  maxHeight = 220,
  onDelete,
  onToTask,
  onSaved,
}: {
  note: Note;
  autoFocus?: boolean;
  maxHeight?: number;
  onDelete: (id: string) => void;
  onToTask?: (note: Note) => void;
  onSaved?: (note: Note) => void;
}) {
  const [text, setText] = useState(note.content);
  const [state, setState] = useState<SaveState>("idle");
  const [updatedAt, setUpdatedAt] = useState(note.updatedAt);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(note.content);
  const seqRef = useRef(0);

  const resize = (): void => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };
  useEffect(resize, [text, maxHeight]);

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus]);

  const save = (value: string): void => {
    if (value === savedRef.current) {
      setState((s) => (s === "error" ? "saved" : s));
      return;
    }
    const seq = ++seqRef.current;
    setState("saving");
    notesApi
      .update(note.id, { content: value })
      .then((r) => {
        if (seq !== seqRef.current) return; // a newer save is in flight
        savedRef.current = value;
        setUpdatedAt(r.note.updatedAt);
        setState("saved");
        onSaved?.(r.note);
        notesChanged();
      })
      .catch(() => {
        if (seq === seqRef.current) setState("error");
      });
  };

  const queueSave = (value: string): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      save(value);
    }, 700);
  };

  // Flush a pending save when the editor goes away (panel closed, page left).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const value = areaRef.current?.value;
      if (value !== undefined && value !== savedRef.current) {
        notesApi.update(note.id, { content: value }).then(() => notesChanged()).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`np-note${state === "error" ? " np-note-error" : ""}`} id={`note-${note.id}`}>
      <textarea
        ref={areaRef}
        className="np-area"
        placeholder="Jot something down…"
        value={text}
        rows={1}
        onChange={(e) => {
          setText(e.target.value);
          queueSave(e.target.value);
        }}
        onBlur={(e) => {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          save(e.target.value);
        }}
      />
      <div className="np-note-foot">
        <span className="np-time">
          {state === "saving" ? (
            "Saving…"
          ) : state === "error" ? (
            <button type="button" className="np-retry" onClick={() => save(areaRef.current?.value ?? text)}>
              Not saved — retry
            </button>
          ) : (
            timeAgo(updatedAt)
          )}
        </span>
        <span className="np-note-actions">
          {onToTask && (
            <button
              type="button"
              className="np-mini"
              title="Turn into a task"
              onClick={() => onToTask({ ...note, content: areaRef.current?.value ?? text })}
            >
              → task
            </button>
          )}
          <button type="button" className="icon-btn np-del" aria-label="Delete note" onClick={() => onDelete(note.id)}>
            {Icons.trash}
          </button>
        </span>
      </div>
    </div>
  );
}
