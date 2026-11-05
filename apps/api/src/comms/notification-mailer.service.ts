import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { loadConfig, publicWebBase } from "../config";
import { DbService } from "../db/db.service";
import { EmailService } from "./email.service";

/** A notification older than this is not news; it is never emailed. */
const STALE_NOTIFICATION_HOURS = 48;
/** A reminder this late (the sender was down) is stamped, not sent. */
const STALE_REMINDER_HOURS = 24;
/** At most this many lines in one email; the rest is "and N more". */
const MAX_LINES = 15;

const MENTION_RE =
  /@\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

interface Item {
  /** notification or reminder id */
  id: string;
  source: "notification" | "reminder";
  userId: string;
  email: string;
  firstName: string;
  kind: string; // assigned | mention | reminder
  actor: string;
  message: string;
  taskId: string | null;
  taskName: string | null;
  listId: string | null;
  excerpt: string;
}

interface Planned {
  userId: string;
  to: string;
  subject: string;
  heading: string;
  preheader: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  kind: string;
  notificationIds: string[];
  reminderIds: string[];
  /** state to undo to if the send fails */
  revertTo: "pending" | "digest";
}

/**
 * Emails what used to live only in the inbox: being assigned a task or a
 * comment, being @mentioned, and personal reminders when they come due. Plus
 * a once-a-day summary for anyone who chose one, and for updates that did
 * not fit under the daily cap.
 *
 * How it works: every minute it asks the database (email_pending_workspaces,
 * a SECURITY DEFINER function returning ids only) which workspaces have
 * something waiting, then, workspace by workspace and under that workspace's
 * own RLS context, it decides per person — instant, summary or nothing — and
 * claims the rows BEFORE sending, so a crash can lose one email but can never
 * send the same one twice. A failed send puts the rows back for the next
 * minute; when the relay is down, it stops for this round instead of waiting
 * out a timeout per email.
 *
 * Several updates for one person in the same minute go as one email. The
 * daily cap (EMAIL_DAILY_CAP, counted from email_sends over 24 hours) is
 * shared by everything this sends; past it, updates wait for the summary and
 * reminders wait for room.
 */
