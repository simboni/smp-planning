import { createSign } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

export interface FcmSendResult {
  ok: boolean;
  /** True when FCM says the device token is gone — the caller should prune it. */
  unregistered: boolean;
  detail: string;
}

export interface FcmNotification {
  title: string;
  body: string;
  /** In-app route the mobile client opens when the notification is tapped. */
  path?: string;
}

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  projectId: string;
}

/**
 * Thin sender for Firebase Cloud Messaging (HTTP v1), behind an injectable so
 * push delivery can be exercised in tests with a fake that captures sends —
 * no network, no real Firebase project. Configured via the FCM_SERVICE_ACCOUNT
 * env (the service-account JSON, raw or base64); when unset the client reports
 * unconfigured and the whole push feature stays dormant.
 *
 * No SDK dependency: the OAuth2 access token is minted by signing a JWT with
 * node:crypto (RS256 over the service account's private key) and exchanging it
 * at Google's token endpoint, cached in-memory until shortly before expiry.
 */
@Injectable()
export class FcmClient {
  private readonly logger = new Logger(FcmClient.name);
  private cached: { token: string; expiresAtMs: number } | null = null;

  configured(): boolean {
    return this.account() !== null;
  }

  async send(token: string, n: FcmNotification): Promise<FcmSendResult> {
    const account = this.account();
    if (!account) {
      return { ok: false, unregistered: false, detail: "FCM is not configured" };
    }
    try {
      const accessToken = await this.accessToken(account);
      if (!accessToken) {
        return { ok: false, unregistered: false, detail: "could not mint an FCM access token" };
      }
      const res = await this.fetchWithTimeout(
        `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: n.title, body: n.body },
              data: n.path ? { path: n.path } : undefined,
              android: { priority: "high" },
            },
          }),
        },
      );
      if (res.ok) return { ok: true, unregistered: false, detail: "sent" };
      const text = await res.text().catch(() => "");
      // v1 reports a dead device token as 404 NOT_FOUND (or UNREGISTERED).
      const unregistered =
        res.status === 404 ||
        (res.status === 400 && text.includes("UNREGISTERED"));
      return { ok: false, unregistered, detail: `fcm responded ${res.status}` };
    } catch (err) {
      return { ok: false, unregistered: false, detail: (err as Error).message };
    }
  }

  /** Parse FCM_SERVICE_ACCOUNT (raw JSON, or base64 of it). null ⇒ dormant. */
  private account(): ServiceAccount | null {
    const raw = (process.env.FCM_SERVICE_ACCOUNT ?? "").trim();
    if (!raw) return null;
    try {
      const json = raw.startsWith("{")
        ? raw
        : Buffer.from(raw, "base64").toString("utf8");
      const parsed = JSON.parse(json) as {
        client_email?: string;
        private_key?: string;
        project_id?: string;
      };
      if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
        return null;
      }
      return {
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
        projectId: parsed.project_id,
      };
    } catch (err) {
      this.logger.warn(
        `FCM_SERVICE_ACCOUNT could not be parsed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** OAuth2 access token via the signed-JWT grant, cached until ~5min before expiry. */
  private async accessToken(account: ServiceAccount): Promise<string | null> {
    if (this.cached && Date.now() < this.cached.expiresAtMs - 5 * 60_000) {
      return this.cached.token;
    }
    const b64url = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
      iss: account.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(account.privateKey)
      .toString("base64url");
    const res = await this.fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    });
    if (!res.ok) {
      this.logger.warn(`FCM token mint failed: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    this.cached = {
      token: body.access_token,
      expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.cached.token;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    return fetch(url, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  }
}
