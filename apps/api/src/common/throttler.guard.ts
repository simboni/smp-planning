import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Rate-limit guard tuned for this deployment:
 *
 * - **Behind a proxy** (Render/Fly terminate TLS and forward), `req.ip` is the
 *   proxy, so all clients would share one bucket. We key on the leftmost
 *   `X-Forwarded-For` hop instead, falling back to `req.ip`.
 * - **Disabled under tests** — the e2e suite intentionally hammers endpoints
 *   (many logins/signups from one host); throttling there only causes flakes.
 *   Production/staging keep the limits.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(): Promise<boolean> {
    return process.env.NODE_ENV === "test";
  }

  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, string | string[]>;
    const fwd = headers["x-forwarded-for"];
    const first = Array.isArray(fwd) ? fwd[0] : (fwd ?? "").split(",")[0];
    return (first || "").trim() || (req.ip as string) || "unknown";
  }
}
