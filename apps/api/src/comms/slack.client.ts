import { Injectable } from "@nestjs/common";

export interface SlackPostResult {
  ok: boolean;
  detail: string;
}

/**
 * Thin poster to a Slack incoming webhook, behind an injectable so the Slack
 * integration can be exercised in tests with a fake that captures messages —
 * no network, no real workspace. A Slack incoming webhook accepts a simple
 * `{ text }` JSON body and returns 200 "ok".
 */
@Injectable()
export class SlackClient {
  async post(webhookUrl: string, text: string): Promise<SlackPostResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      return { ok: res.ok, detail: res.ok ? "sent" : `slack responded ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
