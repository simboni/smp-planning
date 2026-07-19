"use client";

/**
 * Module 6 — client-side realtime event hub.
 *
 * One shared EventSource per tab (module singleton) connected to
 * `GET /events/stream?token=<accessToken>`. Events arrive as JSON lines
 * and are fanned out to every subscriber. The connection:
 *   - only opens in the browser and only when an access token exists;
 *   - auto-reconnects with exponential backoff (1s → 30s) on error;
 *   - closes itself when the last subscriber unsubscribes.
 *
 * Components use `useRealtime(handler, deps)` — subscribe on mount,
 * clean up on unmount. The handler is kept in a ref so a stale closure
 * never sees old props/state.
 */

import { useEffect, useRef } from "react";
import { API_BASE, getAccessToken } from "@/lib/api";

export type RealtimeEvent =
  | { type: "task.changed"; payload: { taskId: string; listId: string } }
  | { type: "comment.changed"; payload: { taskId: string } }
  | { type: "notification.new"; payload: { userId: string } }
  | { type: "presence"; payload: { online: string[] } }
  | { type: "doc.changed"; payload: { docId: string; pageId: string } };

export type RealtimeHandler = (event: RealtimeEvent) => void;

const subscribers = new Set<RealtimeHandler>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1000;

function dispatch(event: RealtimeEvent): void {
  for (const handler of Array.from(subscribers)) {
    try {
      handler(event);
    } catch {
      /* a broken subscriber must not break the stream */
    }
  }
}

function open(): void {
  if (typeof window === "undefined") return; // static export renders on the server
  if (source || subscribers.size === 0) return;
  const token = getAccessToken();
  if (!token) return; // not signed into a workspace yet

  let es: EventSource;
  try {
    es = new EventSource(
      `${API_BASE}/events/stream?token=${encodeURIComponent(token)}`,
    );
  } catch {
    scheduleRetry();
    return;
  }
  source = es;

  es.onopen = () => {
    backoffMs = 1000; // healthy again — reset the backoff
  };
  es.onmessage = (ev: MessageEvent<string>) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return; // ignore malformed lines (heartbeats etc.)
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "type" in parsed &&
      typeof (parsed as { type: unknown }).type === "string"
    ) {
      dispatch(parsed as RealtimeEvent);
    }
  };
  es.onerror = () => {
    es.close();
    if (source === es) source = null;
    scheduleRetry();
  };
}

function scheduleRetry(): void {
  if (retryTimer || subscribers.size === 0) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, 30_000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    open();
  }, wait);
}

/**
 * Subscribe `onEvent` to the shared stream (opening it if needed).
 * Returns an unsubscribe function; the stream closes with the last one.
 */
export function connectEvents(onEvent: RealtimeHandler): () => void {
  subscribers.add(onEvent);
  open();
  return () => {
    subscribers.delete(onEvent);
    if (subscribers.size === 0) {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      source?.close();
      source = null;
      backoffMs = 1000;
    }
  };
}

/** React hook over `connectEvents` — one shared connection app-wide. */
export function useRealtime(
  handler: RealtimeHandler,
  deps: readonly unknown[] = [],
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    return connectEvents((event) => ref.current(event));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
