import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";
import { EventsService, RealtimeEvent } from "../events/events.service";

export interface WebhookSummary {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  statusCode: number | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  events: string[];
}

/**
 * Outbound webhooks (M15). On construction the service taps the global event
 * bus; every hint any module publishes (`task.changed`, `comment.changed`, …)
 * is fanned out to the workspace's matching, active webhooks. Deliveries are
 * fire-and-forget (they never block the publisher), HMAC-SHA256 signed with
 * each webhook's secret, and logged to webhook_deliveries. The dispatch read
 * runs under a system (workspace-only) context — there is no acting user on
 * the event bus.
 */
@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private untap: (() => void) | null = null;

  constructor(
    private readonly db: DbService,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    this.untap = this.events.tap((workspaceId, event) => {
      // Never block the publisher; never let a dispatch error escape.
      void this.dispatch(workspaceId, event).catch((err) =>
        this.logger.warn(`webhook dispatch error: ${(err as Error).message}`),
      );
    });
  }

  onModuleDestroy(): void {
    this.untap?.();
  }

  async list(
    workspaceId: string,
    userId: string,
  ): Promise<WebhookSummary[]> {
    return this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        "SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at DESC",
      );
      return res.rows.map(toSummary);
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { url?: string; events?: string[] },
  ): Promise<{ webhook: WebhookSummary; secret: string }> {
    if (role === "guest") throw new NotFoundException();
    const url = (body.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new NotFoundException("A valid http(s) URL is required");
    }
    const events =
      Array.isArray(body.events) && body.events.length > 0
        ? body.events.map(String)
        : ["*"];
    const secret = "whsec_" + randomBytes(24).toString("hex");
    const row = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        `INSERT INTO webhooks (workspace_id, url, secret, events, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, url, events, active, created_at`,
        [workspaceId, url, secret, events, userId],
      );
      return res.rows[0];
    });
    return { webhook: toSummary(row), secret };
  }

  async remove(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    const n = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query("DELETE FROM webhooks WHERE id = $1", [id]);
      return res.rowCount ?? 0;
    });
    if (n === 0) throw new NotFoundException("Webhook not found");
  }

  async deliveries(
    workspaceId: string,
    userId: string,
    webhookId: string,
  ): Promise<WebhookDelivery[]> {
    return this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        `SELECT id, event, status_code, ok, error, created_at
         FROM webhook_deliveries WHERE webhook_id = $1
         ORDER BY created_at DESC LIMIT 25`,
        [webhookId],
      );
      return res.rows.map(toDelivery);
    });
  }

  /** Send a synthetic ping to one webhook so users can verify their endpoint. */
  async test(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<{ ok: boolean; statusCode: number | null }> {
    const hook = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        "SELECT id, url, secret, events FROM webhooks WHERE id = $1",
        [id],
      );
      return res.rows[0] as WebhookRow | undefined;
    });
    if (!hook) throw new NotFoundException("Webhook not found");
    return this.deliver(workspaceId, hook, {
      type: "ping",
      payload: { message: "StackUp webhook test" },
    });
  }

  /** Fan a bus event out to every matching active webhook in the workspace. */
  private async dispatch(
    workspaceId: string,
    event: RealtimeEvent,
  ): Promise<void> {
    // presence is high-frequency and carries no durable change — skip it.
    if (event.type === "presence") return;
    const hooks = await this.db.withWorkspaceSystem(workspaceId, async (c) => {
      const res = await c.query(
        "SELECT id, url, secret, events FROM webhooks WHERE active = true",
      );
      return res.rows as WebhookRow[];
    });
    const matching = hooks.filter(
      (h) => h.events.includes("*") || h.events.includes(event.type),
    );
    for (const hook of matching) {
      await this.deliver(workspaceId, hook, event);
    }
  }

  private async deliver(
    workspaceId: string,
    hook: WebhookRow,
    event: RealtimeEvent,
  ): Promise<{ ok: boolean; statusCode: number | null }> {
    const body = JSON.stringify({
      event: event.type,
      workspaceId,
      data: event.payload,
    });
    const signature = createHmac("sha256", hook.secret)
      .update(body)
      .digest("hex");
    let statusCode: number | null = null;
    let ok = false;
    let error: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stackup-event": event.type,
          "x-stackup-signature": `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      statusCode = res.status;
      ok = res.ok;
    } catch (err) {
      error = (err as Error).message;
    }
    await this.db
      .withWorkspaceSystem(workspaceId, async (c) => {
        await c.query(
          `INSERT INTO webhook_deliveries
             (workspace_id, webhook_id, event, status_code, ok, error)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workspaceId, hook.id, event.type, statusCode, ok, error],
        );
      })
      .catch(() => undefined);
    return { ok, statusCode };
  }
}

function toSummary(row: {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
}): WebhookSummary {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    active: row.active,
    createdAt: row.created_at,
  };
}

function toDelivery(row: {
  id: string;
  event: string;
  status_code: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}): WebhookDelivery {
  return {
    id: row.id,
    event: row.event,
    statusCode: row.status_code,
    ok: row.ok,
    error: row.error,
    createdAt: row.created_at,
  };
}
