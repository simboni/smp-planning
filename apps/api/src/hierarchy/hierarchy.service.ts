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
  permAtLeast,
} from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { GovernanceService } from "../governance/governance.service";
import { remapTasksToSpace } from "../tasks/tasks.support";

/** Top division inside a workspace (department / team / client). */
export interface Space {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  isPrivate: boolean;
  archived: boolean;
  sortOrder: number;
}

/** Optional grouping of Lists inside a Space. */
export interface Folder {
  id: string;
  spaceId: string;
  name: string;
  archived: boolean;
  sortOrder: number;
}

/** Container for Tasks (M3). Either in a Folder (folderId) or folderless. */
export interface List {
  id: string;
  spaceId: string;
  folderId: string | null;
  name: string;
  color: string | null;
  archived: boolean;
  sortOrder: number;
}

/** A space annotated with the caller's effective permission on it. */
export type SpaceWithPermission = Space & { myPermission: Permission };

/** The sidebar tree: spaces -> folders -> lists, plus folderless lists. */
export interface HierarchyTree {
  spaces: Array<
    SpaceWithPermission & {
      folders: Array<Folder & { lists: List[] }>;
      lists: List[];
    }
  >;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_SPACE_COLOR = "#7B68EE";

@Injectable()
export class HierarchyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly governance: GovernanceService,
  ) {}

  // --- Permission enforcement helpers ---------------------------------------

  /**
   * Require the caller to have >= edit on the space (owner/admin always do).
   * A space the caller cannot see reads as 'none' -> 404 (never leak its
   * existence); a visible space with too weak a share -> 403.
   */
  private async requireSpaceEdit(
    client: PoolClient,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<void> {
    const perm = await this.access.spacePermission(
      client,
      userId,
      role,
      spaceId,
    );
    if (perm === "none") throw new NotFoundException("Space not found");
    if (!permAtLeast(perm, "edit")) {
      throw new ForbiddenException("You need edit access on this space");
    }
  }

  /**
   * Require the caller to be able to manage the space (owner/admin or a full
   * share): rename/delete the space itself, or reorder within the sidebar.
   */
  private async requireSpaceManage(
    client: PoolClient,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<PermissionOrNone> {
    const perm = await this.access.spacePermission(
      client,
      userId,
      role,
      spaceId,
    );
    if (perm === "none") throw new NotFoundException("Space not found");
    if (!this.access.canManageSpace(perm, role)) {
      throw new ForbiddenException("You need full access to manage this space");
    }
    return perm;
  }

  // --- Row -> DTO mappers ---------------------------------------------------

  private toSpace(r: Record<string, unknown>): Space {
    return {
      id: r.id as string,
      name: r.name as string,
      color: r.color as string,
      icon: (r.icon as string | null) ?? null,
      isPrivate: r.is_private as boolean,
      archived: r.archived as boolean,
      sortOrder: r.sort_order as number,
    };
  }

  private toFolder(r: Record<string, unknown>): Folder {
    return {
      id: r.id as string,
      spaceId: r.space_id as string,
      name: r.name as string,
      archived: r.archived as boolean,
      sortOrder: r.sort_order as number,
    };
  }

  private toList(r: Record<string, unknown>): List {
    return {
      id: r.id as string,
      spaceId: r.space_id as string,
      folderId: (r.folder_id as string | null) ?? null,
      name: r.name as string,
      color: (r.color as string | null) ?? null,
      archived: r.archived as boolean,
      sortOrder: r.sort_order as number,
    };
  }

  // --- Validation helpers ---------------------------------------------------

  private requireName(name: unknown, label = "name"): string {
    if (typeof name !== "string" || !name.trim()) {
      throw new BadRequestException(`${label} is required`);
    }
    return name.trim();
  }

  private validColor(color: unknown, field = "color"): string {
    if (typeof color !== "string" || !HEX_COLOR.test(color)) {
      throw new BadRequestException(`${field} must be a hex color like #7B68EE`);
    }
    return color;
  }

  // --- Tree (sidebar) -------------------------------------------------------

  /** The full non-archived tree in one round trip (3 queries, assembled in JS). */
  async tree(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<HierarchyTree> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const spacesRes = await client.query(
        `SELECT id, name, color, icon, is_private, archived, sort_order
         FROM spaces
         WHERE archived = false
         ORDER BY sort_order, created_at`,
      );
      const foldersRes = await client.query(
        `SELECT id, space_id, name, archived, sort_order
         FROM folders
         WHERE archived = false
         ORDER BY sort_order, created_at`,
      );
      const listsRes = await client.query(
        `SELECT id, space_id, folder_id, name, color, archived, sort_order
         FROM lists
         WHERE archived = false
         ORDER BY sort_order, created_at`,
      );

      const folderNodes = new Map<
        string,
        Folder & { lists: List[] }
      >();
      const foldersBySpace = new Map<string, Array<Folder & { lists: List[] }>>();
      for (const row of foldersRes.rows) {
        const folder = { ...this.toFolder(row), lists: [] as List[] };
        folderNodes.set(folder.id, folder);
        const arr = foldersBySpace.get(folder.spaceId) ?? [];
        arr.push(folder);
        foldersBySpace.set(folder.spaceId, arr);
      }

      const folderlessBySpace = new Map<string, List[]>();
      for (const row of listsRes.rows) {
        const list = this.toList(row);
        if (list.folderId) {
          const parent = folderNodes.get(list.folderId);
          if (parent) parent.lists.push(list);
        } else {
          const arr = folderlessBySpace.get(list.spaceId) ?? [];
          arr.push(list);
          folderlessBySpace.set(list.spaceId, arr);
        }
      }

      // Visibility + myPermission per space: one team + one department lookup
      // + one share lookup, then resolve each space's permission in JS. Spaces
      // that resolve to 'none' are not visible to the caller and are dropped.
      const teamIds = await this.access.userTeamIds(client, userId);
      const departmentIds = await this.access.userDepartmentIds(client, userId);
      const shareMap = await this.access.userSpaceShareMap(
        client,
        userId,
        teamIds,
        departmentIds,
      );

      const spaces = spacesRes.rows
        .map((row) => {
          const space = this.toSpace(row);
          const perm = AccessService.permissionFor(
            role,
            space.isPrivate,
            shareMap.get(space.id) ?? null,
          );
          return { space, perm };
        })
        .filter((x): x is { space: Space; perm: Permission } => x.perm !== "none")
        .map(({ space, perm }) => ({
          ...space,
          myPermission: perm,
          folders: foldersBySpace.get(space.id) ?? [],
          lists: folderlessBySpace.get(space.id) ?? [],
        }));
      return { spaces };
    });
  }

  // --- Spaces ---------------------------------------------------------------

  async listSpaces(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<SpaceWithPermission[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, name, color, icon, is_private, archived, sort_order
         FROM spaces
         WHERE archived = false
         ORDER BY sort_order, created_at`,
      );
      const teamIds = await this.access.userTeamIds(client, userId);
      const departmentIds = await this.access.userDepartmentIds(client, userId);
      const shareMap = await this.access.userSpaceShareMap(
        client,
        userId,
        teamIds,
        departmentIds,
      );
      const out: SpaceWithPermission[] = [];
      for (const r of res.rows) {
        const space = this.toSpace(r);
        const perm = AccessService.permissionFor(
          role,
          space.isPrivate,
          shareMap.get(space.id) ?? null,
        );
        if (perm === "none") continue;
        out.push({ ...space, myPermission: perm });
      }
      return out;
    });
  }

  async createSpace(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { name?: string; color?: string; icon?: string; isPrivate?: boolean },
  ): Promise<SpaceWithPermission> {
    const name = this.requireName(body?.name);
    const color =
      body?.color === undefined || body.color === null
        ? DEFAULT_SPACE_COLOR
        : this.validColor(body.color);
    const icon = body?.icon ?? null;
    const isPrivate = body?.isPrivate === true;

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // M17: a custom role may revoke Space creation from a member/guest.
      await this.governance.requireCapability(
        client,
        userId,
        role,
        "createSpaces",
        "Your role does not allow creating Spaces",
      );
      const nextOrder = await this.nextOrder(
        client,
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM spaces`,
        [],
      );
      const res = await client.query(
        `INSERT INTO spaces (workspace_id, name, color, icon, is_private, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, color, icon, is_private, archived, sort_order`,
        [workspaceId, name, color, icon, isPrivate, nextOrder, userId],
      );
      const space = this.toSpace(res.rows[0]);
      // A plain member who creates a PRIVATE space would otherwise be unable
      // to see it (private + no share = invisible). Grant them a full
      // self-share so the creator keeps ownership of what they just made.
      if (isPrivate && role !== "owner" && role !== "admin") {
        await client.query(
          `INSERT INTO shares
             (workspace_id, object_type, object_id, principal_type, principal_id, permission, created_by)
           VALUES ($1, 'space', $2, 'user', $3, 'full', $3)
           ON CONFLICT (object_type, object_id, principal_type, principal_id)
           DO NOTHING`,
          [workspaceId, space.id, userId],
        );
      }
      const myPermission = AccessService.permissionFor(
        role,
        space.isPrivate,
        isPrivate && role !== "owner" && role !== "admin" ? "full" : null,
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "space.created",
        entity: "space",
        entityId: space.id,
        data: { name: space.name },
      });
      return { ...space, myPermission } as SpaceWithPermission;
    });
  }

  async updateSpace(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: {
      name?: string;
      color?: string;
      icon?: string | null;
      isPrivate?: boolean;
      archived?: boolean;
    },
  ): Promise<SpaceWithPermission> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (body?.name !== undefined) {
      sets.push(`name = $${i++}`);
      params.push(this.requireName(body.name));
    }
    if (body?.color !== undefined) {
      sets.push(`color = $${i++}`);
      params.push(this.validColor(body.color));
    }
    if (body?.icon !== undefined) {
      sets.push(`icon = $${i++}`);
      params.push(body.icon);
    }
    if (body?.isPrivate !== undefined) {
      sets.push(`is_private = $${i++}`);
      params.push(body.isPrivate === true);
    }
    if (body?.archived !== undefined) {
      sets.push(`archived = $${i++}`);
      params.push(body.archived === true);
    }

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // Renaming/reconfiguring a space is a management action.
      await this.requireSpaceManage(client, userId, role, id);
      let space: Space;
      if (sets.length === 0) {
        const res = await client.query(
          `SELECT id, name, color, icon, is_private, archived, sort_order
           FROM spaces WHERE id = $1`,
          [id],
        );
        if (!res.rows[0]) throw new NotFoundException("Space not found");
        space = this.toSpace(res.rows[0]);
      } else {
        params.push(id);
        const res = await client.query(
          `UPDATE spaces SET ${sets.join(", ")}
           WHERE id = $${i}
           RETURNING id, name, color, icon, is_private, archived, sort_order`,
          params,
        );
        if (!res.rows[0]) throw new NotFoundException("Space not found");
        space = this.toSpace(res.rows[0]);
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "space.updated",
        entity: "space",
        entityId: space.id,
        data: { ...body },
      });
      const myPermission = await this.access.spacePermission(
        client,
        userId,
        role,
        space.id,
      );
      return {
        ...space,
        myPermission: (myPermission === "none" ? "view" : myPermission),
      } as SpaceWithPermission;
    });
  }

  async deleteSpace(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // Deleting a space requires full/manage rights (404s if not visible).
      await this.requireSpaceManage(client, userId, role, id);
      const res = await client.query(
        `DELETE FROM spaces WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException("Space not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "space.deleted",
        entity: "space",
        entityId: id,
      });
    });
  }

  /** Space overview: the space plus its non-archived folders (with lists) and folderless lists. */
  async spaceDetail(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<{
    space: SpaceWithPermission;
    folders: Array<Folder & { lists: List[] }>;
    lists: List[];
  }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // A space the caller cannot see is a 404 (never disclose its existence).
      const perm = await this.access.spacePermission(client, userId, role, id);
      if (perm === "none") throw new NotFoundException("Space not found");

      const spaceRes = await client.query(
        `SELECT id, name, color, icon, is_private, archived, sort_order
         FROM spaces WHERE id = $1`,
        [id],
      );
      if (!spaceRes.rows[0]) throw new NotFoundException("Space not found");
      const space: SpaceWithPermission = {
        ...this.toSpace(spaceRes.rows[0]),
        myPermission: perm,
      };

      const foldersRes = await client.query(
        `SELECT id, space_id, name, archived, sort_order
         FROM folders
         WHERE space_id = $1 AND archived = false
         ORDER BY sort_order, created_at`,
        [id],
      );
      const listsRes = await client.query(
        `SELECT id, space_id, folder_id, name, color, archived, sort_order
         FROM lists
         WHERE space_id = $1 AND archived = false
         ORDER BY sort_order, created_at`,
        [id],
      );

      const folderNodes = new Map<string, Folder & { lists: List[] }>();
      const folders = foldersRes.rows.map((row) => {
        const folder = { ...this.toFolder(row), lists: [] as List[] };
        folderNodes.set(folder.id, folder);
        return folder;
      });
      const folderless: List[] = [];
      for (const row of listsRes.rows) {
        const list = this.toList(row);
        if (list.folderId) {
          const parent = folderNodes.get(list.folderId);
          if (parent) parent.lists.push(list);
        } else {
          folderless.push(list);
        }
      }
      return { space, folders, lists: folderless };
    });
  }

  // --- Folders --------------------------------------------------------------

  async createFolder(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string },
  ): Promise<Folder> {
    const name = this.requireName(body?.name);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireSpaceEdit(client, userId, role, spaceId);
      const nextOrder = await this.nextOrder(
        client,
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM folders WHERE space_id = $1`,
        [spaceId],
      );
      const res = await client.query(
        `INSERT INTO folders (workspace_id, space_id, name, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, space_id, name, archived, sort_order`,
        [workspaceId, spaceId, name, nextOrder, userId],
      );
      const folder = this.toFolder(res.rows[0]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "folder.created",
        entity: "folder",
        entityId: folder.id,
        data: { name: folder.name, spaceId },
      });
      return folder;
    });
  }

  async updateFolder(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; archived?: boolean; spaceId?: string },
  ): Promise<Folder> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await client.query(
        `SELECT space_id FROM folders WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Folder not found");
      const fromSpace = owning.rows[0].space_id as string;
      await this.requireSpaceEdit(client, userId, role, fromSpace);

      // Cross-space move carries the folder, its lists and their tasks along.
      const toSpace = body?.spaceId ?? fromSpace;
      const movingSpace = toSpace !== fromSpace;
      if (movingSpace) {
        await this.requireSpaceEdit(client, userId, role, toSpace);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (body?.name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(this.requireName(body.name));
      }
      if (body?.archived !== undefined) {
        sets.push(`archived = $${i++}`);
        params.push(body.archived === true);
      }
      if (movingSpace) {
        sets.push(`space_id = $${i++}`);
        params.push(toSpace);
      }

      let folder: Folder;
      if (sets.length === 0) {
        const res = await client.query(
          `SELECT id, space_id, name, archived, sort_order FROM folders WHERE id = $1`,
          [id],
        );
        if (!res.rows[0]) throw new NotFoundException("Folder not found");
        folder = this.toFolder(res.rows[0]);
      } else {
        params.push(id);
        const res = await client.query(
          `UPDATE folders SET ${sets.join(", ")}
           WHERE id = $${i}
           RETURNING id, space_id, name, archived, sort_order`,
          params,
        );
        if (!res.rows[0]) throw new NotFoundException("Folder not found");
        folder = this.toFolder(res.rows[0]);
      }

      if (movingSpace) {
        await client.query(
          `UPDATE lists SET space_id = $1 WHERE folder_id = $2`,
          [toSpace, id],
        );
        const t = await client.query(
          `SELECT id FROM tasks WHERE list_id IN (SELECT id FROM lists WHERE folder_id = $1)`,
          [id],
        );
        const taskIds = t.rows.map((r) => r.id as string);
        if (taskIds.length) {
          await client.query(
            `UPDATE tasks SET space_id = $1, updated_at = now() WHERE id = ANY($2)`,
            [toSpace, taskIds],
          );
          await remapTasksToSpace(client, taskIds, toSpace);
        }
      }

      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "folder.updated",
        entity: "folder",
        entityId: folder.id,
        data: { ...body },
      });
      return folder;
    });
  }

  async deleteFolder(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await client.query(
        `SELECT space_id FROM folders WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("Folder not found");
      await this.requireSpaceEdit(
        client,
        userId,
        role,
        owning.rows[0].space_id as string,
      );
      const res = await client.query(
        `DELETE FROM folders WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException("Folder not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "folder.deleted",
        entity: "folder",
        entityId: id,
      });
    });
  }

  // --- Lists ----------------------------------------------------------------

  async createList(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string; folderId?: string | null; color?: string },
  ): Promise<List> {
    const name = this.requireName(body?.name);
    const folderId =
      body?.folderId === undefined || body.folderId === null
        ? null
        : body.folderId;
    const color =
      body?.color === undefined || body.color === null
        ? null
        : this.validColor(body.color);

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireSpaceEdit(client, userId, role, spaceId);
      if (folderId) await this.assertFolderInSpace(client, folderId, spaceId);
      const nextOrder = await this.containerNextOrder(client, spaceId, folderId);
      const res = await client.query(
        `INSERT INTO lists (workspace_id, space_id, folder_id, name, color, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, space_id, folder_id, name, color, archived, sort_order`,
        [workspaceId, spaceId, folderId, name, color, nextOrder, userId],
      );
      const list = this.toList(res.rows[0]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "list.created",
        entity: "list",
        entityId: list.id,
        data: { name: list.name, spaceId, folderId },
      });
      return list;
    });
  }

  async updateList(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: {
      name?: string;
      color?: string | null;
      archived?: boolean;
      folderId?: string | null;
      /** Move the list (and all its tasks) to another space. */
      spaceId?: string;
    },
  ): Promise<List> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const current = await client.query(
        `SELECT id, space_id, folder_id, name, color, archived, sort_order
         FROM lists WHERE id = $1`,
        [id],
      );
      if (!current.rows[0]) throw new NotFoundException("List not found");
      const fromSpace = current.rows[0].space_id as string;
      await this.requireSpaceEdit(client, userId, role, fromSpace);

      // Cross-space move: need edit on the destination space too. The list
      // lands at the destination's root unless a folder in THAT space is given.
      const toSpace = body?.spaceId ?? fromSpace;
      const movingSpace = toSpace !== fromSpace;
      if (movingSpace) {
        await this.requireSpaceEdit(client, userId, role, toSpace);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (body?.name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(this.requireName(body.name));
      }
      if (body?.color !== undefined) {
        sets.push(`color = $${i++}`);
        params.push(
          body.color === null ? null : this.validColor(body.color),
        );
      }
      if (body?.archived !== undefined) {
        sets.push(`archived = $${i++}`);
        params.push(body.archived === true);
      }
      if (movingSpace) {
        sets.push(`space_id = $${i++}`);
        params.push(toSpace);
      }
      // Folder is validated against the DESTINATION space. On a space move with
      // no folder given, reset to root (an old-space folder can't carry over).
      if (body?.folderId !== undefined || movingSpace) {
        const target = body?.folderId ?? null;
        if (target !== null) {
          await this.assertFolderInSpace(client, target, toSpace);
        }
        sets.push(`folder_id = $${i++}`);
        params.push(target);
      }

      let list: List;
      if (sets.length === 0) {
        list = this.toList(current.rows[0]);
      } else {
        params.push(id);
        const res = await client.query(
          `UPDATE lists SET ${sets.join(", ")}
           WHERE id = $${i}
           RETURNING id, space_id, folder_id, name, color, archived, sort_order`,
          params,
        );
        list = this.toList(res.rows[0]);
      }

      // Carry the list's tasks into the new space and reconcile their
      // space-scoped attributes (status/type/tags/fields).
      if (movingSpace) {
        const t = await client.query(
          `SELECT id FROM tasks WHERE list_id = $1`,
          [id],
        );
        const taskIds = t.rows.map((r) => r.id as string);
        if (taskIds.length) {
          await client.query(
            `UPDATE tasks SET space_id = $1, updated_at = now() WHERE id = ANY($2)`,
            [toSpace, taskIds],
          );
          await remapTasksToSpace(client, taskIds, toSpace);
        }
      }

      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "list.updated",
        entity: "list",
        entityId: list.id,
        data: { ...body },
      });
      return list;
    });
  }

  async deleteList(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const owning = await client.query(
        `SELECT space_id FROM lists WHERE id = $1`,
        [id],
      );
      if (!owning.rows[0]) throw new NotFoundException("List not found");
      await this.requireSpaceEdit(
        client,
        userId,
        role,
        owning.rows[0].space_id as string,
      );
      const res = await client.query(
        `DELETE FROM lists WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException("List not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "list.deleted",
        entity: "list",
        entityId: id,
      });
    });
  }

  /** List page breadcrumb: the list, its space (subset), and its folder (or null). */
  async listDetail(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<{
    list: List;
    space: {
      id: string;
      name: string;
      color: string;
      icon: string | null;
      myPermission: Permission;
    };
    folder: { id: string; name: string } | null;
  }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const listRes = await client.query(
        `SELECT id, space_id, folder_id, name, color, archived, sort_order
         FROM lists WHERE id = $1`,
        [id],
      );
      if (!listRes.rows[0]) throw new NotFoundException("List not found");
      const list = this.toList(listRes.rows[0]);

      // The list is only reachable if its owning space is visible.
      const perm = await this.access.spacePermission(
        client,
        userId,
        role,
        list.spaceId,
      );
      if (perm === "none") throw new NotFoundException("List not found");

      const spaceRes = await client.query(
        `SELECT id, name, color, icon FROM spaces WHERE id = $1`,
        [list.spaceId],
      );
      const s = spaceRes.rows[0];
      const space = {
        id: s.id as string,
        name: s.name as string,
        color: s.color as string,
        icon: (s.icon as string | null) ?? null,
        myPermission: perm,
      };

      let folder: { id: string; name: string } | null = null;
      if (list.folderId) {
        const folderRes = await client.query(
          `SELECT id, name FROM folders WHERE id = $1`,
          [list.folderId],
        );
        if (folderRes.rows[0]) {
          folder = {
            id: folderRes.rows[0].id as string,
            name: folderRes.rows[0].name as string,
          };
        }
      }
      return { list, space, folder };
    });
  }

  // --- Reorder --------------------------------------------------------------

  async reorderSpaces(
    workspaceId: string,
    userId: string,
    role: Role,
    ids: string[],
  ): Promise<void> {
    this.assertIdArray(ids);
    if (ids.length === 0) return;
    // Reordering the sidebar's top level is a workspace-admin action.
    if (role !== "owner" && role !== "admin") {
      throw new ForbiddenException("Only an admin can reorder spaces");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await client.query(
        `UPDATE spaces AS s SET sort_order = v.ord
         FROM (SELECT unnest($1::uuid[]) AS id,
                      generate_subscripts($1::uuid[], 1) - 1 AS ord) AS v
         WHERE s.id = v.id`,
        [ids],
      );
    });
  }

  async reorderFolders(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    ids: string[],
  ): Promise<void> {
    this.assertIdArray(ids);
    if (ids.length === 0) return;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireSpaceEdit(client, userId, role, spaceId);
      await client.query(
        `UPDATE folders AS f SET sort_order = v.ord
         FROM (SELECT unnest($1::uuid[]) AS id,
                      generate_subscripts($1::uuid[], 1) - 1 AS ord) AS v
         WHERE f.id = v.id AND f.space_id = $2`,
        [ids, spaceId],
      );
    });
  }

  async reorderLists(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    folderId: string | null,
    ids: string[],
  ): Promise<void> {
    this.assertIdArray(ids);
    if (ids.length === 0) return;
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireSpaceEdit(client, userId, role, spaceId);
      await client.query(
        `UPDATE lists AS l SET sort_order = v.ord
         FROM (SELECT unnest($1::uuid[]) AS id,
                      generate_subscripts($1::uuid[], 1) - 1 AS ord) AS v
         WHERE l.id = v.id AND l.space_id = $2
           AND l.folder_id IS NOT DISTINCT FROM $3`,
        [ids, spaceId, folderId],
      );
    });
  }

  // --- Internal helpers -----------------------------------------------------

  private async nextOrder(
    client: PoolClient,
    sql: string,
    params: unknown[],
  ): Promise<number> {
    const res = await client.query(sql, params);
    return res.rows[0].n as number;
  }

  private async containerNextOrder(
    client: PoolClient,
    spaceId: string,
    folderId: string | null,
  ): Promise<number> {
    const res = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
       FROM lists
       WHERE space_id = $1 AND folder_id IS NOT DISTINCT FROM $2`,
      [spaceId, folderId],
    );
    return res.rows[0].n as number;
  }

  private async assertFolderInSpace(
    client: PoolClient,
    folderId: string,
    spaceId: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT id FROM folders WHERE id = $1 AND space_id = $2`,
      [folderId, spaceId],
    );
    if (!res.rows[0]) {
      throw new BadRequestException(
        "folderId must reference a folder in this space",
      );
    }
  }

  private assertIdArray(ids: unknown): asserts ids is string[] {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
      throw new BadRequestException("ids must be an array of strings");
    }
  }
}
