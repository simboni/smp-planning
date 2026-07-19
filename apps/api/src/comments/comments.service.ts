import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService, permAtLeast } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { EventsService } from "../events/events.service";
import { insertNotification } from "../inbox/inbox.support";
import {
  recordActivity,
  requireName,
  requireSpaceComment,
  requireSpaceVisible,
  requireUuid,
} from "../tasks/tasks.support";

interface UserRef {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface CommentOut {
  id: string;
  taskId: string;
  parentCommentId: string | null;
  author: UserRef;
  body: string;
  assignee: UserRef | null;
  resolvedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  replies?: CommentOut[];
}

/** Mention tokens the client inserts into a comment body: `@[<uuid>]`. */
const MENTION_RE =
  /@\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

const COMMENT_COLS = `
  c.id, c.task_id, c.parent_comment_id, c.body, c.resolved_at, c.edited_at,
  c.created_at,
  a.id AS a_id, a.full_name AS a_full_name, a.avatar_url AS a_avatar_url,
  s.id AS s_id, s.full_name AS s_full_name, s.avatar_url AS s_avatar_url`;

const COMMENT_FROM = `FROM comments c
  JOIN users a ON a.id = c.author_user_id
  LEFT JOIN users s ON s.id = c.assignee_user_id`;

/**
 * Module 6: threaded task comments with @mentions, assigned (action-item)
 * comments and resolution. Reading needs the owning space visible; WRITING
 * needs the 'comment' permission or higher (edit/full imply comment), so a
 * view-only share can read the thread but never post. Authors own their
 * text: only the author edits a body; deletes are author-or-admin ('full'
 * share, admin or owner role). Every mutation records task activity,
 * fans out inbox notifications and publishes realtime hints.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  // --- helpers --------------------------------------------------------------

  private async taskCtx(
    client: PoolClient,
    taskId: string,
  ): Promise<{ spaceId: string; listId: string; name: string }> {
    const res = await client.query(
      `SELECT space_id, list_id, name FROM tasks WHERE id = $1`,
      [taskId],
    );
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    return {
      spaceId: res.rows[0].space_id as string,
      listId: res.rows[0].list_id as string,
      name: res.rows[0].name as string,
    };
  }

  private commentOut(r: Record<string, unknown>): CommentOut {
    return {
      id: r.id as string,
      taskId: r.task_id as string,
      parentCommentId: (r.parent_comment_id as string | null) ?? null,
      author: {
        id: r.a_id as string,
        fullName: r.a_full_name as string,
        avatarUrl: (r.a_avatar_url as string | null) ?? null,
      },
      body: r.body as string,
      assignee: r.s_id
        ? {
            id: r.s_id as string,
            fullName: r.s_full_name as string,
            avatarUrl: (r.s_avatar_url as string | null) ?? null,
          }
        : null,
      resolvedAt: iso(r.resolved_at),
      editedAt: iso(r.edited_at),
      createdAt: iso(r.created_at)!,
    };
  }

  private async commentRow(
    client: PoolClient,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(
      `SELECT ${COMMENT_COLS}, c.author_user_id, c.assignee_user_id
       ${COMMENT_FROM} WHERE c.id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException("Comment not found");
    return res.rows[0];
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

  // --- Reads ----------------------------------------------------------------

  async listComments(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
  ): Promise<CommentOut[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { spaceId } = await this.taskCtx(client, taskId);
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT ${COMMENT_COLS} ${COMMENT_FROM}
         WHERE c.task_id = $1
         ORDER BY c.created_at, c.id`,
        [taskId],
      );
      // One level of nesting: top-level comments oldest->newest, each with
      // its replies chronologically.
      const top: CommentOut[] = [];
      const byId = new Map<string, CommentOut>();
      for (const r of res.rows) {
        const out = this.commentOut(r);
        if (!out.parentCommentId) {
          out.replies = [];
          byId.set(out.id, out);
          top.push(out);
        }
      }
      for (const r of res.rows) {
        const parentId = r.parent_comment_id as string | null;
        if (parentId) byId.get(parentId)?.replies!.push(this.commentOut(r));
      }
      return top;
    });
  }

  // --- Create ---------------------------------------------------------------

  async createComment(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    input: { body?: string; parentCommentId?: string; assigneeUserId?: string },
  ): Promise<CommentOut> {
    const body = requireName(input?.body, "body");
    const notified: string[] = [];
    const comment = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const task = await this.taskCtx(client, taskId);
        await requireSpaceComment(this.access, client, userId, role, task.spaceId);

        // Replies attach to a comment of the SAME task; a reply to a reply is
        // reparented onto the thread root (one level of nesting, ClickUp-style).
        let parentCommentId: string | null = null;
        if (input?.parentCommentId !== undefined && input.parentCommentId !== null) {
          const pid = requireUuid(input.parentCommentId, "parentCommentId");
          const p = await client.query(
            `SELECT id, task_id, parent_comment_id FROM comments WHERE id = $1`,
            [pid],
          );
          if (!p.rows[0] || (p.rows[0].task_id as string) !== taskId) {
            throw new BadRequestException(
              "parentCommentId must reference a comment on this task",
            );
          }
          parentCommentId =
            (p.rows[0].parent_comment_id as string | null) ??
            (p.rows[0].id as string);
        }

        let assigneeUserId: string | null = null;
        if (input?.assigneeUserId !== undefined && input.assigneeUserId !== null) {
          const aid = requireUuid(input.assigneeUserId, "assigneeUserId");
          const members = await this.memberIds(client, [aid]);
          if (!members.has(aid)) {
            throw new BadRequestException(
              "assigneeUserId must be a member of this workspace",
            );
          }
          assigneeUserId = aid;
        }

        const ins = await client.query(
          `INSERT INTO comments
             (workspace_id, task_id, parent_comment_id, author_user_id, body,
              assignee_user_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [workspaceId, taskId, parentCommentId, userId, body, assigneeUserId],
        );
        const commentId = ins.rows[0].id as string;

        // --- Notification fan-out (each recipient at most once) -------------
        const seen = new Set<string>([userId]);

        // @mentions -> 'mention' for each mentioned workspace member.
        const mentionIds = [
          ...new Set(
            [...body.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()),
          ),
        ];
        const mentionMembers = await this.memberIds(client, mentionIds);
        for (const uid of mentionIds) {
          if (seen.has(uid) || !mentionMembers.has(uid)) continue;
          seen.add(uid);
          await insertNotification(client, {
            workspaceId,
            userId: uid,
            kind: "mention",
            taskId,
            commentId,
            actorUserId: userId,
            message: "mentioned you in a comment",
          });
          notified.push(uid);
        }

        // Assigned comment -> 'assigned' for the comment's assignee.
        if (assigneeUserId && !seen.has(assigneeUserId)) {
          seen.add(assigneeUserId);
          await insertNotification(client, {
            workspaceId,
            userId: assigneeUserId,
            kind: "assigned",
            taskId,
            commentId,
            actorUserId: userId,
            message: "assigned you a comment",
          });
          notified.push(assigneeUserId);
        }

        // Task assignees + watchers -> 'comment' (minus author + already hit).
        const followers = await client.query(
          `SELECT user_id FROM task_assignees WHERE task_id = $1
           UNION
           SELECT user_id FROM task_watchers WHERE task_id = $1`,
          [taskId],
        );
        for (const r of followers.rows) {
          const uid = r.user_id as string;
          if (seen.has(uid)) continue;
          seen.add(uid);
          await insertNotification(client, {
            workspaceId,
            userId: uid,
            kind: "comment",
            taskId,
            commentId,
            actorUserId: userId,
            message: "commented on a task",
          });
          notified.push(uid);
        }

        await recordActivity(client, {
          workspaceId,
          taskId,
          actorUserId: userId,
          kind: "comment",
          data: { commentId },
        });
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "comment.created",
          entity: "comment",
          entityId: commentId,
          data: { taskId, parentCommentId, assigneeUserId },
        });

        const row = await this.commentRow(client, commentId);
        return this.commentOut(row);
      },
    );

    this.events.publish(workspaceId, {
      type: "comment.changed",
      payload: { taskId },
    });
    for (const uid of notified) {
      this.events.publish(workspaceId, {
        type: "notification.new",
        payload: { userId: uid },
      });
    }
    return comment;
  }

  // --- Update ---------------------------------------------------------------

  async updateComment(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    input: {
      body?: string;
      assigneeUserId?: string | null;
      resolved?: boolean;
    },
  ): Promise<CommentOut> {
    const notified: string[] = [];
    let taskId = "";
    const comment = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const existing = await this.commentRow(client, id);
        taskId = existing.task_id as string;
        const task = await this.taskCtx(client, taskId);
        const perm = await requireSpaceVisible(
          this.access,
          client,
          userId,
          role,
          task.spaceId,
        );
        const isAuthor = (existing.author_user_id as string) === userId;
        const isAssignee = (existing.assignee_user_id as string | null) === userId;
        const canEditSpace = permAtLeast(perm, "edit");

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;

        if (input?.body !== undefined) {
          if (!isAuthor) {
            throw new ForbiddenException("Only the author can edit a comment");
          }
          const body = requireName(input.body, "body");
          sets.push(`body = $${i++}`, `edited_at = now()`);
          params.push(body);
        }

        if (input?.assigneeUserId !== undefined) {
          if (!isAuthor && !canEditSpace) {
            throw new ForbiddenException(
              "You cannot reassign this comment",
            );
          }
          if (input.assigneeUserId === null) {
            sets.push(`assignee_user_id = NULL`);
          } else {
            const aid = requireUuid(input.assigneeUserId, "assigneeUserId");
            const members = await this.memberIds(client, [aid]);
            if (!members.has(aid)) {
              throw new BadRequestException(
                "assigneeUserId must be a member of this workspace",
              );
            }
            sets.push(`assignee_user_id = $${i++}`);
            params.push(aid);
            if (
              aid !== userId &&
              aid !== (existing.assignee_user_id as string | null)
            ) {
              await insertNotification(client, {
                workspaceId,
                userId: aid,
                kind: "assigned",
                taskId,
                commentId: id,
                actorUserId: userId,
                message: "assigned you a comment",
              });
              notified.push(aid);
            }
          }
        }

        if (input?.resolved !== undefined) {
          if (typeof input.resolved !== "boolean") {
            throw new BadRequestException("resolved must be a boolean");
          }
          if (!isAuthor && !isAssignee && !canEditSpace) {
            throw new ForbiddenException(
              "Only the assignee, the author or an editor can resolve a comment",
            );
          }
          sets.push(`resolved_at = ${input.resolved ? "now()" : "NULL"}`);
        }

        if (sets.length > 0) {
          params.push(id);
          await client.query(
            `UPDATE comments SET ${sets.join(", ")} WHERE id = $${i}`,
            params,
          );
        }

        const row = await this.commentRow(client, id);
        return this.commentOut(row);
      },
    );

    this.events.publish(workspaceId, {
      type: "comment.changed",
      payload: { taskId },
    });
    for (const uid of notified) {
      this.events.publish(workspaceId, {
        type: "notification.new",
        payload: { userId: uid },
      });
    }
    return comment;
  }

  // --- Delete ---------------------------------------------------------------

  async deleteComment(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    let taskId = "";
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.commentRow(client, id);
      taskId = existing.task_id as string;
      const task = await this.taskCtx(client, taskId);
      const perm = await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        task.spaceId,
      );
      const isAuthor = (existing.author_user_id as string) === userId;
      // Delete-any needs space admin power: a 'full' share or admin/owner role.
      if (!isAuthor && !this.access.canManageSpace(perm, role)) {
        throw new ForbiddenException("You cannot delete this comment");
      }
      // FK ON DELETE CASCADE removes replies with the parent.
      await client.query(`DELETE FROM comments WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "comment.deleted",
        entity: "comment",
        entityId: id,
        data: { taskId },
      });
    });
    this.events.publish(workspaceId, {
      type: "comment.changed",
      payload: { taskId },
    });
  }
}
