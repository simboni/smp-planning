import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "../config";
import {
  brandedText,
  renderBrandedEmail,
  type BrandedEmail,
} from "./email.template";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional branded HTML body. When present it's sent alongside `text`. */
  html?: string;
}

/** A message whose body is rendered from the branded StackUp template. */
export interface BrandedMessage extends BrandedEmail {
  to: string;
  subject: string;
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
 *   - "http" : POSTs { from, to, subject, text, html? } as JSON to
 *              EMAIL_RELAY_URL, the seam a provider (Resend/SES/SendGrid)
 *              plugs into. When `html` is present it's a branded message.
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
        // Optional auth for the relay (e.g. "Bearer re_..." for Resend, whose
        // API accepts this exact {from,to,subject,text} payload directly).
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.config.emailRelayAuth) {
          headers[this.config.emailRelayAuthHeader] = this.config.emailRelayAuth;
        }
        const res = await fetch(this.config.emailRelayUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            from: this.config.emailFrom,
            to: message.to,
            subject: message.subject,
            text: message.text,
            // Resend (and most relays) render `html` when present, falling
            // back to `text` for plain-text clients. Only sent when branded.
            ...(message.html ? { html: message.html } : {}),
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

  /**
   * Send a message rendered from the branded StackUp template. The HTML is
   * built from the merge vars and a matching plain-text part is derived, so
   * every branded email degrades gracefully in text-only clients.
   */
  async sendBranded(message: BrandedMessage): Promise<EmailResult> {
    const { to, subject, ...fields } = message;
    return this.send({
      to,
      subject,
      text: brandedText(fields),
      html: renderBrandedEmail(fields),
    });
  }

  /** Send a canned test message so an admin can verify delivery is live. */
  async sendTest(to: string): Promise<EmailResult> {
    return this.sendBranded({
      to,
      subject: "StackUp email is working ✅",
      heading: "Your email is working",
      preheader: "Outbound email is configured correctly.",
      body:
        "This is a test message from StackUp.\n\n" +
        "If it reached your inbox, outbound email is configured correctly — " +
        "password resets, invites and task notifications will now be delivered to your team.",
      buttonLabel: "Open StackUp",
      buttonUrl: "https://www.stackup.co.ke",
    });
  }
}
