import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { EventsService } from "../events/events.service";
import { LimitsService } from "../limits/limits.service";
import {
  recordActivity,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
} from "../tasks/tasks.support";
import {
  UserRef,
  decodeBase64File,
  iso,
  requireFileVisible,
  userRef,
  validMime,
} from "./visual.support";

export interface FileOut {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  isClip: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface FileListItem {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  isClip: boolean;
  author: UserRef | null;
  createdAt: string;
  annotationCount: number;
}

/** What the raw-download route needs to build its response. */
export interface RawFile {
  name: string;
  mime: string;
  data: Buffer;
}

/**
 * Module 12: task attachments (and clips — a clip is a video attachment).
 * Files live IN Postgres (bytea, 5MB cap); uploads arrive as base64 JSON so
 * the stack stays dependency-free. Uploading needs EDIT on the task's space,
 * reading needs the space visible; a file with no task is creator-only.
 * Deletes are uploader-or-workspace-admin (plus space edit).
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly limits: LimitsService,
  ) {}

  private async taskCtx(
    client: PoolClient,
    taskId: string,
  ): Promise<{ spaceId: string; listId: string }> {
    const res = await client.query(
      `SELECT space_id, list_id FROM tasks WHERE id = $1`,
      [taskId],
    );
    if (!res.rows[0]) throw new NotFoundException("Task not found");
    return {
      spaceId: res.rows[0].space_id as string,
      listId: res.rows[0].list_id as string,
    };
  }

  async upload(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    body: { name?: string; mime?: string; dataBase64?: string; isClip?: boolean },
  ): Promise<FileOut> {
    const name = requireName(body?.name);
    const mime = validMime(body?.mime);
    const data = decodeBase64File(body?.dataBase64);
    const isClip = body?.isClip === true;

    let listId = "";
    const file = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const task = await this.taskCtx(client, taskId);
        listId = task.listId;
        await requireSpaceEdit(this.access, client, userId, role, task.spaceId);
        // M20: enforce the workspace storage cap before writing the bytes.
        await this.limits.assertStorageAvailable(client, workspaceId, data.length);

        const ins = await client.query(
          `INSERT INTO files
             (workspace_id, task_id, name, mime, size_bytes, data, is_clip,
              created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, created_at`,
          [workspaceId, taskId, name, mime, data.length, data, isClip, userId],
        );
        const fileId = ins.rows[0].id as string;

        await recordActivity(client, {
          workspaceId,
          taskId,
          actorUserId: userId,
          kind: "attachment",
          data: { fileId, name },
        });
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "file.uploaded",
          entity: "file",
          entityId: fileId,
          data: { taskId, name, mime, sizeBytes: data.length, isClip },
        });
        return {
          id: fileId,
          name,
          mime,
          sizeBytes: data.length,
          isClip,
          createdBy: userId,
          createdAt: iso(ins.rows[0].created_at)!,
        };
      },
    );

    this.events.publish(workspaceId, {
      type: "task.changed",
      payload: { taskId, listId },
    });
    return file;
  }

  /** A task's files, oldest first, with batched annotation counts. */
  async listTaskFiles(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
  ): Promise<FileListItem[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { spaceId } = await this.taskCtx(client, taskId);
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT f.id, f.name, f.mime, f.size_bytes, f.is_clip, f.created_at,
                u.id AS u_id, u.full_name AS u_full_name,
                u.avatar_url AS u_avatar_url,
                COALESCE(a.n, 0) AS annotation_count
         FROM files f
         LEFT JOIN users u ON u.id = f.created_by
         LEFT JOIN (SELECT file_id, COUNT(*)::int AS n
                    FROM proof_annotations GROUP BY file_id) a
           ON a.file_id = f.id
         WHERE f.task_id = $1
         ORDER BY f.created_at, f.id`,
        [taskId],
      );
      return res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        mime: r.mime as string,
        sizeBytes: r.size_bytes as number,
        isClip: r.is_clip as boolean,
        author: r.u_id ? userRef(r) : null,
        createdAt: iso(r.created_at)!,
        annotationCount: r.annotation_count as number,
      }));
    });
  }

  /** The raw bytes for streaming (visibility enforced like any file read). */
  async getRaw(
    workspaceId: string,
    userId: string,
    role: Role,
    fileId: string,
  ): Promise<RawFile> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const file = await requireFileVisible(
        this.access,
        client,
        userId,
        role,
        fileId,
      );
      const res = await client.query(`SELECT data FROM files WHERE id = $1`, [
        fileId,
      ]);
      return {
        name: file.name,
        mime: file.mime,
        data: res.rows[0].data as Buffer,
      };
    });
  }

  /** Delete: uploader or workspace admin/owner, with edit on the space. */
  async deleteFile(
    workspaceId: string,
    userId: string,
    role: Role,
    fileId: string,
  ): Promise<void> {
    let taskId: string | null = null;
    let listId: string | null = null;
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const file = await requireFileVisible(
        this.access,
        client,
        userId,
        role,
        fileId,
      );
      if (file.taskId !== null) {
        await requireSpaceEdit(this.access, client, userId, role, file.spaceId!);
      }
      const isAdmin = role === "owner" || role === "admin";
      if (file.createdBy !== userId && !isAdmin) {
        throw new ForbiddenException(
          "Only the uploader or a workspace admin can delete a file",
        );
      }
      taskId = file.taskId;
      listId = file.listId;
      // proof_annotations cascade with the file.
      await client.query(`DELETE FROM files WHERE id = $1`, [fileId]);
      if (taskId) {
        await recordActivity(client, {
          workspaceId,
          taskId,
          actorUserId: userId,
          kind: "attachment_removed",
          data: { fileId, name: file.name },
        });
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "file.deleted",
        entity: "file",
        entityId: fileId,
        data: { taskId, name: file.name },
      });
    });
    if (taskId) {
      this.events.publish(workspaceId, {
        type: "task.changed",
        payload: { taskId, listId },
      });
    }
  }
}
