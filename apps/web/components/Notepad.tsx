"use client";

/**
 * Notepad: a slide-up scratchpad that follows you everywhere.
 *
 * The floating 🗒 button toggles a compact panel of your notes (most recent
 * first). It carries a count so notes stay visible while the panel is shut,
 * and the panel links to the full Notes page (/notes). Notes live on the
 * server — the same ones the Notes page and the Home card show — and are
 * searchable from ⌘K. Any note can become a task in any List (or a new one).
 *
 * Open/closed state persists in localStorage (`stackup.notepad.open`).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { notesApi, type Note } from "@/lib/api";
import { Icons } from "@/components/icons";
import { NoteEditor } from "@/components/NoteEditor";
import { ListDestinationPicker } from "@/components/ListDestinationPicker";
import { convertNoteToTask, migrateLegacyHomeNote, notesChanged, onNotesChanged } from "@/lib/notes";

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
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [picking, setPicking] = useState<Note | null>(null);

  const load = (): void => {
    notesApi
      .list()
      .then((r) => setNotes(r.notes ?? []))
      .catch(() => setNotes((prev) => prev ?? []));
  };

  useEffect(() => {
    setOpen(readOpen());
    setHydrated(true);
    void migrateLegacyHomeNote().then(load);
    return onNotesChanged(load);
  }, []);

  const toggle = (): void => {
    setOpen((v) => {
      writeOpen(!v);
      if (!v) load();
      return !v;
    });
  };

  const showToast = (message: string): void => {
    setToast(message);
    setTimeout(() => setToast(""), 2800);
  };

  const addNote = (): void => {
    if (busy) return;
    setBusy(true);
    notesApi
      .create({ content: "" })
      .then((r) => {
        setNotes((prev) => [r.note, ...(prev ?? [])]);
        setFresh(r.note.id);
        notesChanged();
      })
      .catch(() => showToast("Couldn't create a note."))
      .finally(() => setBusy(false));
  };

  const deleteNote = (id: string): void => {
    const before = notes;
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    notesApi
      .remove(id)
      .then(() => notesChanged())
      .catch(() => {
        setNotes(before);
        showToast("Couldn't delete the note.");
      });
  };

  if (!hydrated) return null;
  const count = notes?.length ?? 0;

  return (
    <>
      {open && (
        <div className="notepad-panel">
          <div className="np-head">
            <span className="np-title">
              {Icons.note}
              Notes
            </span>
            <span className="np-head-actions">
              <button type="button" className="btn btn-soft btn-sm" onClick={addNote} disabled={busy}>
                {Icons.plus}
                New note
              </button>
              <button type="button" className="icon-btn" aria-label="Close notepad" onClick={toggle}>
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
                  autoFocus={n.id === fresh}
                  onDelete={deleteNote}
                  onToTask={setPicking}
                />
              ))
            )}
          </div>
          <Link href="/notes" className="np-all" onClick={toggle}>
            All notes{count ? ` (${count})` : ""} {Icons.chevronRight}
          </Link>
        </div>
      )}

      {picking && (
        <ListDestinationPicker
          title="Turn note into a task"
          subtitle="The first line becomes the task name, the rest its description."
          actionLabel="Add here"
          busy={busy}
          onClose={() => setPicking(null)}
          onPick={({ list, spaceName }) => {
            setBusy(true);
            convertNoteToTask(picking, list.id)
              .then((name) => {
                setNotes((prev) => (prev ?? []).filter((n) => n.id !== picking.id));
                setPicking(null);
                showToast(`Task “${name.slice(0, 36)}${name.length > 36 ? "…" : ""}” added to ${spaceName} › ${list.name}`);
              })
              .catch(() => showToast("Couldn't create the task."))
              .finally(() => setBusy(false));
          }}
        />
      )}

      <button
        type="button"
        className={`notepad-fab${open ? " on" : ""}`}
        aria-label={open ? "Close notes" : `Open notes${count ? ` (${count})` : ""}`}
        title="Notes"
        onClick={toggle}
      >
        <span aria-hidden="true">🗒</span>
        {!open && count > 0 && <span className="np-count">{count > 99 ? "99+" : count}</span>}
      </button>

      {toast && <div className="np-toast">{toast}</div>}
    </>
  );
}
