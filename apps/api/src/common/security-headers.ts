import type { NextFunction, Request, Response } from "express";

/**
 * Baseline security headers on every response. The Content-Security-Policy is
 * the key defense-in-depth against XSS: `connect-src 'self'` blocks
 * exfiltration to an attacker host, `object-src 'none'` kills plugin vectors,
 * `base-uri 'self'` blocks <base> hijacking. 'unsafe-inline' is required for
 * Next.js's inline bootstrap and the theme/native marker scripts; the
 * server-side HTML sanitizer (docs.support.ts) is what actually strips
 * injected markup, with CSP as the backstop. Same-origin deploy, so 'self'
 * covers the API, the SSE stream and file downloads; extra API origins can be
 * allow-listed via WEB_ORIGINS for split deploys.
 *
 * Strict-Transport-Security (audit, security): once a browser has reached
 * StackUp over HTTPS it refuses plain HTTP for a year. Sent on HTTPS requests
 * (directly, or via the proxy's X-Forwarded-Proto) and on every production
 * response — browsers ignore it over plain HTTP, so that's safe even if the
 * proxy doesn't forward the protocol. Local http:// development (not
 * production) never gets it.
 */
export function securityHeaders(origins: string[]) {
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
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", csp);
    if (isHttps(req) || process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.removeHeader("X-Powered-By");
    next();
  };
}

function isHttps(req: Request): boolean {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  return req.secure || proto === "https";
}
