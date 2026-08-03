"use client";

/**
 * Session presence — decides whether an expired session should ASK
 * ("Still working?") or just renew itself silently.
 *
 * The prompt exists for one situation: a screen left unattended, where the
 * session should not quietly live on forever. It makes no sense in the two
 * far more common cases:
 *
 *   • Cold start — the app was closed for hours and is being opened now. The
 *     user just launched it; asking whether they are "still working" before
 *     they have done anything is nonsense. Renew silently.
 *   • Actively working — they were clicking/typing seconds ago. Interrupting
 *     that with a modal is pure friction. Renew silently.
 *
 * So the prompt appears only when the app has been OPEN and the user has been
 * IDLE for a while: the unattended case it was designed for. Everything else
 * renews in the background; if renewal itself fails (the refresh token is
 * genuinely dead) the app falls back to the login screen either way.
 */

/** When this tab/app instance started — used to detect a cold start. */
const APP_STARTED_AT = Date.now();

/** A fresh launch gets this long before any prompt is considered. */
const COLD_START_GRACE_MS = 2 * 60_000;

/** Idle this long with the app open → the screen is plausibly unattended. */
const IDLE_BEFORE_PROMPT_MS = 30 * 60_000;

/** Hidden/backgrounded at least this long → refresh on resume, pre-emptively. */
export const RESUME_REFRESH_AFTER_MS = 10 * 60_000;

let lastActivityAt = Date.now();
let lastHiddenAt = 0;

/** Record human presence (throttled by the caller's event cadence). */
export function noteActivity(): void {
  lastActivityAt = Date.now();
}

export function msSinceActivity(): number {
  return Date.now() - lastActivityAt;
}

/** How long the app has been backgrounded, 0 when visible/never hidden. */
export function msHidden(): number {
  return lastHiddenAt === 0 ? 0 : Date.now() - lastHiddenAt;
}

/**
 * Should an expired session interrupt the user with the "Still working?"
 * prompt, or renew quietly? True ONLY for an app that has been open a while
 * and idle — i.e. plausibly unattended.
 */
export function shouldPromptOnExpiry(): boolean {
  if (typeof document === "undefined") return false;
  // Cold start / just opened: never ask.
  if (Date.now() - APP_STARTED_AT < COLD_START_GRACE_MS) return false;
  // Backgrounded app being resumed (mobile): that's a cold-start-like moment.
  if (document.visibilityState !== "visible") return false;
  if (lastHiddenAt !== 0 && Date.now() - lastHiddenAt < COLD_START_GRACE_MS) {
    return false;
  }
  // Present and working: don't interrupt.
  return msSinceActivity() >= IDLE_BEFORE_PROMPT_MS;
}

/**
 * Track presence for the lifetime of the app shell. `onResume` fires when the
 * app comes back after a long background, so the caller can refresh tokens
 * BEFORE the user's first tap 401s.
 */
export function startSessionActivityTracking(
  onResume: (hiddenMs: number) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  // Passive, cheap: any of these means a human is here.
  const mark = (): void => noteActivity();
  const events: (keyof WindowEventMap)[] = [
    "pointerdown",
    "keydown",
    "wheel",
    "touchstart",
    "focus",
  ];
  for (const e of events) {
    window.addEventListener(e, mark, { passive: true });
  }

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      lastHiddenAt = Date.now();
      return;
    }
    const hiddenFor = msHidden();
    lastHiddenAt = 0;
    noteActivity(); // returning to the app IS activity
    if (hiddenFor >= RESUME_REFRESH_AFTER_MS) onResume(hiddenFor);
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    for (const e of events) window.removeEventListener(e, mark);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
