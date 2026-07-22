import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import type { Role, WorkspaceSummary } from "@stackup/shared";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { DbService } from "../db/db.service";
import { LimitsService } from "../limits/limits.service";

export interface WorkspaceMember {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  role: Role;
  status: string;
  /** Assigned custom role id (M17), or null when none. */
  customRoleId: string | null;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly limits: LimitsService,
  ) {}

  /** The caller's active workspaces (workspace picker). */
  async list(userId: string): Promise<WorkspaceSummary[]> {
    return this.auth.listWorkspaces(userId);
  }

  /**
   * Create a workspace with the caller as owner. Provisioning goes through
   * the create_workspace_with_owner SECURITY DEFINER function — the only
   * write path to `workspaces` for the app role — which inserts the
   * workspace and the owner membership atomically. We then write an audit
   * entry inside the new workspace's RLS context.
   */
  async create(userId: string, name: string): Promise<WorkspaceSummary> {
    const workspaceId = await this.provisionWithUniqueSlug(name, userId);
    const summary = await this.db.withUser(userId, async (client) => {
      const res = await client.query(
        `SELECT w.id, w.name, w.slug, w.color, w.avatar_url, m.role
         FROM workspaces w
         JOIN memberships m ON m.workspace_id = w.id AND m.user_id = $2
         WHERE w.id = $1`,
        [workspaceId, userId],
      );
      const row = res.rows[0];
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        avatarUrl: row.avatar_url,
        role: row.role as Role,
      };
    });
    await this.db.withWorkspace(workspaceId, userId, (client) =>
      this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "workspace.created",
        entity: "workspace",
        entityId: workspaceId,
        data: { name: summary.name, slug: summary.slug },
      }),
    );
    return summary;
  }

  /** Mint a workspace-scoped access token (membership verified in AuthService). */
  async token(
    userId: string,
    workspaceId: string,
  ): Promise<{ accessToken: string; workspace: WorkspaceSummary }> {
    return this.auth.issueAccessToken(userId, workspaceId);
  }

  /** The active workspace behind an access token, plus the caller's role. */
  async current(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspace: WorkspaceSummary; role: Role }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT w.id, w.name, w.slug, w.color, w.avatar_url, m.role
         FROM workspaces w
         JOIN memberships m ON m.workspace_id = w.id AND m.user_id = $2
         WHERE w.id = $1`,
        [workspaceId, userId],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException();
      const workspace: WorkspaceSummary = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        avatarUrl: row.avatar_url,
        role: row.role,
      };
      return { workspace, role: row.role as Role };
    });
  }

  /**
   * Update the workspace's presentation (name / accent color / logo). Admin-
   * only (enforced at the controller). Color must be a #rrggbb hex; an empty
   * logo clears it. Runs under withWorkspace so the workspace_self RLS policy
   * confines the UPDATE to this workspace.
   */
  async update(
    workspaceId: string,
    userId: string,
    input: { name?: string; color?: string; avatarUrl?: string | null },
  ): Promise<WorkspaceSummary> {
    const sets: string[] = [];
    const params: unknown[] = [workspaceId];
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("Workspace name cannot be empty");
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (input.color !== undefined) {
      const color = input.color.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw new BadRequestException("Color must be a #rrggbb hex value");
      }
      params.push(color);
      sets.push(`color = $${params.length}`);
    }
    if (input.avatarUrl !== undefined) {
      const url = input.avatarUrl?.trim() || null;
      if (url && url.length > 2000) {
        throw new BadRequestException("Logo URL is too long");
      }
      params.push(url);
      sets.push(`avatar_url = $${params.length}`);
    }
    if (sets.length === 0) {
      throw new BadRequestException("Nothing to update");
    }
    // M24: renaming is free; the accent color and logo are branding (paid).
    const wantsBranding = input.color !== undefined || input.avatarUrl !== undefined;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      if (wantsBranding) {
        await this.limits.requireFeature(client, workspaceId, "branding", "Custom branding");
      }
      const res = await client.query(
        `UPDATE workspaces SET ${sets.join(", ")} WHERE id = $1
         RETURNING id, name, slug, color, avatar_url`,
        params,
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException();
      const roleRes = await client.query(
        `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "workspace.updated",
        entity: "workspace",
        entityId: workspaceId,
        data: Object.fromEntries(
          Object.entries(input).filter(([, v]) => v !== undefined),
        ),
      });
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        avatarUrl: row.avatar_url,
        role: (roleRes.rows[0]?.role ?? "member") as Role,
      };
    });
  }

  /**
   * Permanently delete the workspace and everything it owns. Owner-only
   * (verified inside the SECURITY DEFINER delete_workspace function, which is
   * the app role's only DELETE path to `workspaces`). Every workspace-owned
   * table cascades from the workspaces row, so this one call removes the whole
   * tenant. Goes through the non-transactional pool path — the function binds
   * and restores its own tenant context.
   */
  async remove(workspaceId: string, userId: string): Promise<void> {
    try {
      await this.db.query("SELECT delete_workspace($1, $2)", [workspaceId, userId]);
    } catch (err: unknown) {
      // insufficient_privilege — caller is not the owner.
      if ((err as { code?: string }).code === "42501") {
        throw new BadRequestException("Only the workspace owner can delete the workspace");
      }
      throw err;
    }
  }

  /**
   * Members of the current workspace. Runs under withWorkspace, so RLS
   * confines the memberships join to this workspace — the WHERE clause is
   * intent, the policy is enforcement.
   */
  async members(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT u.id, u.email, u.full_name, u.avatar_url, m.role, m.status, m.custom_role_id
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1
         ORDER BY m.created_at`,
        [workspaceId],
      );
      return res.rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        role: r.role as Role,
        status: r.status,
        customRoleId: r.custom_role_id ?? null,
      }));
    });
  }

  /**
   * Invite a member by email. If an identity with that email exists, add an
   * active membership (409 if already a member). Otherwise create a shell
   * user (active, random unusable password, name from the email local-part)
   * then add the membership — the invitee sets a real password later. The
   * user row is written outside the workspace transaction (global table);
   * the membership + audit entry are written inside it under RLS.
   */
  async addMember(
    workspaceId: string,
    actorUserId: string,
    email: string,
    role: Role,
  ): Promise<WorkspaceMember> {
    const targetUserId = await this.resolveOrCreateUser(email);
    return this.db.withWorkspace(workspaceId, actorUserId, async (client) => {
      const insert = await client.query(
        `INSERT INTO memberships (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING
         RETURNING id`,
        [workspaceId, targetUserId, role],
      );
      if (!insert.rows[0]) {
        throw new ConflictException("Already a member of this workspace");
      }
      const res = await client.query(
        `SELECT u.id, u.email, u.full_name, u.avatar_url, m.role, m.status
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1 AND m.user_id = $2`,
        [workspaceId, targetUserId],
      );
      const r = res.rows[0];
      const member: WorkspaceMember = {
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        role: r.role,
        status: r.status,
        customRoleId: null,
      };
      await this.audit.record(client, {
        workspaceId,
        actorUserId,
        action: "member.invited",
        entity: "membership",
        entityId: insert.rows[0].id,
        data: { email, role },
      });
      return member;
    });
  }

  /**
   * Change a member's role or suspend / reactivate them. Owner + admin only
   * (enforced at the controller). Guards: the workspace owner can never be
   * demoted or suspended, nobody can be promoted TO owner through this path
   * (ownership transfer is a separate flow), and you cannot act on yourself.
   */
  async updateMember(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    input: { role?: Role; status?: string },
  ): Promise<WorkspaceMember> {
    if (targetUserId === actorUserId) {
      throw new BadRequestException("You can't change your own membership here");
    }
    if (input.role !== undefined && !["admin", "member", "guest"].includes(input.role)) {
      throw new BadRequestException("role must be 'admin', 'member' or 'guest'");
    }
    if (input.status !== undefined && !["active", "suspended"].includes(input.status)) {
      throw new BadRequestException("status must be 'active' or 'suspended'");
    }
    if (input.role === undefined && input.status === undefined) {
      throw new BadRequestException("Nothing to update");
    }
    return this.db.withWorkspace(workspaceId, actorUserId, async (client) => {
      const cur = await client.query(
        `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, targetUserId],
      );
      if (!cur.rows[0]) throw new NotFoundException("Member not found");
      if (cur.rows[0].role === "owner") {
        throw new BadRequestException("The workspace owner can't be modified");
      }
      const sets: string[] = [];
      const params: unknown[] = [workspaceId, targetUserId];
      if (input.role !== undefined) {
        params.push(input.role);
        sets.push(`role = $${params.length}`);
      }
      if (input.status !== undefined) {
        params.push(input.status);
        sets.push(`status = $${params.length}`);
      }
      const res = await client.query(
        `UPDATE memberships SET ${sets.join(", ")}
         WHERE workspace_id = $1 AND user_id = $2
         RETURNING id`,
        params,
      );
      const row = await client.query(
        `SELECT u.id, u.email, u.full_name, u.avatar_url, m.role, m.status, m.custom_role_id
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1 AND m.user_id = $2`,
        [workspaceId, targetUserId],
      );
      const r = row.rows[0];
      await this.audit.record(client, {
        workspaceId,
        actorUserId,
        action: input.status !== undefined && input.role === undefined
          ? (input.status === "suspended" ? "member.suspended" : "member.reactivated")
          : "member.updated",
        entity: "membership",
        entityId: res.rows[0].id,
        data: { targetUserId, ...input },
      });
      return {
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        role: r.role as Role,
        status: r.status,
        customRoleId: r.custom_role_id ?? null,
      };
    });
  }

  /**
   * Remove a member from the workspace. Owner + admin only. The owner can't be
   * removed and you can't remove yourself (use "leave workspace" for that, or
   * delete the workspace). Their created content stays; only the membership
   * row is dropped.
   */
  async removeMember(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<void> {
    if (targetUserId === actorUserId) {
      throw new BadRequestException("You can't remove yourself");
    }
    await this.db.withWorkspace(workspaceId, actorUserId, async (client) => {
      const cur = await client.query(
        `SELECT id, role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, targetUserId],
      );
      if (!cur.rows[0]) throw new NotFoundException("Member not found");
      if (cur.rows[0].role === "owner") {
        throw new BadRequestException("The workspace owner can't be removed");
      }
      await client.query(
        `DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, targetUserId],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId,
        action: "member.removed",
        entity: "membership",
        entityId: cur.rows[0].id,
        data: { targetUserId },
      });
    });
  }

  /** Look up a user by email (case-insensitive) or create a shell account. */
  private async resolveOrCreateUser(email: string): Promise<string> {
    const found = await this.db.query(
      "SELECT id FROM users WHERE lower(email) = lower($1)",
      [email.trim()],
    );
    if (found.rows[0]) return found.rows[0].id as string;
    // Shell account: a random hash no one can log in with until the invitee
    // resets it. Name defaults to the email local-part.
    const passwordHash = await argon2.hash(randomBytes(32).toString("base64url"), {
      type: argon2.argon2id,
    });
    const localPart = email.split("@")[0] || email;
    const res = await this.db.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [email.trim(), passwordHash, localPart],
    );
    return res.rows[0].id as string;
  }

  /**
   * Provision with a URL-safe slug derived from the name plus a short random
   * suffix for uniqueness. The suffix makes collisions vanishingly rare, but
   * we still retry a few times on the slug unique-violation to be safe.
   */
  private async provisionWithUniqueSlug(
    name: string,
    userId: string,
  ): Promise<string> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = `${base}-${randomBytes(3).toString("hex")}`;
      try {
        const res = await this.db.query(
          "SELECT create_workspace_with_owner($1, $2, $3) AS id",
          [name.trim(), slug, userId],
        );
        return res.rows[0].id as string;
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "23505") continue;
        throw err;
      }
    }
    throw new ConflictException("Could not allocate a unique workspace slug");
  }
}

/** Lowercase, strip to [a-z0-9-], collapse dashes; fallback for empty. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "workspace";
}
