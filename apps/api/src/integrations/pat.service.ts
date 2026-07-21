import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";

export type PatScope = "read" | "write";

export interface PatSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: PatScope;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** The resolved principal a valid PAT authenticates as. */
export interface PatPrincipal {
  workspaceId: string;
  userId: string;
  role: Role;
  scope: PatScope;
  tokenId: string;
}

const PREFIX = "stackup_pat_";

/**
 * Personal Access Tokens for the public REST API (M15). Only a SHA-256 hash
 * of each token is stored (mirroring refresh tokens), so a DB dump yields no
 * usable credential. Management runs under normal workspace context; the auth
 * resolve path runs under the `app.pat_token` RLS arm (see DbService).
 */
@Injectable()
export class PatService {
  constructor(private readonly db: DbService) {}

  /** Mint a token for the caller. Returns the plaintext exactly once. */
  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { name?: string; scope?: string },
  ): Promise<{ token: string; pat: PatSummary }> {
    if (role === "guest") {
      throw new ForbiddenException("Guests cannot create API tokens");
    }
    const name = (body.name ?? "").trim() || "API token";
    const scope: PatScope = body.scope === "read" ? "read" : "write";
    const secret = randomBytes(24).toString("hex");
    const token = `${PREFIX}${secret}`;
    const tokenPrefix = token.slice(0, 16);
    const row = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        `INSERT INTO personal_access_tokens
           (workspace_id, user_id, name, token_hash, token_prefix, scope)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, token_prefix, scope, last_used_at, expires_at, created_at`,
        [workspaceId, userId, name, sha256(token), tokenPrefix, scope],
      );
      return res.rows[0];
    });
    return { token, pat: toSummary(row) };
  }

  async list(workspaceId: string, userId: string): Promise<PatSummary[]> {
    return this.db.withWorkspace(workspaceId, userId, async (c) => {
      // Scope to the calling user: a personal access token belongs to the
      // person who created it, not to the whole workspace. Without the
      // user_id filter any member could enumerate (and, in revoke(), destroy)
      // other members' tokens.
      const res = await c.query(
        `SELECT id, name, token_prefix, scope, last_used_at, expires_at, created_at
         FROM personal_access_tokens
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [userId],
      );
      return res.rows.map(toSummary);
    });
  }

  async revoke(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    const done = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        "UPDATE personal_access_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        [id, userId],
      );
      return res.rowCount ?? 0;
    });
    if (done === 0) throw new NotFoundException("Token not found");
  }

  /**
   * Resolve a presented token to its principal, or null if invalid/expired/
   * revoked. Runs the lookup under the pat_token RLS arm (no tenant context),
   * then reads the membership role and stamps last_used_at under real context.
   */
  async resolve(token: string): Promise<PatPrincipal | null> {
    if (!token.startsWith(PREFIX)) return null;
    const hash = sha256(token);
    const found = await this.db.withPatToken(hash, async (c) => {
      const res = await c.query(
        `SELECT id, workspace_id, user_id, scope, expires_at, revoked_at
         FROM personal_access_tokens WHERE token_hash = $1`,
        [hash],
      );
      return res.rows[0] as
        | {
            id: string;
            workspace_id: string;
            user_id: string;
            scope: PatScope;
            expires_at: string | null;
            revoked_at: string | null;
          }
        | undefined;
    });
    if (!found || found.revoked_at) return null;
    if (found.expires_at && new Date(found.expires_at) < new Date()) return null;

    // Read the membership role and bump last_used_at under proper context.
    const role = await this.db.withWorkspace(
      found.workspace_id,
      found.user_id,
      async (c) => {
        const m = await c.query(
          "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'",
          [found.workspace_id, found.user_id],
        );
        if (m.rowCount === 0) return null;
        await c.query(
          "UPDATE personal_access_tokens SET last_used_at = now() WHERE id = $1",
          [found.id],
        );
        return m.rows[0].role as Role;
      },
    );
    if (!role) return null;
    return {
      workspaceId: found.workspace_id,
      userId: found.user_id,
      role,
      scope: found.scope,
      tokenId: found.id,
    };
  }
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function toSummary(row: {
  id: string;
  name: string;
  token_prefix: string;
  scope: PatScope;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}): PatSummary {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scope: row.scope,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