@Injectable()
export class NotificationMailerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationMailerService.name);
  private readonly config = loadConfig();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private lastError = "";

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    // Tests drive runOnce() themselves.
    if (process.env.NODE_ENV === "test") return;
    const every = this.config.emailNotifyIntervalMs;
    if (every <= 0) return;
    this.timer = setInterval(() => void this.runOnce(), every);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass. Overlapping calls share the pass already running. `only`
   * limits it to some workspaces — for tests, which share a database.
   */
  runOnce(opts: { now?: Date; only?: string[] } = {}): Promise<void> {
    if (!this.running) {
      this.running = this.pass(opts.now ?? new Date(), opts.only)
        .then(() => {
          this.lastError = "";
        })
        .catch((err: Error) => {
          // Log a repeating failure once, not every minute — e.g. the minute
          // between a deploy and its migration, when the columns do not exist.
          if (err.message !== this.lastError) {
            this.logger.warn(`notification emails: ${err.message}`);
            this.lastError = err.message;
          }
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  private async pass(now: Date, only?: string[]): Promise<void> {
    const res = await this.db.query("SELECT id FROM email_pending_workspaces() AS id");
    const workspaces = res.rows
      .map((r) => r.id as string)
      .filter((id) => !only || only.includes(id));
    if (workspaces.length === 0) return;

    const used = await this.db.query(
      "SELECT count(*)::int AS n FROM email_sends WHERE sent_at > now() - interval '24 hours'",
    );
    let budget = Math.max(0, this.config.emailDailyCap - ((used.rows[0]?.n as number) ?? 0));
    const cutoff = digestCutoff(now, this.config.emailDigestHourUtc);

    for (const ws of workspaces) {
      const planned = await this.db.withWorkspaceSystem(ws, (client) =>
        this.plan(client, budget, cutoff),
      );
      for (const p of planned) {
        const result = await this.email.sendBranded(
          {
            to: p.to,
            subject: p.subject,
            heading: p.heading,
            preheader: p.preheader,
            body: p.body,
            buttonLabel: p.buttonLabel,
            buttonUrl: p.buttonUrl,
            unsubscribeUrl: `${this.base()}/settings#email`,
          },
          { kind: p.kind, userId: p.userId },
        );
        budget -= 1;
        if (!result.ok) {
          // Put this one, and everything else claimed in this workspace and
          // not yet sent, back — then stop this round.
          const rest = planned.slice(planned.indexOf(p));
          await this.db.withWorkspaceSystem(ws, (client) => this.revert(client, rest));
          throw new Error(`email relay refused or unreachable (${result.detail}); will retry`);
        }
      }
    }
    // Housekeeping: the cap only looks back 24 hours.
    await this.db.query("DELETE FROM email_sends WHERE sent_at < now() - interval '7 days'");
  }

  private base(): string {
    return publicWebBase(this.config);
  }

  /** Decide and claim, for one workspace. Returns what to send. */
  private async plan(client: PoolClient, budget: number, cutoff: Date): Promise<Planned[]> {
    // --- settle what will never be emailed ---------------------------------
    await client.query(
      `UPDATE notifications n SET email_state = 'skipped'
       WHERE n.email_state IS NULL
         AND (n.kind NOT IN ('assigned', 'mention')
              OR n.read_at IS NOT NULL
              OR n.created_at < now() - make_interval(hours => $1)
              OR EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id
                           AND (u.email_notify = 'off' OR u.status <> 'active'))
              OR NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = n.user_id
                               AND m.workspace_id = n.workspace_id AND m.status = 'active'))`,
      [STALE_NOTIFICATION_HOURS],
    );
    // Summary people, and anything waiting for a summary that is now read or
    // whose person has since said 'off'.
    await client.query(
      `UPDATE notifications n SET email_state = 'digest'
       FROM users u
       WHERE u.id = n.user_id AND n.email_state IS NULL AND u.email_notify = 'digest'`,
    );
    await client.query(
      `UPDATE notifications n SET email_state = 'skipped'
       WHERE n.email_state = 'digest'
         AND (n.read_at IS NOT NULL
              OR n.created_at < now() - interval '7 days'
              OR EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id
                           AND (u.email_notify = 'off' OR u.status <> 'active')))`,
    );
    await client.query(
      `UPDATE reminders r SET emailed_at = now()
       WHERE r.emailed_at IS NULL AND r.done_at IS NULL AND r.remind_at <= now()
         AND (r.remind_at < now() - make_interval(hours => $1)
              OR EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id
                           AND (u.email_notify = 'off' OR u.status <> 'active'))
              OR NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = r.user_id
                               AND m.workspace_id = r.workspace_id AND m.status = 'active'))`,
      [STALE_REMINDER_HOURS],
    );

    const wsRes = await client.query(
      "SELECT name FROM workspaces WHERE id = current_setting('app.current_workspace')::uuid",
    );
    const wsName = (wsRes.rows[0]?.name as string | undefined) ?? "your workspace";

    // --- what is due now -----------------------------------------------------
    const reminders = await this.loadItems(
      client,
      `SELECT r.id, r.user_id, 'reminder' AS kind, '' AS actor, r.note AS message,
              r.task_id, t.name AS task_name, t.list_id, NULL::text AS comment_body,
              u.email, u.full_name
       FROM reminders r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.emailed_at IS NULL AND r.done_at IS NULL AND r.remind_at <= now()
       ORDER BY r.remind_at
       FOR UPDATE OF r SKIP LOCKED`,
      [],
      "reminder",
    );
    const instant = await this.loadItems(
      client,
      `SELECT n.id, n.user_id, n.kind, coalesce(a.full_name, 'Someone') AS actor, n.message,
              n.task_id, t.name AS task_name, t.list_id, c.body AS comment_body,
              u.email, u.full_name
       FROM notifications n
       JOIN users u ON u.id = n.user_id
       LEFT JOIN users a ON a.id = n.actor_user_id
       LEFT JOIN tasks t ON t.id = n.task_id
       LEFT JOIN comments c ON c.id = n.comment_id
       WHERE n.email_state IS NULL
       ORDER BY n.created_at
       FOR UPDATE OF n SKIP LOCKED`,
      [],
      "notification",
    );
    const digest = await this.loadItems(
      client,
      `SELECT n.id, n.user_id, n.kind, coalesce(a.full_name, 'Someone') AS actor, n.message,
              n.task_id, t.name AS task_name, t.list_id, NULL::text AS comment_body,
              u.email, u.full_name
       FROM notifications n
       JOIN users u ON u.id = n.user_id
       LEFT JOIN users a ON a.id = n.actor_user_id
       LEFT JOIN tasks t ON t.id = n.task_id
       WHERE n.email_state = 'digest' AND n.created_at < $1
       ORDER BY n.created_at
       FOR UPDATE OF n SKIP LOCKED`,
      [cutoff.toISOString()],
      "notification",
    );

    const planned: Planned[] = [];
    const sent: string[] = [];
    const toDigest: string[] = [];
    const digested: string[] = [];
    const remindersSent: string[] = [];

    // Reminders first: they are the ones that are about a time.
    for (const group of byUser(reminders)) {
      if (budget <= 0) break; // they stay due and go when there is room
      budget -= 1;
      planned.push(this.instantEmail(group, wsName, "pending"));
      remindersSent.push(...group.map((g) => g.id));
    }
    for (const group of byUser(instant)) {
      if (budget <= 0) {
        toDigest.push(...group.map((g) => g.id));
        continue;
      }
      budget -= 1;
      planned.push(this.instantEmail(group, wsName, "pending"));
      sent.push(...group.map((g) => g.id));
    }
    for (const group of byUser(digest)) {
      if (budget <= 0) break; // still waiting; next pass with room sends it
      budget -= 1;
      planned.push(this.digestEmail(group, wsName));
      digested.push(...group.map((g) => g.id));
    }

    // --- claim before sending -----------------------------------------------
    const mark = async (ids: string[], state: string) => {
      if (ids.length === 0) return;
      await client.query(
        `UPDATE notifications SET email_state = $2,
                emailed_at = CASE WHEN $2 IN ('sent', 'digested') THEN now() ELSE emailed_at END
         WHERE id = ANY($1::uuid[])`,
        [ids, state],
      );
    };
    await mark(sent, "sent");
    await mark(toDigest, "digest");
    await mark(digested, "digested");
    if (remindersSent.length > 0) {
      await client.query(
        "UPDATE reminders SET emailed_at = now() WHERE id = ANY($1::uuid[])",
        [remindersSent],
      );
    }
    return planned;
  }

  private async revert(client: PoolClient, planned: Planned[]): Promise<void> {
    for (const p of planned) {
      if (p.notificationIds.length > 0) {
        await client.query(
          `UPDATE notifications SET email_state = $2, emailed_at = NULL
           WHERE id = ANY($1::uuid[])`,
          [p.notificationIds, p.revertTo === "digest" ? "digest" : null],
        );
      }
      if (p.reminderIds.length > 0) {
        await client.query(
          "UPDATE reminders SET emailed_at = NULL WHERE id = ANY($1::uuid[])",
          [p.reminderIds],
        );
      }
    }
  }

  private async loadItems(
    client: PoolClient,
    sql: string,
    params: unknown[],
    source: Item["source"],
  ): Promise<Item[]> {
    const res = await client.query(sql, params);
    const bodies = res.rows.map((r) => (r.comment_body as string | null) ?? "");
    const names = await mentionNames(client, bodies);
    return res.rows.map((r, i) => ({
      id: r.id as string,
      source,
      userId: r.user_id as string,
      email: r.email as string,
      firstName: ((r.full_name as string | null) || "there").split(" ")[0],
      kind: r.kind as string,
      actor: r.actor as string,
      message: (r.message as string | null) ?? "",
      taskId: (r.task_id as string | null) ?? null,
      taskName: (r.task_name as string | null) ?? null,
      listId: (r.list_id as string | null) ?? null,
      excerpt: excerpt(bodies[i], names),
    }));
  }

  private taskUrl(it: Item): string {
    if (it.taskId && it.listId) {
      return `${this.base()}/list?id=${it.listId}&task=${it.taskId}`;
    }
    return `${this.base()}/inbox`;
  }

  /** One update → a specific email. Several → one email listing them. */
  private instantEmail(group: Item[], wsName: string, revertTo: Planned["revertTo"]): Planned {
    const first = group[0];
    const ids = splitIds(group);
    const common = {
      userId: first.userId,
      to: first.email,
      notificationIds: ids.notifications,
      reminderIds: ids.reminders,
      revertTo,
    };
    if (group.length === 1) {
      const it = first;
      const task = it.taskName ? `“${it.taskName}”` : "";
      if (it.kind === "reminder") {
        return {
          ...common,
          kind: "reminder",
          subject: `Reminder: ${clip(it.message, 80)}`,
          heading: "Reminder",
          preheader: clip(it.message, 120),
          body:
            `Hi ${it.firstName},\n\n${it.message}` +
            (task ? `\n\nOn ${task} in ${wsName}.` : `\n\nIn ${wsName}.`),
          buttonLabel: it.taskId ? "Open task" : "Open your inbox",
          buttonUrl: this.taskUrl(it),
        };
      }
      if (it.kind === "mention") {
        return {
          ...common,
          kind: "mention",
          subject: `${it.actor} mentioned you${task ? ` on ${task}` : ""}`,
          heading: `${it.actor} mentioned you`,
          preheader: it.excerpt || `On ${task || "a task"} in ${wsName}`,
          body:
            `Hi ${it.firstName},\n\n${it.actor} mentioned you in a comment` +
            (task ? ` on ${task}` : "") +
            ` in ${wsName}.` +
            (it.excerpt ? `\n\n“${it.excerpt}”` : ""),
          buttonLabel: "Reply",
          buttonUrl: this.taskUrl(it),
        };
      }
      const what = it.message.includes("comment") ? "a comment" : "a task";
      return {
        ...common,
        kind: "assigned",
        subject: `${it.actor} assigned you ${task || what}`,
        heading: what === "a task" ? "You have a new task" : "A comment needs you",
        preheader: `${it.actor} ${it.message || "assigned you a task"}${task ? `: ${task}` : ""}`,
        body:
          `Hi ${it.firstName},\n\n${it.actor} ${it.message || "assigned you a task"}` +
          (task ? ` — ${task}` : "") +
          ` in ${wsName}.` +
          (it.excerpt ? `\n\n“${it.excerpt}”` : ""),
        buttonLabel: what === "a task" ? "Open task" : "Open comment",
        buttonUrl: this.taskUrl(it),
      };
    }
    return {
      ...common,
      kind: "batch",
      subject: `${group.length} new updates for you in ${wsName}`,
      heading: `You have ${group.length} new updates`,
      preheader: line(group[0]),
      body: `Hi ${first.firstName},\n\n${lines(group)}`,
      buttonLabel: "Open your inbox",
      buttonUrl: `${this.base()}/inbox`,
    };
  }

  private digestEmail(group: Item[], wsName: string): Planned {
    const first = group[0];
    const ids = splitIds(group);
    return {
      userId: first.userId,
      to: first.email,
      notificationIds: ids.notifications,
      reminderIds: ids.reminders,
      revertTo: "digest",
      kind: "digest",
      subject: `Your StackUp summary: ${group.length} update${group.length === 1 ? "" : "s"} in ${wsName}`,
      heading: "Your daily summary",
      preheader: line(first),
      body:
        `Hi ${first.firstName},\n\nSince your last summary, in ${wsName}:\n\n${lines(group)}` +
        "\n\nYou get these together once a day — either because you chose that in " +
        "your email settings, or because StackUp's email allowance for the day ran out.",
      buttonLabel: "Open your inbox",
      buttonUrl: `${this.base()}/inbox`,
    };
  }
}

/** The most recent digest time at or before `now`. */
export function digestCutoff(now: Date, hourUtc: number): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc));
  if (d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function byUser(items: Item[]): Item[][] {
  const m = new Map<string, Item[]>();
  for (const it of items) {
    const g = m.get(it.userId);
    if (g) g.push(it);
    else m.set(it.userId, [it]);
  }
  return [...m.values()];
}

function splitIds(group: Item[]): { notifications: string[]; reminders: string[] } {
  return {
    notifications: group.filter((g) => g.source === "notification").map((g) => g.id),
    reminders: group.filter((g) => g.source === "reminder").map((g) => g.id),
  };
}

function line(it: Item): string {
  const task = it.taskName ? ` “${it.taskName}”` : "";
  if (it.kind === "reminder") return `• Reminder: ${clip(it.message, 100)}${task ? ` (${task.trim()})` : ""}`;
  if (it.kind === "mention") return `• ${it.actor} mentioned you${task ? ` on${task}` : ""}`;
  return `• ${it.actor} ${it.message || "assigned you a task"}${task ? ` —${task}` : ""}`;
}

function lines(group: Item[]): string {
  const shown = group.slice(0, MAX_LINES).map(line);
  if (group.length > MAX_LINES) shown.push(`…and ${group.length - MAX_LINES} more in your inbox.`);
  return shown.join("\n");
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

async function mentionNames(client: PoolClient, bodies: string[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const b of bodies) for (const m of b.matchAll(MENTION_RE)) ids.add(m[1].toLowerCase());
  const out = new Map<string, string>();
  if (ids.size === 0) return out;
  const res = await client.query("SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])", [
    [...ids],
  ]);
  for (const r of res.rows) out.set(String(r.id).toLowerCase(), r.full_name as string);
  return out;
}

function excerpt(body: string, names: Map<string, string>): string {
  if (!body) return "";
  const plain = body.replace(MENTION_RE, (_, id: string) => `@${names.get(id.toLowerCase()) ?? "someone"}`);
  return clip(plain, 280);
}
