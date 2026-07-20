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
 * Deterministic JSON: object keys are emitted in sorted order at every depth.
 * The audit `data` is stored as jsonb, which normalizes key order on the way
 * back out (Postgres orders keys by length then bytes). Hashing over a
 * canonical form makes the chain verifiable regardless of how the writer's
 * in-memory object was ordered vs. how jsonb hands it back — otherwise any
 * multi-key payload whose insertion order differs from jsonb's storage order
 * would fail integrity verification. Used by BOTH the writer here and the
 * verifier (GovernanceService.verifyAudit); they must stay in lockstep.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** The exact string hashed for one entry — shared by writer and verifier. */
export function auditPayload(
  prevHash: string | null,
  entry: {
    workspaceId: string;
    actorUserId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    data: Record<string, unknown>;
  },
): string {
  return `${prevHash ?? ""}|${canonicalJson({
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    data: entry.data,
  })}`;
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
        auditPayload(prevHash, {
          workspaceId: entry.workspaceId,
          actorUserId: entry.actorUserId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          data,
        }),
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
