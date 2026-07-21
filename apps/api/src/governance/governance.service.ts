import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  resolveCapabilities,
  type AuditEvent,
  type AuditIntegrity,
  type Capability,
  type CapabilityOverrides,
  type CustomRole,
  type Role,
} from "@stackup/shared";
import { AuditService, auditPayload } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { LimitsService } from "../limits/limits.service";

/** Sanitize an arbitrary capability map down to known boolean keys. */
function cleanOverrides(input: unknown): CapabilityOverrides {
  const out: CapabilityOverrides = {};
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    for (const cap of CAPABILITIES) {
      if (typeof rec[cap] === "boolean") out[cap] = rec[cap] as boolean;
    }
  }
  return out;
}

interface CustomRoleRow {
  id: string;
  name: string;
  description: string | null;
  base_role: Role;
  capabilities: CapabilityOverrides;
  created_at: Date;
  member_count?: string;
}

function toCustomRole(r: CustomRoleRow): CustomRole {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    baseRole: r.base_role,
    capabilities: cleanOverrides(r.capabilities),
    memberCount: Number(r.member_count ?? 0),
    createdAt: (r.created_at instanceof Date
      ? r.created_at
      : new Date(r.created_at)
    ).toISOString(),
  };
}

/**
 * Module 17 — Governance. Two capabilities:
 *
 *   1. Custom roles: workspace-scoped named roles that derive from a base
 *      built-in role (member/guest) and override individual capability flags.
 *      An admin creates them and assigns them to memberships. The built-in
 *      roles and RLS are untouched — this is a purely additive capability
 *      layer resolved server-side (the access token still carries the base
 *      role). Enforcement funnels through requireCapability().
 *
 *   2. Audit log viewer: a paginated, filterable read over the append-only,
 *      hash-chained audit_log (written since M0), plus an integrity check that
 *      re-walks the chain to detect tampering. Restricted to callers who hold
 *      the viewAuditLog capability (owner/admin by default).
 */
