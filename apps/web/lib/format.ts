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

/**
 * Compact relative time — "just now", "2m ago", "3h ago", "5d ago";
 * falls back to a "Aug 3" style date past a week (Module 6).
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear()
    ? label
    : `${label}, ${d.getFullYear()}`;
}

/** "Today, 14:30" / "Aug 3, 09:00" — for reminders (Module 6). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const day = formatDueDate(iso) || `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${day}, ${hh}:${mm}`;
}

/* ------------------------------------------------------------------ *
 * Time tracking (Module 8). Pure — safe anywhere.
 * ------------------------------------------------------------------ */

/** "1:05", "0:45", "12:00" — h:mm from a second count (totals, chips). */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  // Rounding minutes can roll over (e.g. 3599s → 60m).
  if (m === 60) return `${h + 1}:00`;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "0:04:31", "1:12:05" — h:mm:ss for a live-ticking timer readout. */
export function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** "26h", "3.5h", "0h" — coarse hour label for workload bars. */
export function formatHours(seconds: number | null | undefined): string {
  const h = Math.max(0, seconds ?? 0) / 3600;
  if (h === 0) return "0h";
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

/** Whole seconds elapsed since an ISO instant (never negative). */
export function elapsedSeconds(startedAtIso: string): number {
  const t = new Date(startedAtIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/** The Monday of the week containing `d`, as YYYY-MM-DD. */
export function mondayOf(d: Date): string {
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return localYmd(m);
}

/** Local YYYY-MM-DD for a Date (no timezone surprises). */
export function localYmd(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Shift a YYYY-MM-DD string by whole days (local calendar math). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return localYmd(new Date(y, (m || 1) - 1, (d || 1) + days));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 14" for a YYYY-MM-DD day column header. */
export function formatDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const date = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(date.getTime())) return ymd;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
}

/** "Jul 14 – Jul 20" (or "Jul 28 – Aug 3") for a Monday-start week. */
export function formatWeekRange(weekStart: string): string {
  const end = shiftYmd(weekStart, 6);
  const fmt = (ymd: string): string => {
    const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
    const date = new Date(y, (m || 1) - 1, d || 1);
    return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  };
  return `${fmt(weekStart)} – ${fmt(end)}`;
}

/** True when a YYYY-MM-DD day is today (local). */
export function isTodayYmd(ymd: string): boolean {
  return ymd === localYmd(new Date());
}

/* ------------------------------------------------------------------ *
 * Docs (Module 7).
 * ------------------------------------------------------------------ */

/** Preset emoji row for doc icons (Docs home modal + editor header). */
export const DOC_EMOJI = ["📄", "📘", "📗", "📕", "🧠", "💡", "🗺️", "🚀", "📌", "✨"] as const;

/* ------------------------------------------------------------------ *
 * Forms (Module 11).
 * ------------------------------------------------------------------ */

/**
 * Copy text to the clipboard, falling back to a hidden textarea when the
 * async Clipboard API is unavailable (http, older browsers). Resolves
 * true on success — callers show a toast either way.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea shim */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * The canonical public origin StackUp is reachable at. Shareable links MUST
 * use this, never `window.location.origin` — otherwise a link generated while
 * the app is open on a preview/dev host (e.g. *.onrender.com), inside the
 * native shell, or on localhost would hand recipients a URL that host may not
 * serve. Order: an explicit build-time override, else the current origin when
 * it's a real public domain, else the production default.
 */
const CANONICAL_WEB_ORIGIN = "https://www.stackup.co.ke";
export function siteOrigin(): string {
  const env = process.env.NEXT_PUBLIC_WEB_URL;
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const o = window.location.origin;
    if (o && !/onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0|capacitor:|file:|:\/\/localhost/i.test(o)) {
      return o;
    }
  }
  return CANONICAL_WEB_ORIGIN;
}

/** The shareable public URL for a form token. Always canonical origin. */
export function publicFormUrl(publicToken: string): string {
  return `${siteOrigin()}/f?token=${encodeURIComponent(publicToken)}`;
}

/* ------------------------------------------------------------------ *
 * Goals & portfolios (Module 9). Pure — safe anywhere.
 * ------------------------------------------------------------------ */

/**
 * Coerce anything the API sends (number | numeric string | junk) to a
 * 0..1 float. Decimal columns often serialize as strings.
 */
export function clamp01(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** "72%" from a 0..1 float (rounded to whole percents). */
export function formatPercent(value: unknown): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

/** "4,000" / "0.5" — thousands-grouped number for target readouts. */
export function formatMetric(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ *
 * Dashboards & sprints (Module 10). Pure — safe anywhere.
 * ------------------------------------------------------------------ */

/** "Jul 14" (or "Jul 14, 2025" when not this year) from an ISO date. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear()
    ? label
    : `${label}, ${d.getFullYear()}`;
}

/** "Jul 14 – Jul 27" from two ISO dates (either side may be empty). */
export function formatDateRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  const a = formatShortDate(startIso);
  const b = formatShortDate(endIso);
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

/** Where a sprint sits relative to today (dates are inclusive). */
export function sprintPhase(
  startIso: string,
  endIso: string,
): "active" | "upcoming" | "past" {
  const today = localYmd(new Date());
  const start = toDateInputValue(startIso) || startIso.slice(0, 10);
  const end = toDateInputValue(endIso) || endIso.slice(0, 10);
  if (today < start) return "upcoming";
  if (today > end) return "past";
  return "active";
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
