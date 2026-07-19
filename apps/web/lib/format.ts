/**
 * Small presentation helpers. Pure — safe to call anywhere.
 */

/** Up to two uppercase initials from a name (falls back to an email). */
export function initials(nameOrEmail: string): string {
  const source = (nameOrEmail || "").trim();
  if (!source) return "?";
  if (source.includes("@") && !source.includes(" ")) {
    return source.slice(0, 2).toUpperCase();
  }
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/** First token of a full name, e.g. "Ada Lovelace" -> "Ada". */
export function firstName(fullName: string): string {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

/**
 * Deterministic pleasant color for an id/string when the API hasn't set
 * one. Uses the StackUp accent family so avatars feel on-brand.
 */
const PALETTE = [
  "#7B68EE",
  "#5B5FEF",
  "#00B8D9",
  "#36B37E",
  "#FFAB00",
  "#FF7452",
  "#E5578C",
  "#8777D9",
];
export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/* ------------------------------------------------------------------ *
 * Task date & time helpers (Module 3). Pure — safe anywhere.
 * ------------------------------------------------------------------ */

/** Midnight-anchored day difference (target − today), in whole days. */
function dayDelta(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A compact, human due-date label ("Today", "Tomorrow", "Aug 3"). */
export function formatDueDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const delta = dayDelta(iso);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

/** True when a due date is strictly before today. */
export function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const delta = dayDelta(iso);
  return delta !== null && delta < 0;
}

/** "2h 30m", "45m", "3h" from a minute count. */
export function formatEstimate(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** ISO (or date) → "yyyy-mm-dd" for a native date input; "" when empty. */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
