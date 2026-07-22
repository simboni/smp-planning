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
 */

import { useEffect, useRef, useState } from "react";
import { notesApi, tasksApi, permissionAtLeast, type Note } from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";

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

/** One note row: autosizing textarea + debounce autosave + actions. */
function NoteRow({
  note,
  onDelete,
  onToTask,
}: {
  note: Note;
  onDelete: (id: string) => void;
  onToTask: (note: Note) => void;
}) {
  const [text, setText] = useState(note.content);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(note.content);

  // Autosize to content.
  const resize = (): void => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };
  useEffect(resize, [text]);

  const queueSave = (value: string): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (value === latestRef.current) return;
      latestRef.current = value;
      notesApi.update(note.id, { content: value }).catch(() => undefined);
    }, 700);
  };

  // Flush the pending save on unmount (panel close / navigation).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const value = areaRef.current?.value;
      if (value !== undefined && value !== latestRef.current) {
        notesApi.update(note.id, { content: value }).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="np-note">
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
      />
      <div className="np-note-foot">
        <span className="np-time">{timeAgo(note.updatedAt)}</span>
        <span className="np-note-actions">
          <button
            type="button"
            className="np-mini"
            title="Turn into a task"
            onClick={() => onToTask({ ...note, content: text })}
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

export function Notepad() {
  const { tree } = useHierarchy();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  // The "→ task" picker: which note it's for + the chosen space.
  const [picking, setPicking] = useState<Note | null>(null);
  const [pickSpace, setPickSpace] = useState<string>("");

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
      .then((r) => setNotes(r.notes ?? []))
      .catch(() => setNotes([]));
  }, [open]);

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
      .then((r) => setNotes((prev) => [r.note, ...(prev ?? [])]))
      .catch(() => showToast("Couldn't create a note."))
      .finally(() => setBusy(false));
  };

  const deleteNote = (id: string): void => {
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    notesApi.remove(id).catch(() => undefined);
  };

  // Spaces the user can create tasks in, each with a flattened list set.
  const targets = tree
    .filter((s) => permissionAtLeast(s.myPermission, "edit"))
    .map((s) => ({
      id: s.id,
      name: s.name,
      lists: [...s.lists, ...s.folders.flatMap((f) => f.lists)].filter(
        (l) => !l.archived,
      ),
    }))
    .filter((s) => s.lists.length > 0);

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
        setPickSpace("");
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
                <NoteRow
                  key={n.id}
                  note={n}
                  onDelete={deleteNote}
                  onToTask={(note) => {
                    setPicking(note);
                    setPickSpace("");
                  }}
                />
              ))
            )}
          </div>

          {picking && (
            <div className="np-picker">
              <div className="np-picker-head">
                <span>Create task from note</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Cancel"
                  onClick={() => {
                    setPicking(null);
                    setPickSpace("");
                  }}
                >
                  {Icons.close}
                </button>
              </div>
              {targets.length === 0 ? (
                <div className="np-picker-empty">
                  No lists you can add tasks to yet. Create a Space and a List
                  first.
                </div>
              ) : !pickSpace ? (
                <div className="np-picker-scroll">
                  <div className="np-picker-label">Pick a Space</div>
                  {targets.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="np-pick-row"
                      onClick={() => setPickSpace(s.id)}
                    >
                      <span className="np-pick-ic">{Icons.spaces}</span>
                      <span className="np-pick-name">{s.name}</span>
                      <span className="np-pick-arrow">{Icons.chevronRight}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="np-picker-scroll">
                  <button
                    type="button"
                    className="np-pick-back"
                    onClick={() => setPickSpace("")}
                  >
                    {Icons.chevronLeft}
                    Spaces
                  </button>
                  <div className="np-picker-label">Pick a List</div>
                  {(targets.find((s) => s.id === pickSpace)?.lists ?? []).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="np-pick-row"
                      disabled={busy}
                      onClick={() => picking && convert(picking, l.id)}
                    >
                      <span className="np-pick-ic">{Icons.list}</span>
                      <span className="np-pick-name">{l.name}</span>
                      <span className="np-pick-arrow">{Icons.plus}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={`notepad-fab${open ? " on" : ""}`}
        aria-label={open ? "Close notepad" : "Open notepad"}
        title="Notepad"
        onClick={toggle}
      >
        <span aria-hidden="true">🗒</span>
      </button>

      {toast && <div className="np-toast">{toast}</div>}
    </>
  );
}
