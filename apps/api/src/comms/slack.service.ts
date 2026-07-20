import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";
import { EventsService, type RealtimeEvent } from "../events/events.service";
import { SlackClient } from "./slack.client";

/** What the settings UI sees — never the raw webhook (it embeds a secret). */
export interface SlackConfigView {
  configured: boolean;
  webhookPreview: string | null;
  events: string[];
  active: boolean;
}

interface SlackRow {
  webhook_url: string;
  events: string[];
  active: boolean;
}

/** Mask the secret path segment of a Slack webhook for display. */
function preview(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}/…${url.slice(-5)}`;
  } catch {
    return "configured";
  }
}

/** A short, human-readable line for a realtime change hint. */
function describe(event: RealtimeEvent): string | null {
  const name =
    typeof event.payload?.name === "string" ? ` “${event.payload.name}”` : "";
  switch (event.type) {
    case "task.changed":
      return `📋 A task was updated${name}`;
    case "comment.changed":
      return `💬 New comment activity${name}`;
    case "doc.changed":
      return `📄 A doc was updated${name}`;
    case "goal.changed":
      return `🎯 Goal progress changed${name}`;
    case "chat.message":
      return `💬 New chat message${name}`;
    default:
      // Unknown/low-value hints (presence, notification.new) are not posted.
      return null;
  }
}

/**
 * Module 22 — Slack integration. A workspace admin configures an incoming
 * webhook; StackUp then posts human-readable notifications for the selected
 * event types to that channel. Delivery mirrors the outgoing-webhook engine:
 * a non-blocking tap on the in-process event bus, system-context lookups, and
 * a best-effort post that never disturbs the originating mutation.
 */
@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private untap: (() => void) | null = null;

  constructor(
    private readonly db: DbService,
    private readonly events: EventsService,
    private readonly slack: SlackClient,
  ) {}

  onModuleInit(): void {
    this.untap = this.events.tap((workspaceId, event) => {
      void this.dispatch(workspaceId, event).catch((err) =>
        this.logger.warn(`slack dispatch error: ${(err as Error).message}`),
      );
    });
  }
  onModuleDestroy(): void {
    this.untap?.();
  }

  async getConfig(workspaceId: string, userId: string): Promise<SlackConfigView> {
    return this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        `SELECT webhook_url, events, active FROM slack_integrations WHERE workspace_id = $1`,
        [workspaceId],
      );
      const row = res.rows[0] as SlackRow | undefined;
      if (!row) {
        return { configured: false, webhookPreview: null, events: ["*"], active: false };
      }
      return {
        configured: true,
        webhookPreview: preview(row.webhook_url),
        events: row.events,
        active: row.active,
      };
    });
  }

  async setConfig(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { webhookUrl?: string; events?: string[]; active?: boolean },
  ): Promise<SlackConfigView> {
    if (role !== "owner" && role !== "admin") {
      throw new ForbiddenException("Only admins can configure Slack");
    }
    const url = (body.webhookUrl ?? "").trim();
    if (!/^https:\/\//i.test(url)) {
      throw new BadRequestException("A valid https Slack webhook URL is required");
    }
    const events =
      Array.isArray(body.events) && body.events.length > 0
        ? body.events.map(String)
        : ["*"];
    const active = body.active !== false;
    return this.db.withWorkspace(workspaceId, userId, async (c) => {
      await c.query(
        `INSERT INTO slack_integrations (workspace_id, webhook_url, events, active, created_by, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, now())
         ON CONFLICT (workspace_id) DO UPDATE
           SET webhook_url = EXCLUDED.webhook_url,
               events = EXCLUDED.events,
               active = EXCLUDED.active,
               updated_at = now()`,
        [workspaceId, url, JSON.stringify(events), active, userId],
      );
      return {
        configured: true,
        webhookPreview: preview(url),
        events,
        active,
      };
    });
  }

  async remove(workspaceId: string, userId: string, role: Role): Promise<void> {
    if (role !== "owner" && role !== "admin") {
      throw new ForbiddenException("Only admins can configure Slack");
    }
    await this.db.withWorkspace(workspaceId, userId, async (c) => {
      await c.query(`DELETE FROM slack_integrations WHERE workspace_id = $1`, [workspaceId]);
    });
  }

  /** Send a test message so an admin can confirm the webhook works. */
  async test(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<{ ok: boolean; detail: string }> {
    if (role !== "owner" && role !== "admin") {
      throw new ForbiddenException("Only admins can configure Slack");
    }
    const row = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        `SELECT webhook_url, events, active FROM slack_integrations WHERE workspace_id = $1`,
        [workspaceId],
      );
      return res.rows[0] as SlackRow | undefined;
    });
    if (!row) throw new NotFoundException("Slack is not configured");
    return this.slack.post(
      row.webhook_url,
      ":wave: StackUp is connected — you'll get notifications here.",
    );
  }

  private async dispatch(workspaceId: string, event: RealtimeEvent): Promise<void> {
    const text = describe(event);
    if (!text) return;
    const row = await this.db.withWorkspaceSystem(workspaceId, async (c) => {
      const res = await c.query(
        `SELECT webhook_url, events, active FROM slack_integrations
          WHERE workspace_id = $1 AND active = true`,
        [workspaceId],
      );
      return res.rows[0] as SlackRow | undefined;
    });
    if (!row) return;
    if (!(row.events.includes("*") || row.events.includes(event.type))) return;
    await this.slack.post(row.webhook_url, text);
  }
}
