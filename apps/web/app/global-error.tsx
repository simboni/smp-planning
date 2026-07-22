"use client";

/**
 * Last-resort boundary. Catches errors thrown in the root layout / app shell
 * itself (which the per-segment error.tsx cannot). Replaces the whole document,
 * so it carries its own inline styles rather than relying on globals.css.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f6f7fb",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#1a1a2e",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 440,
            textAlign: "center",
            background: "#fff",
            border: "1px solid #e6e6ef",
            borderRadius: 16,
            padding: "32px 28px",
            boxShadow: "0 12px 34px rgba(72,58,160,0.12)",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "#7b68ee",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 800,
              marginBottom: 14,
            }}
          >
            !
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem" }}>Something went wrong</h2>
          <p style={{ margin: "0 0 18px", color: "#5a5a72", lineHeight: 1.5 }}>
            The app hit an unexpected error. Reloading almost always fixes it.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: 0,
                background: "#7b68ee",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "1px solid #e6e6ef",
                background: "#fff",
                color: "#1a1a2e",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
