import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { autoMigrate } from "./db/migrator";
import { SharesService } from "./shares/shares.service";

/** Escape a string for safe inclusion in an HTML attribute. */
function htmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SHARE_TYPE_LABEL: Record<string, string> = {
  space: "Space",
  folder: "Folder",
  list: "List",
  task: "Task",
  doc: "Doc",
  dashboard: "Dashboard",
};

/**
 * Serve the /s share page with Open Graph / Twitter meta injected, so a shared
 * link unfurls into a rich card in Slack / WhatsApp / iMessage / etc. Falls
 * back to the plain page on any error or unknown token.
 */
async function injectShareMeta(
  root: string,
  shares: SharesService | null,
  token: string,
  origin: string,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const file = ["/s.html", "/s/index.html"]
    .map((c) => resolve(root, `.${c}`))
    .find((f) => f.startsWith(root) && existsSync(f));
  if (!file) return next();
  try {
    let meta: Awaited<ReturnType<SharesService["resolveMeta"]>> = null;
    try {
      meta = shares ? await shares.resolveMeta(token) : null;
    } catch {
      meta = null;
    }
    let html = readFileSync(file, "utf8");
    if (meta) {
      const label = SHARE_TYPE_LABEL[meta.entityType] ?? "Shared";
      const title = `${meta.title} · StackUp`;
      const desc = `${label} shared from ${meta.workspaceName} on StackUp — open to view it, no account needed.`;
      const image = `${origin}/og-share.png`;
      const pageUrl = `${origin}/s?t=${encodeURIComponent(token)}`;
      const tags = [
        `<meta property="og:title" content="${htmlAttr(title)}">`,
        `<meta property="og:description" content="${htmlAttr(desc)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="StackUp">`,
        `<meta property="og:url" content="${htmlAttr(pageUrl)}">`,
        `<meta property="og:image" content="${htmlAttr(image)}">`,
        `<meta property="og:image:width" content="1200">`,
        `<meta property="og:image:height" content="630">`,
        `<meta property="og:image:alt" content="Shared on StackUp">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${htmlAttr(title)}">`,
        `<meta name="twitter:description" content="${htmlAttr(desc)}">`,
        `<meta name="twitter:image" content="${htmlAttr(image)}">`,
        `<title>${htmlAttr(title)}</title>`,
      ].join("");
      html = html.replace("</head>", `${tags}</head>`);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch {
    res.sendFile(file);
  }
}

/**
 * Last-resort safety net: the API should degrade, not die. Anything that
 * escapes local handling (a library emitting 'error' with no listener, a
 * stray rejection) is logged in full and the process keeps serving. Restart-
 * on-crash still exists at the platform layer for truly unrecoverable states.
 */
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION (continuing):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION (continuing):", reason);
});

async function bootstrap(): Promise<void> {
  // Bring the database schema up to date BEFORE serving, so the code and its
  // tables can never be out of step after a deploy (the root cause of the
  // recurring post-deploy "internal server error" on login/signup). No-op
  // unless ADMIN_DB_URL is set; never throws.
  await autoMigrate();

  // Disable Nest's default 100kb body parser; register our own with a larger
  // limit so base64 file uploads (M12, 5MB decoded ≈ 6.7MB encoded) fit.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  app.use(express.urlencoded({ extended: true, limit: "12mb" }));
  const config = loadConfig();

  // Allowed browser origins: explicit WEB_ORIGINS (comma-separated) else the
  // local web dev server.
  const origins = process.env.WEB_ORIGINS
    ? process.env.WEB_ORIGINS.split(",")
    : ["http://localhost:3001"];
  app.enableCors({ origin: origins });

  // Baseline security headers on every response. The Content-Security-Policy
  // is the key defense-in-depth against XSS: even if a script were injected,
  // `connect-src 'self'` blocks exfiltration of the localStorage bearer tokens
  // to an attacker host, `object-src 'none'` kills plugin vectors, and
  // `base-uri 'self'` blocks <base> hijacking. 'unsafe-inline' is required for
  // Next.js's inline bootstrap and the theme/native marker scripts; the
  // server-side HTML sanitizer (docs.support.ts) is what actually strips
  // injected markup, with CSP as the backstop. Same-origin deploy, so 'self'
  // covers the API, the SSE stream, and file downloads; extra API origins can
  // be allow-listed via WEB_ORIGINS for split deploys.
  const connectSrc = ["'self'", ...origins].join(" ");
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
    "form-action 'self' https://accounts.google.com",
  ].join("; ");
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", csp);
    next();
  });

  // Single-origin deploy: serve the static web export from this process (one
  // URL, no CORS). The web page routes and the API resource routes share names
  // (/teams the page vs /teams the API), so we must NOT let express.static's
  // extensionless .html fallback shadow API routes. Split it:
  //   1. express.static serves real asset files only (/_next/*, .css, .js,
  //      images, manifest) — these never collide with API routes.
  //   2. A navigation handler serves an exported <path>.html ONLY for browser
  //      navigations, detected by `Accept: text/html`. API calls use fetch,
  //      whose default Accept is */* (no text/html), so they fall through to
  //      the Nest router below and get JSON. SSE (text/event-stream) too.
  const webDir = process.env.WEB_DIST ?? join(__dirname, "..", "web");
  if (existsSync(webDir)) {
    const root = resolve(webDir);
    const sharesService = app.get(SharesService, { strict: false });
    // redirect:false so /settings isn't 301'd to /settings/ before we can map it.
    app.use(express.static(root, { index: false, redirect: false }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET") return next();
      if (!(req.headers.accept ?? "").includes("text/html")) return next();
      // An asset path (has an extension) that wasn't found above is a real 404.
      if (extname(req.path)) return next();
      const p = req.path.replace(/\/+$/, "") || "/index";

      // Social-preview cards: for a public share page (/s?t=<token>), inject
      // Open Graph / Twitter meta so links unfurl with a title in chat apps.
      // Crawlers don't run JS, so the client-rendered page can't do this.
      const token =
        p === "/s" && typeof req.query.t === "string" ? req.query.t : "";
      if (token) {
        const host = req.get("host") ?? "";
        const proto =
          (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ||
          (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
        const origin = `${proto}://${host}`;
        void injectShareMeta(root, sharesService, token, origin, res, next);
        return;
      }

      // A route may be exported as <p>.html (leaf) or <p>/index.html (has
      // children, e.g. /settings alongside /settings/integrations).
      for (const cand of [`.${p}.html`, `.${p}/index.html`]) {
        const file = resolve(root, cand);
        if (file.startsWith(root) && existsSync(file)) {
          res.sendFile(file);
          return;
        }
      }
      next();
    });
    console.log(`serving web app from ${webDir}`);
  }

  app.enableShutdownHooks();
  // Bind to 0.0.0.0 explicitly: container platforms (Render/Fly/Cloud Run)
  // route to the published port only when the process listens on all
  // interfaces, not localhost. config.port already honors the injected PORT.
  await app.listen(config.port, "0.0.0.0");
  console.log(`stackup-api listening on 0.0.0.0:${config.port}`);
}

void bootstrap();
