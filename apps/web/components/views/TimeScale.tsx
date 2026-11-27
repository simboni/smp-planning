"use client";

import { useEffect, useState } from "react";

/**
 * Shared bits for the Gantt and Timeline views: a Today button, a Days /
 * Weeks zoom (remembered per view in this browser), and a narrow-screen hook
 * so the name rail gives the chart more room on phones.
 */
export type Zoom = "days" | "weeks";

/** Pixels per day at each zoom. "weeks" fits ~3 months on a laptop screen. */
export function dayWidth(zoom: Zoom, base: number): number {
  return zoom === "weeks" ? Math.max(8, Math.round(base / 3)) : base;
}

export function useZoom(key: string): [Zoom, (z: Zoom) => void] {
  const storageKey = `stackup.zoom.${key}`;
  const [zoom, setZoomState] = useState<Zoom>("days");
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "days" || v === "weeks") setZoomState(v);
    } catch {
      /* private mode: default zoom */
    }
  }, [storageKey]);
  const setZoom = (z: Zoom): void => {
    setZoomState(z);
    try {
      localStorage.setItem(storageKey, z);
    } catch {
      /* ignore */
    }
  };
  return [zoom, setZoom];
}

export function useNarrow(maxWidth = 640): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [maxWidth]);
  return narrow;
}

export function TimeScaleBar({
  zoom,
  onZoom,
  onToday,
}: {
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  onToday: () => void;
}) {
  return (
    <div className="ts-bar">
      <button type="button" className="btn btn-ghost btn-sm" onClick={onToday}>
        Today
      </button>
      <div className="ts-seg" role="group" aria-label="Zoom">
        {(["days", "weeks"] as const).map((z) => (
          <button
            key={z}
            type="button"
            className={`ts-seg-btn${zoom === z ? " active" : ""}`}
            aria-pressed={zoom === z}
            onClick={() => onZoom(z)}
          >
            {z === "days" ? "Days" : "Weeks"}
          </button>
        ))}
      </div>
    </div>
  );
}
