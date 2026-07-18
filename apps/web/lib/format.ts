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
