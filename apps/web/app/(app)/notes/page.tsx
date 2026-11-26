"use client";

/**
 * Notes — every note you've jotted, in one place.
 *
 * The same notes as the 🗒 panel and the Home card (one server store), with
 * a filter, and a deep link (/notes?id=…) that ⌘K search results open.
 * Notes are private: only their author sees them.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { notesApi, type Note } from "@/lib/api";
import { Icons } from "@/components/icons";
import { NoteEditor } from "@/components/NoteEditor";
import { ListDestinationPicker } from "@/components/ListDestinationPicker";
import { convertNoteToTask, migrateLegacyHomeNote, notesChanged, onNotesChanged } from "@/lib/notes";
import { showToast } from "@/lib/toast";

function NotesView() {
  const focusId = useSearchParams().get("id");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [filter, setFilter] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<Note | null>(null);
  const [error, setError] = useState("");

  const load = (): void => {
    notesApi
      .list()
      .then((r) => {
        setNotes(r.notes ?? []);
        setError("");
      })
      .catch(() => {
        setNotes((prev) => prev ?? []);
        setError("Couldn't load your notes. Check your connection and refresh.");
      });
  };

  useEffect(() => {
    void migrateLegacyHomeNote().then(load);
    return onNotesChanged(load);
  }, []);

  // Deep link from search: scroll to the note and flash it.
  useEffect(() => {
    if (!focusId || !notes) return;
    const el = document.getElementById(`note-${focusId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("np-flash");
    const t = setTimeout(() => el.classList.remove("np-flash"), 1800);
    return () => clearTimeout(t);
  }, [focusId, notes]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!notes) return [];
    return q ? notes.filter((n) => n.content.toLowerCase().includes(q)) : notes;
  }, [notes, filter]);

  const add = (): void => {
    if (busy) return;
    setBusy(true);
    notesApi
      .create({ content: "" })
      .then((r) => {
        setFilter("");
        setNotes((prev) => [r.note, ...(prev ?? [])]);
        setFresh(r.note.id);
        notesChanged();
      })
      .catch(() => showToast("Couldn't create a note."))
      .finally(() => setBusy(false));
  };

  const remove = (id: string): void => {
    if (!window.confirm("Delete this note? This can't be undone.")) return;
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

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Notes</h1>
          <p className="sub">Your private notes — the same ones as the 🗒 button. Only you can see them.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={add} disabled={busy}>
          {Icons.plus}
          New note
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {notes && notes.length > 0 && (
        <input
          className="input notes-filter"
          placeholder={`Filter ${notes.length} note${notes.length === 1 ? "" : "s"}…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      {notes === null ? (
        <div className="notes-grid">
          <span className="skel" style={{ height: 120, borderRadius: 14 }} />
          <span className="skel" style={{ height: 120, borderRadius: 14 }} />
          <span className="skel" style={{ height: 120, borderRadius: 14 }} />
        </div>
      ) : notes.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.note}</span>
          <h3>No notes yet</h3>
          <p>Quick thoughts, meeting scraps, todo seeds. Jot them here or from the 🗒 button on any page, and turn them into tasks later.</p>
          <button type="button" className="btn btn-primary" onClick={add}>
            {Icons.plus}
            Write your first note
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted" style={{ marginTop: 18 }}>No note contains “{filter.trim()}”.</p>
      ) : (
        <div className="notes-grid">
          {shown.map((n) => (
            <div key={n.id} className="card notes-card">
              <NoteEditor note={n} autoFocus={n.id === fresh} maxHeight={420} onDelete={remove} onToTask={setPicking} />
            </div>
          ))}
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
                showToast(`Task “${name.slice(0, 40)}” added to ${spaceName} › ${list.name}`);
              })
              .catch(() => showToast("Couldn't create the task."))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={null}>
      <NotesView />
    </Suspense>
  );
}
