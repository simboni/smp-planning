/**
 * Theme (light / dark / system) and per-workspace branding (accent color).
 *
 * The dark palette already lives in globals.css under
 * :root[data-theme="dark"] and a prefers-color-scheme fallback; this module
 * just drives the data-theme attribute and persists the choice. Branding
 * overrides the brand CSS variables on <html> from a single accent hex so a
 * workspace's color themes the whole app.
 */

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "stackup.theme";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** Reflect a theme choice onto <html> (system => let the OS/media decide). */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_KEY, theme);
  }
  applyTheme(theme);
}

/** The concrete theme in effect right now (resolves "system"). */
export function resolvedTheme(): "light" | "dark" {
  const t = getTheme();
  if (t !== "system") return t;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/* ---- Branding: accent color ---------------------------------------- */

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Parse #rrggbb -> [r,g,b]; returns null for anything malformed. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix a color toward white (amt>0) or black (amt<0), amt in [-1, 1]. */
function shade([r, g, b]: [number, number, number], amt: number): string {
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

/**
 * Theme the app from a single accent hex by overriding the brand CSS
 * variables on <html>. Passing null/invalid restores the stylesheet defaults.
 */
export function applyBranding(accent: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = [
    "--brand",
    "--brand-700",
    "--brand-soft",
    "--brand-soft-2",
    "--brand-grad",
    "--brand-ink",
    "--ring",
  ];
  const rgb = accent ? parseHex(accent) : null;
  if (!rgb) {
    for (const v of vars) root.style.removeProperty(v);
    return;
  }
  const [r, g, b] = rgb;
  root.style.setProperty("--brand", toHex(r, g, b));
  root.style.setProperty("--brand-700", shade(rgb, -0.18));
  root.style.setProperty("--brand-soft", `rgba(${r}, ${g}, ${b}, 0.12)`);
  root.style.setProperty("--brand-soft-2", `rgba(${r}, ${g}, ${b}, 0.18)`);
  root.style.setProperty(
    "--brand-grad",
    `linear-gradient(135deg, ${toHex(r, g, b)}, ${shade(rgb, -0.22)})`,
  );
  root.style.setProperty("--brand-ink", "#ffffff");
  root.style.setProperty("--ring", `rgba(${r}, ${g}, ${b}, 0.35)`);
}
