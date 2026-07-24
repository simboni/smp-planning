import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import {
  AccessService,
  Permission,
  PermissionOrNone,
} from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

type PrincipalType = "user" | "team" | "department";

export interface ShareEntry {
  principalType: PrincipalType;
  principalId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  permission: Permission;
}

export interface SpaceAccess {
  isPrivate: boolean;
  canManage: boolean;
  entries: ShareEntry[];
}

const PERMISSIONS: Permission[] = ["view", "comment", "edit", "full"];

/**
 * Space-level sharing (the ACL editor behind a space's "Sharing & Permissions"
 * panel). M2 enforces sharing at the space level only; folder/list shares are
 * stored but not yet consulted by AccessService.
 */
@Injectable()
export class SharingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** Resolve the caller's permission on a space, 404-ing if not visible. */
  private async loadVisible(
    client: PoolClient,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<{ perm: PermissionOrNone; isPrivate: boolean }> {
    const perm = await this.access.spacePermission(
      client,
      userId,
      role,
      spaceId,
    );
    if (perm === "none") throw new NotFoundException("Space not found");
    const res = await client.query(
      `SELECT is_private FROM spaces WHERE id = $1`,
      [spaceId],
    );
    if (!res.rows[0]) throw new NotFoundException("Space not found");
    return { perm, isPrivate: res.rows[0].is_private as boolean };
  }

  private requireManage(perm: PermissionOrNone, role: Role): void {
    if (!this.access.canManageSpace(perm, role)) {
      throw new ForbiddenException("You need full access to manage sharing");
    }
  }

  async access_(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<SpaceAccess> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { perm, isPrivate } = await this.loadVisible(
        client,
        userId,
        role,
        spaceId,
      );
      const res = await client.query(
        `SELECT s.principal_type, s.principal_id, s.permission,
                u.full_name AS user_name, u.email AS user_email,
                u.avatar_url AS user_avatar,
                t.name AS team_name,
                d.name AS department_name
         FROM shares s
         LEFT JOIN users u
           ON s.principal_type = 'user' AND u.id = s.principal_id
         LEFT JOIN teams t
           ON s.principal_type = 'team' AND t.id = s.principal_id
         LEFT JOIN departments d
           ON s.principal_type = 'department' AND d.id = s.principal_id
         WHERE s.object_type = 'space' AND s.object_id = $1
         ORDER BY s.created_at`,
        [spaceId],
      );
      const entries: ShareEntry[] = res.rows.map((r) => {
        const principalType = r.principal_type as PrincipalType;
        return {
          principalType,
          principalId: r.principal_id as string,
          name:
            principalType === "user"
              ? ((r.user_name as string | null) ?? "Unknown user")
              : principalType === "department"
                ? ((r.department_name as string | null) ?? "Unknown department")
                : ((r.team_name as string | null) ?? "Unknown team"),
          email: principalType === "user"
            ? ((r.user_email as string | null) ?? null)
            : null,
          avatarUrl:
            principalType === "user"
              ? ((r.user_avatar as string | null) ?? null)
              : null,
          permission: r.permission as Permission,
        };
      });
      return {
        isPrivate,
        canManage: this.access.canManageSpace(perm, role),
        entries,
      };
    });
  }

  async setPrivacy(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    isPrivate: boolean,
  ): Promise<{ isPrivate: boolean }> {
    if (typeof isPrivate !== "boolean") {
      throw new BadRequestException("isPrivate must be a boolean");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { perm } = await this.loadVisible(client, userId, role, spaceId);
      this.requireManage(perm, role);
      await client.query(`UPDATE spaces SET is_private = $2 WHERE id = $1`, [
        spaceId,
        isPrivate,
      ]);
      // Turning privacy ON can lock out a plain member who has no explicit
      // share: give them a full self-share so they keep access to what they
      // just locked down.
      if (isPrivate && role !== "owner" && role !== "admin") {
        await client.query(
          `INSERT INTO shares
             (workspace_id, object_type, object_id, principal_type, principal_id, permission, created_by)
           VALUES ($1, 'space', $2, 'user', $3, 'full', $3)
           ON CONFLICT (object_type, object_id, principal_type, principal_id)
           DO NOTHING`,
          [workspaceId, spaceId, userId],
        );
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "space.privacy",
        entity: "space",
        entityId: spaceId,
        data: { isPrivate },
      });
      return { isPrivate };
    });
  }

  async upsertShare(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: {
      principalType?: string;
      principalId?: string;
      permission?: string;
    },
  ): Promise<ShareEntry> {
    const principalType = body?.principalType;
    const principalId = body?.principalId;
    const permission = body?.permission;
    if (
      principalType !== "user" &&
      principalType !== "team" &&
      principalType !== "department"
    ) {
      throw new BadRequestException(
        "principalType must be 'user', 'team' or 'department'",
      );
    }
    if (typeof principalId !== "string" || !principalId) {
      throw new BadRequestException("principalId is required");
    }
    if (
      typeof permission !== "string" ||
      !PERMISSIONS.includes(permission as Permission)
    ) {
      throw new BadRequestException(
        "permission must be one of view, comment, edit, full",
      );
    }

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { perm } = await this.loadVisible(client, userId, role, spaceId);
      this.requireManage(perm, role);
      await this.assertPrincipalExists(client, principalType, principalId);
      await client.query(
        `INSERT INTO shares
           (workspace_id, object_type, object_id, principal_type, principal_id, permission, created_by)
         VALUES ($1, 'space', $2, $3, $4, $5, $6)
         ON CONFLICT (object_type, object_id, principal_type, principal_id)
         DO UPDATE SET permission = EXCLUDED.permission`,
        [workspaceId, spaceId, principalType, principalId, permission, userId],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "space.shared",
        entity: "space",
        entityId: spaceId,
        data: { principalType, principalId, permission },
      });
      return this.resolveEntry(
        client,
        principalType,
        principalId,
        permission as Permission,
      );
    });
  }

  async removeShare(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    principalType: string,
    principalId: string,
  ): Promise<void> {
    if (
      principalType !== "user" &&
      principalType !== "team" &&
      principalType !== "department"
    ) {
      throw new BadRequestException(
        "principalType must be 'user', 'team' or 'department'",
      );
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { perm } = await this.loadVisible(client, userId, role, spaceId);
      this.requireManage(perm, role);
      await client.query(
        `DELETE FROM shares
         WHERE object_type = 'space' AND object_id = $1
           AND principal_type = $2 AND principal_id = $3`,
        [spaceId, principalType, principalId],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "space.unshared",
        entity: "space",
        entityId: spaceId,
        data: { principalType, principalId },
      });
    });
  }

  private async assertPrincipalExists(
    client: PoolClient,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<void> {
    if (principalType === "user") {
      const res = await client.query(
        `SELECT 1 FROM memberships WHERE user_id = $1`,
        [principalId],
      );
      if (!res.rows[0]) {
        throw new BadRequestException("user is not a member of this workspace");
      }
    } else if (principalType === "department") {
      const res = await client.query(
        `SELECT 1 FROM departments WHERE id = $1`,
        [principalId],
      );
      if (!res.rows[0]) {
        throw new BadRequestException(
          "department does not exist in this workspace",
        );
      }
    } else {
      const res = await client.query(`SELECT 1 FROM teams WHERE id = $1`, [
        principalId,
      ]);
      if (!res.rows[0]) {
        throw new BadRequestException("team does not exist in this workspace");
      }
    }
  }

  private async resolveEntry(
    client: PoolClient,
    principalType: PrincipalType,
    principalId: string,
    permission: Permission,
  ): Promise<ShareEntry> {
    if (principalType === "user") {
      const res = await client.query(
        `SELECT full_name, email, avatar_url FROM users WHERE id = $1`,
        [principalId],
      );
      const r = res.rows[0];
      return {
        principalType,
        principalId,
        name: (r?.full_name as string | null) ?? "Unknown user",
        email: (r?.email as string | null) ?? null,
        avatarUrl: (r?.avatar_url as string | null) ?? null,
        permission,
      };
    }
    const table = principalType === "department" ? "departments" : "teams";
    const res = await client.query(
      `SELECT name FROM ${table} WHERE id = $1`,
      [principalId],
    );
    return {
      principalType,
      principalId,
      name:
        (res.rows[0]?.name as string | null) ??
        (principalType === "department" ? "Unknown department" : "Unknown team"),
      email: null,
      avatarUrl: null,
      permission,
    };
  }
}
