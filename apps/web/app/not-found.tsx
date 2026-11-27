import Link from "next/link";

/**
 * Branded 404. Exported as out/404.html; the API serves it (status 404) to any
 * browser navigation that matches neither a page nor an API route, instead of
 * the raw JSON error.
 */
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
        color: "var(--ink)",
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 440, width: "100%", textAlign: "center", padding: "36px 28px" }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            margin: "0 auto 14px",
            background: "var(--brand)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 20,
          }}
        >
          404
        </div>
        <h1 style={{ fontSize: "1.3rem", margin: "0 0 8px" }}>Page not found</h1>
        <p className="muted" style={{ margin: "0 0 22px" }}>
          This link doesn&apos;t lead anywhere in StackUp. It may have been moved or
          typed incorrectly.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/dashboard" className="btn btn-primary">
            Go to Home
          </Link>
          <Link href="/everything" className="btn btn-ghost">
            Browse Spaces
          </Link>
        </div>
      </div>
    </main>
  );
}
