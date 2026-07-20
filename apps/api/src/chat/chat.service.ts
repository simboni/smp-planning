import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { roleAtLeast } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { EmailService } from "../comms/email.service";
import { DbService } from "../db/db.service";
import { EventsService } from "../events/events.service";
import { insertNotification } from "../inbox/inbox.support";
import {
  recordActivity,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  requireUuid,
} from "../tasks/tasks.support";

export interface UserRef {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ReactionOut {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface MessageOut {
  id: string;
  parentMessageId: string | null;
  author: UserRef;
  body: string;
  editedAt: string | null;
  createdAt: string;
  reactions: ReactionOut[];
  replyCount: number;
}

/** Mention tokens the client inserts into a message body: `@[<uuid>]`. */
const MENTION_RE =
  /@\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

const MSG_COLS = `
  m.id, m.parent_message_id, m.body, m.edited_at, m.created_at,
  a.id AS a_id, a.full_name AS a_full_name, a.avatar_url AS a_avatar_url`;
const MSG_FROM = `FROM messages m JOIN users a ON a.id = m.author_user_id`;

/**
 * Module 13: Chat, SyncUps and task email.
 *
 * Chat is a MEMBERS-only surface: guests (role 'guest') are refused on every
 * channel/message/DM route. Channels are either named public channels anyone
 * in the workspace may browse and join, or direct messages whose membership
 * IS the participant pair (keyed by a sorted dm_key so a pair maps to exactly
 * one channel). Messages thread one level via parent_message_id; unread is
 * driven by channel_members.last_read_at over top-level messages.
 *
 * SyncUps are lightweight huddle markers — this records/announces who started
 * a huddle and when; real A/V signaling is future work (no media here).
 *
 * Task email logs an outbound message composed from a task. Real delivery is
 * a pluggable SMTP adapter (disabled by default); we only record the row and
 * a task 'email' activity — an adapter would hook the send here.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly email: EmailService,
  ) {}

  // --- guards / helpers -----------------------------------------------------

  /** Chat is for workspace members; guests are refused outright. */
  private requireChatMember(role: Role): void {
    if (role === "guest") {
      throw new ForbiddenException("Chat is available to members only");
    }
  }