@Injectable()
export class GovernanceService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
  ) {}

  // --- capability resolution & enforcement ---------------------------------

  /**
   * Effective capabilities for a user in the current workspace. owner/admin
   * always hold everything; otherwise we read the membership's optional custom
   * role and merge its overrides over the base role's defaults. Runs inside an
   * existing withWorkspace transaction (RLS confines the lookups).
   */
  async capabilitiesFor(
    client: PoolClient,
    userId: string,
    role: Role,
  ): Promise<Record<Capability, boolean>> {
    if (role === "owner" || role === "admin") {
      return { ...ROLE_CAPABILITIES[role] };
    }
    const res = await client.query(
      `SELECT cr.base_role, cr.capabilities
         FROM memberships m
         JOIN custom_roles cr ON cr.id = m.custom_role_id
        WHERE m.user_id = $1`,
      [userId],
    );
    const row = res.rows[0] as
      | { base_role: Role; capabilities: CapabilityOverrides }
      | undefined;
    return resolveCapabilities(
      role,
      row ? { baseRole: row.base_role, capabilities: cleanOverrides(row.capabilities) } : null,
    );
  }

  /** True if the caller holds `cap`. */
  async can(
    client: PoolClient,
    userId: string,
    role: Role,
    cap: Capability,
  ): Promise<boolean> {
    const caps = await this.capabilitiesFor(client, userId, role);
    return caps[cap] === true;
  }

  /** Throw 403 unless the caller holds `cap`. */
  async requireCapability(
    client: PoolClient,
    userId: string,
    role: Role,
    cap: Capability,
    message: string,
  ): Promise<void> {
    if (!(await this.can(client, userId, role, cap))) {
      throw new ForbiddenException(message);
    }
  }

  // --- custom role management (admin) --------------------------------------

  async listRoles(workspaceId: string, userId: string): Promise<CustomRole[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT cr.*,
                (SELECT count(*) FROM memberships m WHERE m.custom_role_id = cr.id) AS member_count
           FROM custom_roles cr
          ORDER BY cr.created_at`,
      );
      return res.rows.map((r) => toCustomRole(r as CustomRoleRow));
    });
  }

  async createRole(
    workspaceId: string,
    userId: string,
    input: {
      name?: string;
      description?: string;
      baseRole?: Role;
      capabilities?: unknown;
    },
  ): Promise<CustomRole> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException("Role name is required");
    const baseRole = input.baseRole ?? "member";
    if (baseRole !== "member" && baseRole !== "guest") {
      throw new BadRequestException("baseRole must be 'member' or 'guest'");
    }
    const capabilities = cleanOverrides(input.capabilities);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // M24: custom roles are a Business-plan feature.
      await this.limits.requireFeature(client, workspaceId, "customRoles", "Custom roles");
      const dup = await client.query(
        `SELECT 1 FROM custom_roles WHERE lower(name) = lower($1)`,
        [name],
      );
      if (dup.rows[0]) {
        throw new BadRequestException("A role with that name already exists");
      }
      const res = await client.query(
        `INSERT INTO custom_roles (workspace_id, name, description, base_role, capabilities, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING *, 0 AS member_count`,
        [
          workspaceId,
          name,
          input.description?.trim() || null,
          baseRole,
          JSON.stringify(capabilities),
          userId,
        ],
      );
      const role = toCustomRole(res.rows[0] as CustomRoleRow);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "role.create",
        entity: "custom_role",
        entityId: role.id,
        data: { name, baseRole },
      });
      return role;
    });
  }

  async updateRole(
    workspaceId: string,
    userId: string,
    roleId: string,
    input: { name?: string; description?: string; capabilities?: unknown },
  ): Promise<CustomRole> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.limits.requireFeature(client, workspaceId, "customRoles", "Custom roles");
      const existing = await client.query(
        `SELECT * FROM custom_roles WHERE id = $1`,
        [roleId],
      );
      if (!existing.rows[0]) throw new NotFoundException("Custom role not found");

      const name =
        input.name !== undefined ? input.name.trim() : (existing.rows[0].name as string);
      if (!name) throw new BadRequestException("Role name is required");
      if (input.name !== undefined) {
        const dup = await client.query(
          `SELECT 1 FROM custom_roles WHERE lower(name) = lower($1) AND id <> $2`,
          [name, roleId],
        );
        if (dup.rows[0]) {
          throw new BadRequestException("A role with that name already exists");
        }
      }
      const description =
        input.description !== undefined
          ? input.description.trim() || null
          : (existing.rows[0].description as string | null);
      const capabilities =
        input.capabilities !== undefined
          ? cleanOverrides(input.capabilities)
          : cleanOverrides(existing.rows[0].capabilities);

      const res = await client.query(
        `UPDATE custom_roles
            SET name = $2, description = $3, capabilities = $4::jsonb
          WHERE id = $1
          RETURNING *,
            (SELECT count(*) FROM memberships m WHERE m.custom_role_id = custom_roles.id) AS member_count`,
        [roleId, name, description, JSON.stringify(capabilities)],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "role.update",
        entity: "custom_role",
        entityId: roleId,
        data: { name },
      });
      return toCustomRole(res.rows[0] as CustomRoleRow);
    });
  }

  async deleteRole(
    workspaceId: string,
    userId: string,
    roleId: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `DELETE FROM custom_roles WHERE id = $1 RETURNING name`,
        [roleId],
      );
      if (!res.rows[0]) throw new NotFoundException("Custom role not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "role.delete",
        entity: "custom_role",
        entityId: roleId,
        data: { name: res.rows[0].name },
      });
    });
  }

  /** Assign a custom role to a member (or clear it with roleId = null). */
  async assignRole(
    workspaceId: string,
    userId: string,
    targetUserId: string,
    roleId: string | null,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.limits.requireFeature(client, workspaceId, "customRoles", "Custom roles");
      const member = await client.query(
        `SELECT role FROM memberships WHERE user_id = $1`,
        [targetUserId],
      );
      if (!member.rows[0]) throw new NotFoundException("Member not found");
      const targetRole = member.rows[0].role as Role;
      if (targetRole === "owner" || targetRole === "admin") {
        throw new BadRequestException(
          "Custom roles apply to members and guests, not owners or admins",
        );
      }
      if (roleId !== null) {
        const exists = await client.query(
          `SELECT 1 FROM custom_roles WHERE id = $1`,
          [roleId],
        );
        if (!exists.rows[0]) throw new NotFoundException("Custom role not found");
      }
      await client.query(
        `UPDATE memberships SET custom_role_id = $2 WHERE user_id = $1`,
        [targetUserId, roleId],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: roleId ? "role.assign" : "role.unassign",
        entity: "membership",
        entityId: targetUserId,
        data: { customRoleId: roleId },
      });
    });
  }

  // --- audit log viewer ----------------------------------------------------

  /**
   * Page the audit log newest-first. Cursor is the last row's
   * `${createdAtISO}|${id}`; filters narrow by action/entity/actor.
   */
  async listAudit(
    workspaceId: string,
    userId: string,
    role: Role,
    opts: { limit?: number; cursor?: string; action?: string; entity?: string; actorUserId?: string },
  ): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // M24: the audit viewer is a Business-plan feature (writing continues on
      // every plan — history is complete the day a workspace upgrades).
      await this.limits.requireFeature(client, workspaceId, "auditLog", "The audit log");
      await this.requireCapability(
        client,
        userId,
        role,
        "viewAuditLog",
        "You do not have permission to view the audit log",
      );
      const params: unknown[] = [workspaceId];
      const where: string[] = ["a.workspace_id = $1"];
      if (opts.action) {
        params.push(opts.action);
        where.push(`a.action = $${params.length}`);
      }
      if (opts.entity) {
        params.push(opts.entity);
        where.push(`a.entity = $${params.length}`);
      }
      if (opts.actorUserId) {
        params.push(opts.actorUserId);
        where.push(`a.actor_user_id = $${params.length}`);
      }
      if (opts.cursor) {
        const [ts, id] = opts.cursor.split("|");
        if (ts && id) {
          params.push(ts, id);
          where.push(
            `(a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
          );
        }
      }
      params.push(limit + 1);
      const res = await client.query(
        `SELECT a.id, a.actor_user_id, a.action, a.entity, a.entity_id, a.data, a.created_at,
                u.full_name AS actor_name, u.email AS actor_email
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ${where.join(" AND ")}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $${params.length}`,
        params,
      );
      const rows = res.rows.slice(0, limit);
      const hasMore = res.rows.length > limit;
      const events: AuditEvent[] = rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        data: r.data ?? {},
        createdAt: (r.created_at as Date).toISOString(),
      }));
      const last = rows[rows.length - 1];
      const nextCursor =
        hasMore && last
          ? `${(last.created_at as Date).toISOString()}|${last.id}`
          : null;
      return { events, nextCursor };
    });
  }

  /** Re-walk the whole chain and report the first row (if any) that breaks. */
  async verifyAudit(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<AuditIntegrity> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.limits.requireFeature(client, workspaceId, "auditLog", "The audit log");
      await this.requireCapability(
        client,
        userId,
        role,
        "viewAuditLog",
        "You do not have permission to view the audit log",
      );
      const res = await client.query(
        `SELECT id, actor_user_id, action, entity, entity_id, data, prev_hash, hash
           FROM audit_log
          WHERE workspace_id = $1
          ORDER BY created_at ASC, id ASC`,
        [workspaceId],
      );
      let prevHash: string | null = null;
      for (const r of res.rows) {
        const expected = createHash("sha256")
          .update(
            auditPayload(prevHash, {
              workspaceId,
              actorUserId: r.actor_user_id,
              action: r.action,
              entity: r.entity,
              entityId: r.entity_id ?? null,
              data: r.data ?? {},
            }),
          )
          .digest("hex");
        if (r.prev_hash !== prevHash || r.hash !== expected) {
          return { ok: false, checked: res.rows.length, brokenAt: r.id as string };
        }
        prevHash = r.hash as string;
      }
      return { ok: true, checked: res.rows.length, brokenAt: null };
    });
  }
}
