import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";

/** Ordered object permissions: view < comment < edit < full. */
export type Permission = "view" | "comment" | "edit" | "full";
/** A resolved permission, or 'none' when the caller has no access at all. */
export type PermissionOrNone = "none" | Permission;

const PERM_RANK: Record<Permission, number> = {
  view: 1,
  comment: 2,
  edit: 3,
  full: 4,
};

/** Does `perm` meet or exceed `required`? ('none' ranks below everything.) */
export function permAtLeast(
  perm: PermissionOrNone,
  required: Permission,
): boolean {
  if (perm === "none") return false;
  return PERM_RANK[perm] >= PERM_RANK[required];
}

/** The higher of a current best (possibly null) and a candidate. */
function higher(best: Permission | null, candidate: Permission): Permission {
  if (best === null) return candidate;
  return PERM_RANK[candidate] > PERM_RANK[best] ? candidate : best;
}

/**
 * Intra-workspace access control (ACL) for the hierarchy. The hard WORKSPACE
 * boundary is enforced by Postgres RLS (every query below runs inside a
 * withWorkspace() transaction, so it can only ever see the current
 * workspace's rows). THIS service layers product visibility on top of that:
 * who, inside a workspace, may see and act on which Space.
 *
 * M2 enforces sharing at the SPACE level only. `shares` rows for folders and
 * lists are stored (and honored by future milestones) but NOT yet consulted
 * here — a code comment marks that boundary. Everything below keys off the
 * space-level share (object_type='space').
 */
@Injectable()
export class AccessService {
  /** Team ids the user belongs to (RLS-confined to the current workspace). */
  async userTeamIds(client: PoolClient, userId: string): Promise<string[]> {
    const res = await client.query(
      `SELECT team_id FROM team_members WHERE user_id = $1`,
      [userId],
    );
    return res.rows.map((r) => r.team_id as string);
  }

  /**
   * Highest space-level permission the user holds per space, considering both
   * their direct (principal_type='user') shares and their teams' shares.
   * NOTE (M2): only object_type='space' shares are read; folder/list shares
   * are stored but not enforced yet.
   */
  async userSpaceShareMap(
    client: PoolClient,
    userId: string,
    teamIds: string[],
  ): Promise<Map<string, Permission>> {
    const res = await client.query(
      `SELECT object_id, permission
         FROM shares
        WHERE object_type = 'space'
          AND ((principal_type = 'user' AND principal_id = $1)
            OR (principal_type = 'team' AND principal_id = ANY($2::uuid[])))`,
      [userId, teamIds],
    );
    const map = new Map<string, Permission>();
    for (const row of res.rows) {
      const id = row.object_id as string;
      const perm = row.permission as Permission;
      map.set(id, higher(map.get(id) ?? null, perm));
    }
    return map;
  }

  /**
   * Resolve a role + space privacy + best share into an effective permission.
   * This is the single source of truth for the rules; both the bulk (tree)
   * and single-space paths funnel through it so they can never diverge.
   *
   *  - owner/admin                          -> full (see & manage everything)
   *  - member, public, no share             -> edit (workspace default)
   *  - otherwise                            -> the highest share held, or
   *                                            'none' when the space is not
   *                                            visible to the caller.
   *
   * A space is visible iff this returns something other than 'none'.
   */
  static permissionFor(
    role: Role,
    isPrivate: boolean,
    best: Permission | null,
  ): PermissionOrNone {
    if (role === "owner" || role === "admin") return "full";
    // Guests need an explicit share for anything; members additionally see
    // every public (non-private) space.
    const visible = role === "member" ? !isPrivate || best !== null : best !== null;
    if (!visible) return "none";
    if (role === "member" && !isPrivate && best === null) return "edit";
    return best ?? "none";
  }

  /**
   * The set of space ids the caller can see:
   *  - owner/admin -> ALL spaces in the workspace.
   *  - member      -> public spaces UNION spaces shared with them or a team.
   *  - guest       -> ONLY spaces shared with them or a team.
   */
  async visibleSpaceIds(
    client: PoolClient,
    userId: string,
    role: Role,
  ): Promise<Set<string>> {
    if (role === "owner" || role === "admin") {
      const res = await client.query(`SELECT id FROM spaces`);
      return new Set(res.rows.map((r) => r.id as string));
    }
    const teamIds = await this.userTeamIds(client, userId);
    const shared = await client.query(
      `SELECT object_id AS id
         FROM shares
        WHERE object_type = 'space'
          AND ((principal_type = 'user' AND principal_id = $1)
            OR (principal_type = 'team' AND principal_id = ANY($2::uuid[])))`,
      [userId, teamIds],
    );
    const set = new Set<string>(shared.rows.map((r) => r.id as string));
    if (role === "member") {
      const pub = await client.query(
        `SELECT id FROM spaces WHERE is_private = false`,
      );
      for (const r of pub.rows) set.add(r.id as string);
    }
    return set;
  }

  /**
   * The caller's effective permission on a single space. Returns 'none' when
   * the space is not visible (also the natural result for a space in another
   * workspace, which RLS hides entirely).
   */
  async spacePermission(
    client: PoolClient,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<PermissionOrNone> {
    if (role === "owner" || role === "admin") {
      // Still confirm the space exists in this workspace so callers can 404.
      const res = await client.query(`SELECT id FROM spaces WHERE id = $1`, [
        spaceId,
      ]);
      return res.rows[0] ? "full" : "none";
    }
    const res = await client.query(
      `SELECT is_private FROM spaces WHERE id = $1`,
      [spaceId],
    );
    if (!res.rows[0]) return "none";
    const isPrivate = res.rows[0].is_private as boolean;
    const teamIds = await this.userTeamIds(client, userId);
    const shareMap = await this.userSpaceShareMap(client, userId, teamIds);
    return AccessService.permissionFor(
      role,
      isPrivate,
      shareMap.get(spaceId) ?? null,
    );
  }

  /** Can this permission + role administer the space (privacy/shares/delete)? */
  canManageSpace(perm: PermissionOrNone, role: Role): boolean {
    return role === "owner" || role === "admin" || perm === "full";
  }
}
