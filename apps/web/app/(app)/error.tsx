"use client";

/**
 * Error boundary for the authenticated app. If any page throws during render,
 * this renders INSIDE the app shell (nav still works) instead of white-screening
 * the whole site with Next's generic "Application error". A component crash on
 * one module no longer takes down every module.
 */

import { useEffect } from "react";
import { Icons } from "@/components/icons";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it for debugging; never rethrow.
    console.error("App section error:", error);
  }, [error]);

  return (
    <div className="page">
      <div className="err-card">
        <span className="err-ic">{Icons.info}</span>
        <h2>Something went wrong here</h2>
        <p>
          This section ran into an unexpected error. It&apos;s usually temporary —
          try again, or reload the page.
        </p>
        <div className="err-actions">
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
