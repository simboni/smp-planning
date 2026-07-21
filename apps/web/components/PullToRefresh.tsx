"use client";

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/native";
import { Icons } from "@/components/icons";

/** Pull distance (px, after damping) that arms a refresh on release. */
const THRESHOLD = 72;
/** Cap on how far the indicator travels. */
const MAX_PULL = 118;

/**
 * Native-app pull-to-refresh (M25). Active only inside the Capacitor shell
 * (data-app="native" on <html>): dragging down while the page is scrolled to
 * the top pulls out a spinner puck; releasing past the threshold reloads the
 * app — the WebView serves cached assets, so this is effectively a fast data
 * refetch, exactly the Android gesture users expect. Renders nothing on web.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    if (document.documentElement.getAttribute("data-app") !== "native") return;

    const atTop = (): boolean =>
      (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

    const onStart = (e: TouchEvent): void => {
      startY.current = atTop() ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent): void => {
      if (startY.current === null || pullRef.current === 0) {
        // Re-arm if the user reaches the top mid-gesture.
        if (startY.current === null && atTop()) startY.current = e.touches[0].clientY;
        if (startY.current === null) return;
      }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || !atTop()) {
        if (pullRef.current !== 0) {
          pullRef.current = 0;
          setPull(0);
        }
        return;
      }
      // Damped pull, and hold the page still while the puck is out.
      e.preventDefault();
      const next = Math.min(dy * 0.45, MAX_PULL);
      pullRef.current = next;
      setPull(next);
    };
    const onEnd = (): void => {
      startY.current = null;
      if (pullRef.current >= THRESHOLD) {
        pullRef.current = 0;
        setRefreshing(true);
        setPull(THRESHOLD);
        void haptic("light");
        // Give the spinner a beat to show, then reload (cached assets → fast).
        setTimeout(() => window.location.reload(), 180);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (pull === 0 && !refreshing) return null;
  const armed = pull >= THRESHOLD;
  return (
    <div
      className={`ptr-puck${refreshing ? " spinning" : ""}${armed ? " armed" : ""}`}
      style={{
        transform: `translateX(-50%) translateY(${pull}px) rotate(${pull * 2.4}deg)`,
        opacity: Math.min(1, pull / (THRESHOLD * 0.6)),
      }}
      aria-hidden="true"
    >
      {Icons.repeat}
    </div>
  );
}
