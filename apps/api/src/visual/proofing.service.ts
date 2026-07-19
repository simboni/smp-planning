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
import { requireName } from "../tasks/tasks.support";
import {
  FileCtx,
  UserRef,
  iso,
  requireFileVisible,
  userRef,
} from "./visual.support";

export interface AnnotationOut {
  id: string;
  x: number;
  y: number;
  body: string;
  author: UserRef;
  resolvedAt: string | null;
  createdAt: string;
}

const ANNOTATION_SQL = `
  SELECT a.id, a.file_id, a.author_user_id, a.x, a.y, a.body, a.resolved_at,
         a.created_at,
         u.id AS u_id, u.full_name AS u_full_name, u.avatar_url AS u_avatar_url
  FROM proof_annotations a
  JOIN users u ON u.id = a.author_user_id`;

/** A pin position must be a 0..1 fraction of the rendered file. */
function validCoord(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new BadRequestException(`${label} must be a number between 0 and 1`);
  }
  return v;
}

/**
 * Module 12: Proofing — pinned annotations on a file. Access rides on the
 * file (task's space visible to read; >= 'comment' to annotate, matching
 * comments). Authors own their text; resolving takes author or space-edit;
 * deleting takes author or space-admin power. Creating an annotation
 * notifies the task's assignees + watchers (minus the author).
 */
@Injectable()
export class ProofingService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private toAnnotation(r: Record<string, unknown>): AnnotationOut {
    return {
      id: r.id as string,
      x: Number(r.x),
      y: Number(r.y),
      body: r.body as string,
      author: userRef(r),
      resolvedAt: iso(r.resolved_at),
      createdAt: iso(r.created_at)!,
    };
  }

  private async annotationRow(
    client: PoolClient,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(`${ANNOTATION_SQL} WHERE a.id = $1`, [id]);
    if (!res.rows[0]) throw new NotFoundException("Annotation not found");
    return res.rows[0];
  }

  async listAnnotations(
    workspaceId: string,
    userId: string,
    role: Role,
    fileId: string,
  ): Promise<AnnotationOut[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireFileVisible(this.access, client, userId, role, fileId);
      const res = await client.query(
        `${ANNOTATION_SQL} WHERE a.file_id = $1 ORDER BY a.created_at, a.id`,
        [fileId],
      );
      return res.rows.map((r) => this.toAnnotation(r));
    });
  }

  async createAnnotation(
    workspaceId: string,
    userId: string,
    role: Role,
    fileId: string,
    input: { x?: number; y?: number; body?: string },
  ): Promise<AnnotationOut> {
    const x = validCoord(input?.x, "x");
    const y = validCoord(input?.y, "y");
    const body = requireName(input?.body, "body");

    const notified: string[] = [];
    const annotation = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const file = await requireFileVisible(
          this.access,
          client,
          userId,
          role,
          fileId,
        );
        // Same bar as posting a comment: >= 'comment' on the space.
        if (!permAtLeast(file.perm, "comment")) {
          throw new ForbiddenException(
            "You need comment access to annotate this file",
          );
        }

        const ins = await client.query(
          `INSERT INTO proof_annotations
             (workspace_id, file_id, author_user_id, x, y, body)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [workspaceId, fileId, userId, x, y, body],
        );
        const annotationId = ins.rows[0].id as string;

        // Task assignees + watchers hear about new annotations (not the author).
        if (file.taskId) {
          const followers = await client.query(
            `SELECT user_id FROM task_assignees WHERE task_id = $1
             UNION
             SELECT user_id FROM task_watchers WHERE task_id = $1`,
            [file.taskId],
          );
          for (const r of followers.rows) {
            const uid = r.user_id as string;
            if (uid === userId || notified.includes(uid)) continue;
            await insertNotification(client, {
              workspaceId,
              userId: uid,
              kind: "comment",
              taskId: file.taskId,
              actorUserId: userId,
              message: `annotated ${file.name}`,
            });
            notified.push(uid);
          }
        }

        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "annotation.created",
          entity: "annotation",
          entityId: annotationId,
          data: { fileId, taskId: file.taskId },
        });
        return this.toAnnotation(await this.annotationRow(client, annotationId));
      },
    );

    for (const uid of notified) {
      this.events.publish(workspaceId, {
        type: "notification.new",
        payload: { userId: uid },
      });
    }
    return annotation;
  }

  async updateAnnotation(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    input: { body?: string; resolved?: boolean },
  ): Promise<AnnotationOut> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.annotationRow(client, id);
      const file = await requireFileVisible(
        this.access,
        client,
        userId,
        role,
        existing.file_id as string,
      );
      const isAuthor = (existing.author_user_id as string) === userId;

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      if (input?.body !== undefined) {
        if (!isAuthor) {
          throw new ForbiddenException("Only the author can edit an annotation");
        }
        sets.push(`body = $${i++}`);
        params.push(requireName(input.body, "body"));
      }

      if (input?.resolved !== undefined) {
        if (typeof input.resolved !== "boolean") {
          throw new BadRequestException("resolved must be a boolean");
        }
        if (!isAuthor && !permAtLeast(file.perm, "edit")) {
          throw new ForbiddenException(
            "Only the author or an editor can resolve an annotation",
          );
        }
        sets.push(`resolved_at = ${input.resolved ? "now()" : "NULL"}`);
      }

      if (sets.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE proof_annotations SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      return this.toAnnotation(await this.annotationRow(client, id));
    });
  }

  /** Delete: author, or space-admin power (a 'full' share / admin / owner). */
  async deleteAnnotation(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.annotationRow(client, id);
      const file: FileCtx = await requireFileVisible(
        this.access,
        client,
        userId,
        role,
        existing.file_id as string,
      );
      const isAuthor = (existing.author_user_id as string) === userId;
      if (!isAuthor && !this.access.canManageSpace(file.perm, role)) {
        throw new ForbiddenException("You cannot delete this annotation");
      }
      await client.query(`DELETE FROM proof_annotations WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "annotation.deleted",
        entity: "annotation",
        entityId: id,
        data: { fileId: file.id },
      });
    });
  }
}