  private async channelRow(
    client: PoolClient,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(
      `SELECT id, name, description, is_dm, dm_key, created_by, created_at
         FROM channels WHERE id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException("Channel not found");
    return res.rows[0];
  }

  /** Assert the caller is a member of the channel (403 otherwise). */
  private async requireChannelMember(
    client: PoolClient,
    channelId: string,
    userId: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId],
    );
    if (!res.rows[0]) {
      throw new ForbiddenException("You are not a member of this channel");
    }
  }

  /** Workspace-member user ids among `ids` (RLS-confined to the workspace). */
  private async memberIds(
    client: PoolClient,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const res = await client.query(
      `SELECT user_id FROM memberships WHERE user_id = ANY($1)`,
      [ids],
    );
    return new Set(res.rows.map((r) => r.user_id as string));
  }

  /** Channel member user ids among `ids`. */
  private async channelMemberIds(
    client: PoolClient,
    channelId: string,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const res = await client.query(
      `SELECT user_id FROM channel_members
        WHERE channel_id = $1 AND user_id = ANY($2)`,
      [channelId, ids],
    );
    return new Set(res.rows.map((r) => r.user_id as string));
  }

  private userRef(
    r: Record<string, unknown>,
    prefix = "a_",
  ): UserRef {
    return {
      id: r[`${prefix}id`] as string,
      fullName: r[`${prefix}full_name`] as string,
      avatarUrl: (r[`${prefix}avatar_url`] as string | null) ?? null,
    };
  }

  /** reactions summary + replyCount for a set of message ids. */
  private async decorate(
    client: PoolClient,
    ids: string[],
    userId: string,
  ): Promise<{
    reactions: Map<string, ReactionOut[]>;
    replyCounts: Map<string, number>;
  }> {
    const reactions = new Map<string, ReactionOut[]>();
    const replyCounts = new Map<string, number>();
    if (ids.length === 0) return { reactions, replyCounts };

    const rx = await client.query(
      `SELECT message_id, emoji, count(*)::int AS count,
              bool_or(user_id = $2) AS mine
         FROM message_reactions
        WHERE message_id = ANY($1)
        GROUP BY message_id, emoji
        ORDER BY emoji`,
      [ids, userId],
    );
    for (const r of rx.rows) {
      const list = reactions.get(r.message_id as string) ?? [];
      list.push({
        emoji: r.emoji as string,
        count: r.count as number,
        mine: r.mine as boolean,
      });
      reactions.set(r.message_id as string, list);
    }

    const rc = await client.query(
      `SELECT parent_message_id, count(*)::int AS count
         FROM messages
        WHERE parent_message_id = ANY($1)
        GROUP BY parent_message_id`,
      [ids],
    );
    for (const r of rc.rows) {
      replyCounts.set(r.parent_message_id as string, r.count as number);
    }
    return { reactions, replyCounts };
  }

  private messageOut(
    r: Record<string, unknown>,
    reactions: ReactionOut[],
    replyCount: number,
  ): MessageOut {
    return {
      id: r.id as string,
      parentMessageId: (r.parent_message_id as string | null) ?? null,
      author: this.userRef(r),
      body: r.body as string,
      editedAt: iso(r.edited_at),
      createdAt: iso(r.created_at)!,
      reactions,
      replyCount,
    };
  }

  private async buildMessages(
    client: PoolClient,
    rows: Record<string, unknown>[],
    userId: string,
  ): Promise<MessageOut[]> {
    const ids = rows.map((r) => r.id as string);
    const { reactions, replyCounts } = await this.decorate(client, ids, userId);
    return rows.map((r) =>
      this.messageOut(
        r,
        reactions.get(r.id as string) ?? [],
        replyCounts.get(r.id as string) ?? 0,
      ),
    );
  }

  // --- Channels & DMs -------------------------------------------------------

  async listChannels(workspaceId: string, userId: string, role: Role) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT c.id, c.name, c.is_dm, cm.last_read_at,
                (SELECT count(*)::int FROM channel_members m
                  WHERE m.channel_id = c.id) AS member_count,
                (SELECT max(msg.created_at) FROM messages msg
                  WHERE msg.channel_id = c.id) AS last_message_at,
                (SELECT count(*)::int FROM messages msg
                  WHERE msg.channel_id = c.id
                    AND msg.parent_message_id IS NULL
                    AND msg.author_user_id <> $1
                    AND msg.created_at > cm.last_read_at) AS unread
           FROM channel_members cm
           JOIN channels c ON c.id = cm.channel_id
          WHERE cm.user_id = $1
          ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC`,
        [userId],
      );

      // Fetch DM participants in one pass.
      const dmIds = res.rows
        .filter((r) => r.is_dm as boolean)
        .map((r) => r.id as string);
      const membersByChannel = new Map<string, UserRef[]>();
      if (dmIds.length > 0) {
        const mem = await client.query(
          `SELECT cm.channel_id, u.id AS a_id, u.full_name AS a_full_name,
                  u.avatar_url AS a_avatar_url
             FROM channel_members cm
             JOIN users u ON u.id = cm.user_id
            WHERE cm.channel_id = ANY($1)
            ORDER BY u.full_name`,
          [dmIds],
        );
        for (const r of mem.rows) {
          const cid = r.channel_id as string;
          const list = membersByChannel.get(cid) ?? [];
          list.push(this.userRef(r));
          membersByChannel.set(cid, list);
        }
      }

      const channels = res.rows.map((r) => {
        const isDm = r.is_dm as boolean;
        return {
          id: r.id as string,
          name: r.name as string,
          isDm,
          ...(isDm
            ? { members: membersByChannel.get(r.id as string) ?? [] }
            : {}),
          memberCount: r.member_count as number,
          unread: r.unread as number,
          lastMessageAt: iso(r.last_message_at),
        };
      });
      return { channels };
    });
  }

  async listPublicChannels(workspaceId: string, userId: string, role: Role) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT c.id, c.name, c.description,
                (SELECT count(*)::int FROM channel_members m
                  WHERE m.channel_id = c.id) AS member_count,
                EXISTS(SELECT 1 FROM channel_members m
                        WHERE m.channel_id = c.id AND m.user_id = $1) AS joined
           FROM channels c
          WHERE c.is_dm = false
          ORDER BY c.created_at`,
        [userId],
      );
      const channels = res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        description: r.description as string,
        memberCount: r.member_count as number,
        joined: r.joined as boolean,
      }));
      return { channels };
    });
  }

  async createChannel(
    workspaceId: string,
    userId: string,
    role: Role,
    input: { name?: string; description?: string },
  ) {
    this.requireChatMember(role);
    const name = requireName(input?.name, "name");
    const description =
      typeof input?.description === "string" ? input.description : "";
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const ins = await client.query(
        `INSERT INTO channels (workspace_id, name, description, is_dm, created_by)
         VALUES ($1, $2, $3, false, $4)
         RETURNING id, name, description, is_dm, created_at`,
        [workspaceId, name, description, userId],
      );
      const c = ins.rows[0];
      const channelId = c.id as string;
      await client.query(
        `INSERT INTO channel_members (workspace_id, channel_id, user_id)
         VALUES ($1, $2, $3)`,
        [workspaceId, channelId, userId],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "channel.created",
        entity: "channel",
        entityId: channelId,
        data: { name },
      });
      return {
        channel: {
          id: channelId,
          name: c.name as string,
          description: c.description as string,
          isDm: false,
          memberCount: 1,
          createdAt: iso(c.created_at)!,
        },
      };
    });
  }

  async joinChannel(
    workspaceId: string,
    userId: string,
    role: Role,
    channelId: string,
  ) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const channel = await this.channelRow(client, channelId);
      if (channel.is_dm as boolean) {
        throw new BadRequestException("Cannot join a direct message");
      }
      await client.query(
        `INSERT INTO channel_members (workspace_id, channel_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [workspaceId, channelId, userId],
      );
      return { ok: true };
    });
  }

  async leaveChannel(
    workspaceId: string,
    userId: string,
    role: Role,
    channelId: string,
  ) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const channel = await this.channelRow(client, channelId);
      if (channel.is_dm as boolean) {
        throw new BadRequestException("Cannot leave a direct message");
      }
      await client.query(
        `DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
        [channelId, userId],
      );
      return { ok: true };
    });
  }

  async openDm(
    workspaceId: string,
    userId: string,
    role: Role,
    input: { userId?: string },
  ) {
    this.requireChatMember(role);
    const other = requireUuid(input?.userId, "userId");
    if (other === userId) {
      throw new BadRequestException("Cannot open a DM with yourself");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const members = await this.memberIds(client, [other]);
      if (!members.has(other)) {
        throw new BadRequestException("userId must be a member of this workspace");
      }
      const dmKey = [userId, other].sort().join(":");

      // Find-or-create: dm_key is UNIQUE, so a concurrent create collapses to
      // the same channel.
      const ins = await client.query(
        `INSERT INTO channels (workspace_id, is_dm, dm_key, created_by)
         VALUES ($1, true, $2, $3)
         ON CONFLICT (dm_key) DO NOTHING
         RETURNING id`,
        [workspaceId, dmKey, userId],
      );
      let channelId: string;
      if (ins.rows[0]) {
        channelId = ins.rows[0].id as string;
        for (const uid of [userId, other]) {
          await client.query(
            `INSERT INTO channel_members (workspace_id, channel_id, user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (channel_id, user_id) DO NOTHING`,
            [workspaceId, channelId, uid],
          );
        }
      } else {
        const found = await client.query(
          `SELECT id FROM channels WHERE dm_key = $1`,
          [dmKey],
        );
        channelId = found.rows[0].id as string;
      }

      const mem = await client.query(
        `SELECT u.id AS a_id, u.full_name AS a_full_name,
                u.avatar_url AS a_avatar_url
           FROM channel_members cm
           JOIN users u ON u.id = cm.user_id
          WHERE cm.channel_id = $1
          ORDER BY u.full_name`,
        [channelId],
      );
      return {
        channel: {
          id: channelId,
          name: "",
          isDm: true,
          members: mem.rows.map((r) => this.userRef(r)),
          memberCount: mem.rows.length,
        },
      };
    });
  }

  async markRead(
    workspaceId: string,
    userId: string,
    role: Role,
    channelId: string,
  ) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.channelRow(client, channelId);
      await this.requireChannelMember(client, channelId, userId);
      await client.query(
        `UPDATE channel_members SET last_read_at = now()
          WHERE channel_id = $1 AND user_id = $2`,
        [channelId, userId],
      );
      return { ok: true };
    });
  }

  // --- Messages -------------------------------------------------------------

  async listMessages(
    workspaceId: string,
    userId: string,
    role: Role,
    channelId: string,
    opts: { before?: string; limit?: number },
  ) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.channelRow(client, channelId);
      await this.requireChannelMember(client, channelId, userId);
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
      const params: unknown[] = [channelId];
      let where = `m.channel_id = $1 AND m.parent_message_id IS NULL`;
      if (opts.before) {
        params.push(opts.before);
        where += ` AND m.created_at < $${params.length}`;
      }
      params.push(limit);
      const res = await client.query(
        `SELECT ${MSG_COLS} ${MSG_FROM}
          WHERE ${where}
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT $${params.length}`,
        params,
      );
      return { messages: await this.buildMessages(client, res.rows, userId) };
    });
  }

  async getThread(
    workspaceId: string,
    userId: string,
    role: Role,
    messageId: string,
  ) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const parentRes = await client.query(
        `SELECT ${MSG_COLS}, m.channel_id ${MSG_FROM} WHERE m.id = $1`,
        [messageId],
      );
      if (!parentRes.rows[0]) throw new NotFoundException("Message not found");
      const parent = parentRes.rows[0];
      // Threads root at the top-level message; a reply id resolves to its root.
      const rootId = (parent.parent_message_id as string | null) ?? messageId;
      await this.requireChannelMember(
        client,
        parent.channel_id as string,
        userId,
      );
      const rootRes = await client.query(
        `SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.id = $1`,
        [rootId],
      );
      const repliesRes = await client.query(
        `SELECT ${MSG_COLS} ${MSG_FROM}
          WHERE m.parent_message_id = $1
          ORDER BY m.created_at, m.id`,
        [rootId],
      );
      const [parentOut] = await this.buildMessages(
        client,
        rootRes.rows,
        userId,
      );
      const replies = await this.buildMessages(
        client,
        repliesRes.rows,
        userId,
      );
      return { parent: parentOut, replies };
    });
  }

  async createMessage(
    workspaceId: string,
    userId: string,
    role: Role,
    channelId: string,
    input: { body?: string; parentMessageId?: string },
  ) {
    this.requireChatMember(role);
    const body = requireName(input?.body, "body");
    const notified: string[] = [];
    const message = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const channel = await this.channelRow(client, channelId);
        await this.requireChannelMember(client, channelId, userId);

        // Replies attach to a top-level message of the SAME channel; a reply
        // to a reply reparents onto the thread root (one level of nesting).
        let parentMessageId: string | null = null;
        if (
          input?.parentMessageId !== undefined &&
          input.parentMessageId !== null
        ) {
          const pid = requireUuid(input.parentMessageId, "parentMessageId");
          const p = await client.query(
            `SELECT id, channel_id, parent_message_id FROM messages WHERE id = $1`,
            [pid],
          );
          if (!p.rows[0] || (p.rows[0].channel_id as string) !== channelId) {
            throw new BadRequestException(
              "parentMessageId must reference a message in this channel",
            );
          }
          parentMessageId =
            (p.rows[0].parent_message_id as string | null) ??
            (p.rows[0].id as string);
        }

        const ins = await client.query(
          `INSERT INTO messages
             (workspace_id, channel_id, parent_message_id, author_user_id, body)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [workspaceId, channelId, parentMessageId, userId, body],
        );
        const messageId = ins.rows[0].id as string;

        // --- Notification fan-out (each recipient at most once) -------------
        const seen = new Set<string>([userId]);

        // @mentions -> 'chat' for mentioned members who are in the channel.
        const mentionIds = [
          ...new Set(
            [...body.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()),
          ),
        ];
        const mentionMembers = await this.channelMemberIds(
          client,
          channelId,
          mentionIds,
        );
        for (const uid of mentionIds) {
          if (seen.has(uid) || !mentionMembers.has(uid)) continue;
          seen.add(uid);
          await insertNotification(client, {
            workspaceId,
            userId: uid,
            kind: "chat",
            actorUserId: userId,
            message: "mentioned you in a message",
          });
          notified.push(uid);
        }

        // In a DM, notify the other participant regardless of mentions.
        if (channel.is_dm as boolean) {
          const others = await client.query(
            `SELECT user_id FROM channel_members
              WHERE channel_id = $1 AND user_id <> $2`,
            [channelId, userId],
          );
          for (const r of others.rows) {
            const uid = r.user_id as string;
            if (seen.has(uid)) continue;
            seen.add(uid);
            await insertNotification(client, {
              workspaceId,
              userId: uid,
              kind: "chat",
              actorUserId: userId,
              message: "sent you a message",
            });
            notified.push(uid);
          }
        }

        // The author has, by definition, read their own message.
        await client.query(
          `UPDATE channel_members SET last_read_at = now()
            WHERE channel_id = $1 AND user_id = $2`,
          [channelId, userId],
        );

        const row = await client.query(
          `SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.id = $1`,
          [messageId],
        );
        const [out] = await this.buildMessages(client, row.rows, userId);
        return out;
      },
    );

    this.events.publish(workspaceId, {
      type: "chat.message",
      payload: { channelId },
    });
    for (const uid of notified) {
      this.events.publish(workspaceId, {
        type: "notification.new",
        payload: { userId: uid },
      });
    }
    return { message };
  }

  async updateMessage(
    workspaceId: string,
    userId: string,
    role: Role,
    messageId: string,
    input: { body?: string },
  ) {
    this.requireChatMember(role);
    const body = requireName(input?.body, "body");
    let channelId = "";
    const message = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const res = await client.query(
          `SELECT id, channel_id, author_user_id FROM messages WHERE id = $1`,
          [messageId],
        );
        if (!res.rows[0]) throw new NotFoundException("Message not found");
        channelId = res.rows[0].channel_id as string;
        if ((res.rows[0].author_user_id as string) !== userId) {
          throw new ForbiddenException("Only the author can edit a message");
        }
        await client.query(
          `UPDATE messages SET body = $1, edited_at = now() WHERE id = $2`,
          [body, messageId],
        );
        const row = await client.query(
          `SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.id = $1`,
          [messageId],
        );
        const [out] = await this.buildMessages(client, row.rows, userId);
        return out;
      },
    );
    this.events.publish(workspaceId, {
      type: "chat.message",
      payload: { channelId },
    });
    return { message };
  }

  async deleteMessage(
    workspaceId: string,
    userId: string,
    role: Role,
    messageId: string,
  ): Promise<void> {
    this.requireChatMember(role);
    let channelId = "";
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, channel_id, author_user_id FROM messages WHERE id = $1`,
        [messageId],
      );
      if (!res.rows[0]) throw new NotFoundException("Message not found");
      channelId = res.rows[0].channel_id as string;
      const isAuthor = (res.rows[0].author_user_id as string) === userId;
      // Delete-any needs workspace admin power (admin or owner).
      if (!isAuthor && !roleAtLeast(role, "admin")) {
        throw new ForbiddenException("You cannot delete this message");
      }
      // FK ON DELETE CASCADE removes replies + reactions with the parent.
      await client.query(`DELETE FROM messages WHERE id = $1`, [messageId]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "message.deleted",
        entity: "message",
        entityId: messageId,
        data: { channelId },
      });
    });
    this.events.publish(workspaceId, {
      type: "chat.message",
      payload: { channelId },
    });
  }

  async toggleReaction(
    workspaceId: string,
    userId: string,
    role: Role,
    messageId: string,
    input: { emoji?: string },
  ) {
    this.requireChatMember(role);
    const emoji = requireName(input?.emoji, "emoji");
    let channelId = "";
    const reactions = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const res = await client.query(
          `SELECT id, channel_id FROM messages WHERE id = $1`,
          [messageId],
        );
        if (!res.rows[0]) throw new NotFoundException("Message not found");
        channelId = res.rows[0].channel_id as string;
        await this.requireChannelMember(client, channelId, userId);

        const existing = await client.query(
          `SELECT 1 FROM message_reactions
            WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
          [messageId, userId, emoji],
        );
        if (existing.rows[0]) {
          await client.query(
            `DELETE FROM message_reactions
              WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
            [messageId, userId, emoji],
          );
        } else {
          await client.query(
            `INSERT INTO message_reactions
               (workspace_id, message_id, user_id, emoji)
             VALUES ($1, $2, $3, $4)`,
            [workspaceId, messageId, userId, emoji],
          );
        }
        const { reactions: map } = await this.decorate(
          client,
          [messageId],
          userId,
        );
        return map.get(messageId) ?? [];
      },
    );
    this.events.publish(workspaceId, {
      type: "chat.message",
      payload: { channelId },
    });
    return { reactions };
  }

  // --- SyncUps --------------------------------------------------------------

  async startSyncup(
    workspaceId: string,
    userId: string,
    role: Role,
    channelId: string,
  ) {
    this.requireChatMember(role);
    const syncup = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        await this.channelRow(client, channelId);
        await this.requireChannelMember(client, channelId, userId);
        // One active huddle per channel: return the existing one if present.
        const active = await client.query(
          `SELECT id, started_by, started_at FROM syncups
            WHERE channel_id = $1 AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1`,
          [channelId],
        );
        if (active.rows[0]) {
          return {
            id: active.rows[0].id as string,
            startedBy: active.rows[0].started_by as string,
            startedAt: iso(active.rows[0].started_at)!,
          };
        }
        const ins = await client.query(
          `INSERT INTO syncups (workspace_id, channel_id, started_by)
           VALUES ($1, $2, $3) RETURNING id, started_by, started_at`,
          [workspaceId, channelId, userId],
        );
        return {
          id: ins.rows[0].id as string,
          startedBy: ins.rows[0].started_by as string,
          startedAt: iso(ins.rows[0].started_at)!,
        };
      },
    );
    this.events.publish(workspaceId, {
      type: "chat.message",
      payload: { channelId },
    });
    return { syncup };
  }

  async endSyncup(
    workspaceId: string,
    userId: string,
    role: Role,
    syncupId: string,
  ) {
    this.requireChatMember(role);
    let channelId = "";
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, channel_id, ended_at FROM syncups WHERE id = $1`,
        [syncupId],
      );
      if (!res.rows[0]) throw new NotFoundException("SyncUp not found");
      channelId = res.rows[0].channel_id as string;
      // A participant (channel member) or a workspace admin may end it.
      const isMember = await client.query(
        `SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2`,
        [channelId, userId],
      );
      if (!isMember.rows[0] && !roleAtLeast(role, "admin")) {
        throw new ForbiddenException("You cannot end this SyncUp");
      }
      if (!res.rows[0].ended_at) {
        await client.query(
          `UPDATE syncups SET ended_at = now() WHERE id = $1`,
          [syncupId],
        );
      }
    });
    this.events.publish(workspaceId, {
      type: "chat.message",
      payload: { channelId },
    });
    return { ok: true };
  }

  async getSyncup(
    workspaceId: string,
    userId: string,
    role: Role,
    channelId: string,
  ) {
    this.requireChatMember(role);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.channelRow(client, channelId);
      await this.requireChannelMember(client, channelId, userId);
      const res = await client.query(
        `SELECT s.id, s.started_at,
                u.id AS a_id, u.full_name AS a_full_name,
                u.avatar_url AS a_avatar_url
           FROM syncups s
           LEFT JOIN users u ON u.id = s.started_by
          WHERE s.channel_id = $1 AND s.ended_at IS NULL
          ORDER BY s.started_at DESC LIMIT 1`,
        [channelId],
      );
      if (!res.rows[0]) return { active: null };
      const r = res.rows[0];
      return {
        active: {
          id: r.id as string,
          startedBy: r.a_id ? this.userRef(r) : null,
          startedAt: iso(r.started_at)!,
        },
      };
    });
  }

  // --- Task email -----------------------------------------------------------

  private async taskCtx(
    client: PoolClient,
    taskId: string,
  ): Promise<{ spaceId: string }> {
    const res = await client.query(
      `SELECT space_id FROM tasks WHERE id = $1`,
      [taskId],
    );
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    return { spaceId: res.rows[0].space_id as string };
  }

  private emailOut(r: Record<string, unknown>) {
    return {
      id: r.id as string,
      direction: r.direction as string,
      fromAddr: r.from_addr as string,
      toAddr: r.to_addr as string,
      subject: r.subject as string,
      body: r.body as string,
      createdAt: iso(r.created_at)!,
    };
  }

  async composeEmail(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    input: { to?: string; subject?: string; body?: string },
  ) {
    const to = requireName(input?.to, "to");
    const subject = requireName(input?.subject, "subject");
    const body = requireName(input?.body, "body");
    const email = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const { spaceId } = await this.taskCtx(client, taskId);
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
        // Sender is the composing user's email (a workspace-ish from address).
        const u = await client.query(
          `SELECT email FROM users WHERE id = $1`,
          [userId],
        );
        const fromAddr = (u.rows[0]?.email as string) ?? "";
        const ins = await client.query(
          `INSERT INTO task_emails
             (workspace_id, task_id, direction, from_addr, to_addr, subject,
              body, sent_by)
           VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7)
           RETURNING id, direction, from_addr, to_addr, subject, body, created_at`,
          [workspaceId, taskId, fromAddr, to, subject, body, userId],
        );
        // NOTE: real delivery is a pluggable SMTP adapter (disabled by
        // default); an adapter would send the message here. We only log it.
        await recordActivity(client, {
          workspaceId,
          taskId,
          actorUserId: userId,
          kind: "email",
          data: { to, subject },
        });
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "task.email.sent",
          entity: "task_email",
          entityId: ins.rows[0].id as string,
          data: { taskId, to, subject },
        });
        return this.emailOut(ins.rows[0]);
      },
    );
    // M22: attempt real delivery through the pluggable provider (a no-op
    // logger by default). Delivery is best-effort — a failure never undoes the
    // logged task_email above; the outcome is returned for the UI.
    const delivery = await this.email.send({ to, subject, text: body });
    this.events.publish(workspaceId, {
      type: "task.changed",
      payload: { taskId },
    });
    return { email, delivery };
  }

  async listEmails(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
  ) {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { spaceId } = await this.taskCtx(client, taskId);
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT id, direction, from_addr, to_addr, subject, body, created_at
           FROM task_emails WHERE task_id = $1
          ORDER BY created_at, id`,
        [taskId],
      );
      return { emails: res.rows.map((r) => this.emailOut(r)) };
    });
  }
}
