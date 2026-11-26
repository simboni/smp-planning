/**
 * Notes: one server-side store behind every surface (the 🗒 panel, the Notes
 * page, the Home card). This file holds what they share.
 */

import { notesApi, tasksApi, type Note } from "@/lib/api";

const EVENT = "stackup:notes-changed";

/** Tell every open notes surface (panel count, page, Home card) to refresh. */
export function notesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onNotesChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/**
 * The Home card used to keep its text in this browser only
 * (localStorage["stackup.home.notepad"]) — never on the server, never in the
 * panel or search, lost on another device. On first load anything still
 * there becomes a real note, then the key is cleared.
 */
const LEGACY_KEY = "stackup.home.notepad";
let migrating: Promise<Note | null> | null = null;

export function migrateLegacyHomeNote(): Promise<Note | null> {
  if (migrating) return migrating;
  migrating = (async () => {
    let text = "";
    try {
      text = (window.localStorage.getItem(LEGACY_KEY) ?? "").trim();
    } catch {
      return null;
    }
    if (!text) return null;
    try {
      const r = await notesApi.create({ content: text });
      window.localStorage.removeItem(LEGACY_KEY);
      notesChanged();
      return r.note;
    } catch {
      return null; // keep the local copy; try again next load
    }
  })();
  return migrating;
}

/** First line of a note, for titles and search hits. */
export function noteTitle(content: string): string {
  const first = content.trim().split("\n")[0]?.trim() ?? "";
  return first || "Untitled note";
}

/** Turn a note into a task in `listId` (first line = name, rest = description), then delete the note. */
export async function convertNoteToTask(note: Note, listId: string): Promise<string> {
  const raw = note.content.trim();
  const [first, ...rest] = raw.split("\n");
  const name = (first ?? "").trim() || "Note";
  const description = rest.join("\n").trim() || null;
  await tasksApi.create(listId, { name, description });
  await notesApi.remove(note.id);
  notesChanged();
  return name;
}
