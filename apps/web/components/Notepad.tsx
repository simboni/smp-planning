"use client";

/**
 * Module 7 — Notepad: a slide-up scratchpad that follows you everywhere.
 *
 * A floating button in the bottom-right of the app shell toggles a compact
 * panel of personal notes (most recent first). Notes autosave with a short
 * debounce, and any note can be promoted to a task: pick a Space → List
 * (from the shared hierarchy), the first line becomes the task name and the
 * rest its description, then the note is deleted.
 *
 * Open/closed state persists in localStorage (`stackup.notepad.open`),
 * guarded for the static export's server render.
 *
 * Notes themselves are NOT local: they're rows in `notes` (per user, per
 * workspace) served by /notes, so the same notes appear here, on the /notes
 * page, in the Home "Notepad" card and in search. The closed button carries a
 * count so notes aren't invisible once the panel is shut.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { notesApi, tasksApi, type Note } from "@/lib/api";
import { ListDestinationPicker } from "@/components/ListDestinationPicker";
import { NoteEditor } from "@/components/NoteEditor";
import { Icons } from "@/components/icons";

const OPEN_KEY = "stackup.notepad.open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* in-memory session only */
  }
}

export function Notepad() {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  /** Count shown on the closed button, so notes aren't invisible. */
  const [count, setCount] = useState<number | null>(null);

  // The "→ task" picker: which note it's for.
  const [picking, setPicking] = useState<Note | null>(null);

  // Hydrate the persisted open state client-side only.
  useEffect(() => {
    setOpen(readOpen());
    setHydrated(true);
  }, []);

  // Load notes when the panel opens (and refresh on reopen).
  useEffect(() => {
    if (!open) return;
    notesApi
      .list()
      .then((r) => {
        setNotes(r.notes ?? []);
        setCount((r.notes ?? []).length);
      })
      .catch(() => setNotes([]));
  }, [open]);

  // While closed, still learn the count once so the button can advertise that
  // something is in there (the old UI gave no hint at all).
  useEffect(() => {
    if (!hydrated || open || count !== null) return;
    let live = true;
    notesApi
      .list()
      .then((r) => {
        if (live) setCount((r.notes ?? []).length);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [hydrated, open, count]);

  const toggle = (): void => {
    setOpen((v) => {
      writeOpen(!v);
      return !v;
    });
  };

  const showToast = (message: string): void => {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  };

  const addNote = (): void => {
    if (busy) return;
    setBusy(true);
    notesApi
      .create({ content: "" })
      .then((r) => {
        setNotes((prev) => [r.note, ...(prev ?? [])]);
        setCount((c) => (c ?? 0) + 1);
      })
      .catch(() => showToast("Couldn't create a note."))
      .finally(() => setBusy(false));
  };

  const deleteNote = (id: string): void => {
    const snapshot = notes;
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    setCount((c) => Math.max(0, (c ?? 1) - 1));
    notesApi.remove(id).catch(() => {
      // Put it back rather than pretending the delete worked.
      setNotes(snapshot);
      setCount(snapshot ? snapshot.length : null);
      showToast("Couldn't delete that note.");
    });
  };

  const convert = (note: Note, listId: string): void => {
    const raw = note.content.trim();
    const [first, ...rest] = raw.split("\n");
    const name = (first ?? "").trim() || "Note";
    const description = rest.join("\n").trim() || null;
    setBusy(true);
    tasksApi
      .create(listId, { name, description })
      .then(() => {
        deleteNote(note.id);
        setPicking(null);
        showToast(`Task created: “${name.slice(0, 40)}${name.length > 40 ? "…" : ""}”`);
      })
      .catch(() => showToast("Couldn't create the task."))
      .finally(() => setBusy(false));
  };

  if (!hydrated) return null;

  return (
    <>
      {open && (
        <div className="notepad-panel">
          <div className="np-head">
            <span className="np-title">
              {Icons.note}
              Notepad
            </span>
            <span className="np-head-actions">
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={addNote}
                disabled={busy}
              >
                {Icons.plus}
                New note
              </button>
              {/* The way out of the panel: notes also live on their own page. */}
              <Link
                href="/notes"
                className="icon-btn"
                aria-label="Open the Notes page"
                title="Open all notes"
                onClick={() => {
                  setOpen(false);
                  writeOpen(false);
                }}
              >
                {Icons.arrowRight}
              </Link>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close notepad"
                onClick={toggle}
              >
                {Icons.close}
              </button>
            </span>
          </div>

          <div className="np-list">
            {notes === null ? (
              <div className="np-loading">
                <span className="skel" style={{ height: 54 }} />
                <span className="skel" style={{ height: 54 }} />
              </div>
            ) : notes.length === 0 ? (
              <div className="np-empty">
                <span className="np-empty-ic">{Icons.note}</span>
                <p>Quick thoughts, meeting scraps, todo seeds — jot them here, turn them into tasks later.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={addNote}>
                  {Icons.plus}
                  First note
                </button>
              </div>
            ) : (
              notes.map((n) => (
                <NoteEditor
                  key={n.id}
                  note={n}
                  onDelete={deleteNote}
                  onToTask={(note) => setPicking(note)}
                />
              ))
            )}
          </div>

          {picking && (
            <ListDestinationPicker
              title="Create task from note"
              confirmLabel="Create the task here"
              busy={busy}
              onCancel={() => setPicking(null)}
              onPick={(listId) => convert(picking, listId)}
            />
          )}
        </div>
      )}

      <button
        type="button"
        className={`notepad-fab${open ? " on" : ""}`}
        aria-label={open ? "Close notepad" : "Open notepad"}
        title={
          count && count > 0
            ? `Notepad — ${count} ${count === 1 ? "note" : "notes"}`
            : "Notepad"
        }
        onClick={toggle}
      >
        <span aria-hidden="true">🗒</span>
        {!open && count !== null && count > 0 && (
          <span className="notepad-fab-count" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {toast && <div className="np-toast">{toast}</div>}
    </>
  );
}
