import type { Request, Response } from "express";

/**
 * Web sessions keep the long-lived refresh token in an httpOnly cookie that
 * page scripts can't read (so an XSS bug can't steal it from localStorage).
 * The web client opts in per request with `X-Auth-Cookie: 1`; the native app
 * and older clients keep sending the token in the body and are unaffected.
 *
 * Path=/auth limits the cookie to refresh / logout / sessions; SameSite=Strict
 * keeps it off cross-site requests.
 */
export const REFRESH_COOKIE = "stackup_rt";
const COOKIE_PATH = "/auth";

export function wantsCookie(req: Request): boolean {
  return req.headers["x-auth-cookie"] === "1";
}

export function readRefreshCookie(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      const v = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(v) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function isSecure(req: Request): boolean {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  return req.secure || proto === "https" || process.env.NODE_ENV === "production";
}

export function setRefreshCookie(req: Request, res: Response, token: string, ttlSeconds: number): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: ttlSeconds * 1000,
  });
}

export function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: "strict",
    path: COOKIE_PATH,
  });
}

/**
 * Finish a token-issuing response. Cookie mode: set the cookie and leave the
 * refresh token out of the body. Otherwise return the result unchanged.
 */
export function deliverTokens<T extends object>(
  req: Request,
  res: Response,
  result: T,
  ttlSeconds: number,
  forceCookie = false,
): T {
  const token = (result as { refreshToken?: unknown }).refreshToken;
  if (typeof token !== "string" || !(forceCookie || wantsCookie(req))) return result;
  setRefreshCookie(req, res, token, ttlSeconds);
  const { refreshToken: _omit, ...rest } = result as T & { refreshToken?: string };
  void _omit;
  return rest as T;
}
