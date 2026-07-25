import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService, Permission } from "../access/access.service";
import { requireSpaceVisible } from "../tasks/tasks.support";

/**
 * Shared building blocks for Module 12 (files, proofing, whiteboards,
 * mind maps): the file-access resolver both the files and proofing services
 * funnel through, plus payload decoding/size validators.
 */

/** 5MB decoded cap for uploaded files (matches 0013_visual.sql's intent). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Whiteboard `elements` jsonb cap (serialized). */
export const MAX_ELEMENTS_BYTES = 512 * 1024;
/** Mind map `root` jsonb cap (serialized). */
export const MAX_ROOT_BYTES = 256 * 1024;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_RE = /^[-\w.+]{1,127}\/[-\w.+*]{1,127}$/;

export function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export interface UserRef {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export function userRef(r: Record<string, unknown>, prefix = "u_"): UserRef {
  return {
    id: r[`${prefix}id`] as string,
    fullName: r[`${prefix}full_name`] as string,
    avatarUrl: (r[`${prefix}avatar_url`] as string | null) ?? null,
  };
}

/** Validate a mime type string like "image/png". */
export function validMime(v: unknown): string {
  if (typeof v !== "string" || !MIME_RE.test(v.trim())) {
    throw new BadRequestException("mime must be a type like image/png");
  }
  return v.trim();
}

/**
 * Decode a base64 upload body. Rejects malformed base64 (400) and anything
 * decoding past MAX_FILE_BYTES (413) — the length pre-check refuses obviously
 * oversized payloads before allocating the buffer.
 */
export function decodeBase64File(v: unknown): Buffer {
  if (typeof v !== "string" || v.length === 0) {
    throw new BadRequestException("dataBase64 is required");
  }
  if (!BASE64_RE.test(v) || v.length % 4 !== 0) {
    throw new BadRequestException("dataBase64 must be valid base64");
  }
  // ceil(cap/3)*4 is the longest base64 that can decode within the cap.
  if (v.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
    throw new PayloadTooLargeException("File exceeds the 5MB limit");
  }
  const buf = Buffer.from(v, "base64");
  if (buf.length === 0) {
    throw new BadRequestException("dataBase64 decodes to an empty file");
  }
  if (buf.length > MAX_FILE_BYTES) {
    throw new PayloadTooLargeException("File exceeds the 5MB limit");
  }
  return buf;
}

/** Serialize a jsonb payload, enforcing a byte cap (413 when over). */
export function serializeCapped(
  value: unknown,
  maxBytes: number,
  label: string,
): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    throw new PayloadTooLargeException(
      `${label} exceeds the ${Math.floor(maxBytes / 1024)}KB limit`,
    );
  }
  return json;
}

/** A file row + its task context and the caller's resolved permission. */
export interface FileCtx {
  id: string;
  taskId: string | null;
  listId: string | null;
  spaceId: string | null;
  taskName: string | null;
  name: string;
  mime: string;
  sizeBytes: number;
  isClip: boolean;
  createdBy: string | null;
  createdAt: string;
  /** The caller's permission: space permission for task files; a file with
   *  no task is creator-only and reads as 'full' for its creator. */
  perm: Permission;
}

/**
 * Load a file and resolve the caller's access (Module 12 rules):
 *  - task-attached  -> follows the task's SPACE (404 when invisible); the
 *                      space permission is returned for finer gating.
 *  - doc-attached   -> follows the DOC's visibility (space-attached: the
 *                      space; private: creator; else: any non-guest member).
 *  - neither        -> creator ONLY; anyone else gets a 404 (never leak).
 */
export async function requireFileVisible(
  access: AccessService,
  client: PoolClient,
  userId: string,
  role: Role,
  fileId: string,
): Promise<FileCtx> {
  const res = await client.query(
    `SELECT f.id, f.task_id, f.doc_id, f.name, f.mime, f.size_bytes, f.is_clip,
            f.created_by, f.created_at,
            t.list_id, t.space_id, t.name AS task_name,
            d.space_id AS doc_space_id, d.is_private AS doc_private,
            d.created_by AS doc_created_by
     FROM files f
     LEFT JOIN tasks t ON t.id = f.task_id
     LEFT JOIN docs d ON d.id = f.doc_id
     WHERE f.id = $1`,
    [fileId],
  );
  const r = res.rows[0];
  if (!r) throw new NotFoundException("File not found");

  let perm: Permission;
  if (r.task_id === null && r.doc_id !== null) {
    // Uploaded document — mirror DocsService visibility exactly.
    const docSpaceId = r.doc_space_id as string | null;
    if (docSpaceId !== null) {
      perm = (await requireSpaceVisible(
        access,
        client,
        userId,
        role,
        docSpaceId,
      )) as Permission;
    } else if (r.doc_private as boolean) {
      if ((r.doc_created_by as string | null) !== userId) {
        throw new NotFoundException("File not found");
      }
      perm = "full";
    } else {
      if (role === "guest") throw new NotFoundException("File not found");
      perm = "edit";
    }
  } else if (r.task_id === null) {
    if ((r.created_by as string | null) !== userId) {
      throw new NotFoundException("File not found");
    }
    perm = "full";
  } else {
    perm = (await requireSpaceVisible(
      access,
      client,
      userId,
      role,
      r.space_id as string,
    )) as Permission;
  }
  return {
    id: r.id as string,
    taskId: (r.task_id as string | null) ?? null,
    listId: (r.list_id as string | null) ?? null,
    spaceId: (r.space_id as string | null) ?? null,
    taskName: (r.task_name as string | null) ?? null,
    name: r.name as string,
    mime: r.mime as string,
    sizeBytes: r.size_bytes as number,
    isClip: r.is_clip as boolean,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: iso(r.created_at)!,
    perm,
  };
}
