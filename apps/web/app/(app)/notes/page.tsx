"use client";

/**
 * Notes — the full-page home for the Notepad.
 *
 * Notes used to exist only behind the floating 🗒 button, with no nav entry and
 * no search coverage, so once the panel was closed they were effectively lost.
 * This page is the durable destination: every note, newest first, with a
 * filter, inline editing (same autosaving editor as the panel), delete, and
 * "→ task" into any Space → List — including Spaces and Lists created here.
 *
 * All notes are private to the signed-in user and scoped to the current
 * workspace (the server filters on user_id; RLS filters on workspace).
 */

import { useEffect, useMemo, useState } from "react";
import { notesApi, tasksApi, ApiError, type Note } from "@/lib/api";
import { ListDestinationPicker } from "@/components/ListDestinationPicker";
import { NoteEditor } from "@/components/NoteEditor";
import { Icons } from "@/components/icons";
import { showToast } from "@/lib/toast";

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [picking, setPicking] = useState<Note | null>(null);
  /** Note id from the URL hash (a search hit deep-links here). */
  const [highlight, setHighlight] = useState<string | null>(null);

  const load = (): void => {
    notesApi
      .list()
      .then((r) => {
        setNotes(r.notes ?? []);
        setError("");
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Couldn't load your notes.",
        ),
      );
  };

  useEffect(load, []);

  // A search hit navigates to /notes#<id> — pick that note out once the list
  // has arrived, scroll it into view and flash it so it's obvious which it is.
  useEffect(() => {
    if (!notes) return;
    const id = (typeof window !== "undefined" ? window.location.hash : "").replace(
      /^#/,
      "",
    );
    if (!id || !notes.some((n) => n.id === id)) return;
    setHighlight(id);
    const el = document.getElementById(`note-${id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setHighlight(null), 2400);
    return () => clearTimeout(t);
  }, [notes]);

  const addNote = (): void => {
    if (busy) return;
    setBusy(true);
    notesApi
      .create({ content: "" })
      .then((r) => {
        setNotes((prev) => [r.note, ...(prev ?? [])]);
        setFocusId(r.note.id);
        setQ("");
      })
      .catch(() => showToast("Couldn't create a note."))
      .finally(() => setBusy(false));
  };

  const deleteNote = (id: string): void => {
    const snapshot = notes;
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    notesApi.remove(id).catch(() => {
      setNotes(snapshot);
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
        showToast(
          `Task created: “${name.slice(0, 40)}${name.length > 40 ? "…" : ""}”`,
        );
      })
      .catch(() => showToast("Couldn't create the task."))
      .finally(() => setBusy(false));
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return notes ?? [];
    return (notes ?? []).filter((n) =>
      n.content.toLowerCase().includes(needle),
    );
  }, [notes, q]);

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Notes</h1>
          <p className="sub">
            Your private scratchpad — synced to your account, visible only to
            you. Turn any note into a task when it's ready.
          </p>
        </div>
        <div className="hr-head-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={addNote}
            disabled={busy}
          >
            {Icons.plus}
            New note
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {notes !== null && notes.length > 0 && (
        <div className="notes-toolbar">
          <div className="notes-search">
            {Icons.search}
            <input
              className="input"
              value={q}
              placeholder="Filter notes…"
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear filter"
                onClick={() => setQ("")}
              >
                {Icons.close}
              </button>
            )}
          </div>
          <span className="muted notes-count">
            {q
              ? `${shown.length} of ${notes.length}`
              : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
          </span>
        </div>
      )}

      {notes === null ? (
        <div className="notes-grid">
          <span className="skel" style={{ height: 120, borderRadius: 14 }} />
          <span className="skel" style={{ height: 120, borderRadius: 14 }} />
        </div>
      ) : notes.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.note}</span>
          <h3>No notes yet</h3>
          <p>
            Quick thoughts, meeting scraps, todo seeds — jot them here and turn
            them into tasks later. They're also reachable from the 🗒 button in
            the bottom-right of every page.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={addNote}
            disabled={busy}
          >
            {Icons.plus}
            Write your first note
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.search}</span>
          <h3>No note matches “{q}”</h3>
          <p>Try a different word, or clear the filter.</p>
          <button type="button" className="btn btn-soft" onClick={() => setQ("")}>
            Clear filter
          </button>
        </div>
      ) : (
        <div className="notes-grid">
          {shown.map((n) => (
            <div
              key={n.id}
              id={`note-${n.id}`}
              className={highlight === n.id ? "note-highlight" : undefined}
            >
              <NoteEditor
                note={n}
                autoFocus={n.id === focusId}
                onDelete={deleteNote}
                onToTask={(note) => setPicking(note)}
              />
            </div>
          ))}
        </div>
      )}

      {picking && (
        <div className="modal-scrim" onClick={() => setPicking(null)}>
          <div
            className="modal notes-pick-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create task from note"
            onClick={(e) => e.stopPropagation()}
          >
            <ListDestinationPicker
              title="Create task from note"
              confirmLabel="Create the task here"
              busy={busy}
              onCancel={() => setPicking(null)}
              onPick={(listId) => convert(picking, listId)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
