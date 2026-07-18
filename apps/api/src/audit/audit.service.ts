import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export interface AuditEntry {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

/**
 * Append-only, per-workspace hash-chained audit trail
 * (db/migrations/0001_core.sql). record() MUST be called inside the same
 * withWorkspace() transaction as the mutation it describes, so the audit
 * entry and the change commit or roll back together, and the RLS
 * `audit_append` policy (which keys off app.current_workspace) permits the
 * INSERT. Each row's hash chains over the previous hash + the payload, so
 * any tampering with an earlier row breaks every hash after it. A DB
 * trigger additionally blocks UPDATE/DELETE, making the log immutable.
 *
 * An advisory transaction lock per workspace serializes concurrent writers
 * so the chain can never fork on a race for the same prev_hash.
 */
@Injectable()
export class AuditService {
  async record(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('audit:' || $1))",
      [entry.workspaceId],
    );
    const prevRes = await client.query(
      `SELECT hash FROM audit_log WHERE workspace_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [entry.workspaceId],
    );
    const prevHash: string | null = prevRes.rows[0]?.hash ?? null;
    const data = entry.data ?? {};
    const hash = createHash("sha256")
      .update(
        `${prevHash ?? ""}|${JSON.stringify({
          workspaceId: entry.workspaceId,
          actorUserId: entry.actorUserId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          data,
        })}`,
      )
      .digest("hex");
    await client.query(
      `INSERT INTO audit_log
         (workspace_id, actor_user_id, action, entity, entity_id, data, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.workspaceId,
        entry.actorUserId,
        entry.action,
        entry.entity,
        entry.entityId ?? null,
        JSON.stringify(data),
        prevHash,
        hash,
      ],
    );
  }
}
