import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "../config";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailResult {
  ok: boolean;
  provider: string;
  detail: string;
}

/**
 * Module 22 — pluggable email delivery. The provider is chosen by config so
 * outbound mail can go to a real relay in production while development (and
 * the test suite) uses a no-op logger. Nothing in the app blocks on delivery:
 * callers fire-and-record, and a failed send never rolls back the mutation it
 * accompanies.
 *
 * Providers:
 *   - "log"  (default): records the message and returns ok — no network.
 *   - "http" : POSTs { from, to, subject, text } as JSON to EMAIL_RELAY_URL,
 *              the seam a provider (SES/SendGrid/SMTP-bridge) plugs into.
 *
 * Tests override this whole service with a fake that captures messages.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly config = loadConfig();

  /** Which provider is active (drives the settings status chip). */
  providerName(): string {
    return this.config.emailProvider === "http" && this.config.emailRelayUrl
      ? "http"
      : "log";
  }

  /** True once a real delivery channel is configured. */
  configured(): boolean {
    return this.providerName() === "http";
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const provider = this.providerName();
    if (provider === "http") {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(this.config.emailRelayUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from: this.config.emailFrom,
            to: message.to,
            subject: message.subject,
            text: message.text,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        return {
          ok: res.ok,
          provider,
          detail: res.ok ? "delivered" : `relay responded ${res.status}`,
        };
      } catch (err) {
        return { ok: false, provider, detail: (err as Error).message };
      }
    }
    // "log" provider — the safe default.
    this.logger.log(`email → ${message.to}: ${message.subject}`);
    return { ok: true, provider: "log", detail: "logged (no delivery channel configured)" };
  }
}
