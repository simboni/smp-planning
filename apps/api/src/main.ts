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
import { FormsService } from "./forms/forms.service";

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
 * Link-preview crawlers do NOT send `Accept: text/html` — WhatsApp, Facebook,
 * Slack and friends send a wildcard Accept or none at all — so Accept-based
 * navigation detection alone routes every crawler to the JSON API 404 and no
 * link ever unfurls. Any of these user agents is treated as a page request.
 */
const PREVIEW_BOT_RE =
  /whatsapp|facebookexternalhit|facebot|meta-externalagent|twitterbot|slackbot|linkedinbot|telegrambot|discordbot|skypeuripreview|pinterest|redditbot|googlebot|bingbot|applebot|embedly|quora link preview|vkshare|viber/i;

type PreviewMeta = { title: string; desc: string };

/**
 * Serve a public page (`/s` share, `/f` form) with Open Graph / Twitter meta
 * injected so the link unfurls into a rich card in WhatsApp / Slack / iMessage
 * / etc. The exported HTML already carries generic site-wide OG tags; those
 * are stripped and replaced because crawlers honor the FIRST occurrence.
 * Falls back to sending the plain file on any error.
 */
function servePageWithMeta(
  root: string,
  page: string,
  meta: PreviewMeta,
  origin: string,
  pageUrl: string,
  res: Response,
  next: NextFunction,
): void {
  const file = [`/${page}.html`, `/${page}/index.html`]
    .map((c) => resolve(root, `.${c}`))
    .find((f) => f.startsWith(root) && existsSync(f));
  if (!file) return next();
  try {
    const image = `${origin}/og-share.png`;
    const tags = [
      `<meta property="og:title" content="${htmlAttr(meta.title)}">`,
      `<meta property="og:description" content="${htmlAttr(meta.desc)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="StackUp">`,
      `<meta property="og:url" content="${htmlAttr(pageUrl)}">`,
      `<meta property="og:image" content="${htmlAttr(image)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="Shared on StackUp">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${htmlAttr(meta.title)}">`,
      `<meta name="twitter:description" content="${htmlAttr(meta.desc)}">`,
      `<meta name="twitter:image" content="${htmlAttr(image)}">`,
      `<title>${htmlAttr(meta.title)}</title>`,
    ].join("");
    const html = readFileSync(file, "utf8")
      .replace(/<title>[\s\S]*?<\/title>/, "")
      .replace(/<meta\s+(?:property="og:|name="twitter:)[^>]*\/?>/g, "")
      .replace("</head>", `${tags}</head>`);
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
  //      navigations, detected by `Accept: text/html` OR a link-preview
  //      crawler user agent (WhatsApp etc. send a wildcard Accept). API calls
  //      use fetch, whose default Accept is */* (no text/html), so they fall
  //      through to the Nest router below and get JSON. SSE too.
  const webDir = process.env.WEB_DIST ?? join(__dirname, "..", "web");
  if (existsSync(webDir)) {
    const root = resolve(webDir);
    const sharesService = app.get(SharesService, { strict: false });
    const formsService = app.get(FormsService, { strict: false });
    // redirect:false so /settings isn't 301'd to /settings/ before we can map it.
    app.use(express.static(root, { index: false, redirect: false }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET") return next();
      const accept = req.headers.accept ?? "";
      const ua = req.headers["user-agent"] ?? "";
      if (!accept.includes("text/html") && !PREVIEW_BOT_RE.test(ua)) return next();
      // An asset path (has an extension) that wasn't found above is a real 404.
      if (extname(req.path)) return next();
      const p = req.path.replace(/\/+$/, "") || "/index";

      // Social-preview cards: public share (/s?t=<token>) and public form
      // (/f?token=<token>) links must unfurl into a rich card in chat apps.
      // Crawlers don't run JS, so the client-rendered pages can't do this —
      // inject the meta server-side. A token that doesn't resolve still gets
      // the generic StackUp card: a public link must never unfurl as nothing.
      if (p === "/s" || p === "/f") {
        const host = req.get("host") ?? "";
        const proto =
          (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ||
          (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
        const origin = `${proto}://${host}`;
        const shareToken =
          p === "/s" && typeof req.query.t === "string" ? req.query.t : "";
        const formToken =
          p === "/f" && typeof req.query.token === "string" ? req.query.token : "";
        void (async () => {
          let meta: PreviewMeta =
            p === "/s"
              ? {
                  title: "Shared with you · StackUp",
                  desc: "Open the link to view it — no account needed.",
                }
              : {
                  title: "Form · StackUp",
                  desc: "Fill out this form — no account needed.",
                };
          let pageUrl = `${origin}${p}`;
          try {
            if (shareToken && sharesService) {
              pageUrl = `${origin}/s?t=${encodeURIComponent(shareToken)}`;
              const m = await sharesService.resolveMeta(shareToken);
              if (m) {
                const label = SHARE_TYPE_LABEL[m.entityType] ?? "Shared";
                meta = {
                  title: `${m.title} · StackUp`,
                  desc: `${label} shared from ${m.workspaceName} on StackUp — open to view it, no account needed.`,
                };
              }
            } else if (formToken && formsService) {
              pageUrl = `${origin}/f?token=${encodeURIComponent(formToken)}`;
              const f = await formsService.getPublicForm(formToken);
              meta = {
                title: `${f.name} · StackUp`,
                desc: f.description || "Fill out this form — no account needed.",
              };
            }
          } catch {
            // Unknown/revoked/inactive token — keep the generic card.
          }
          servePageWithMeta(root, p.slice(1), meta, origin, pageUrl, res, next);
        })();
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
