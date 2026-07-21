import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";
import { DashboardsService } from "../dashboards/dashboards.service";
import { DocsService } from "../docs/docs.service";
import { HierarchyService } from "../hierarchy/hierarchy.service";
import { TasksService } from "../tasks/tasks.service";

export const SHARE_ENTITY_TYPES = [
  "space",
  "folder",
  "list",
  "task",
  "doc",
  "dashboard",
] as const;
export type ShareEntityType = (typeof SHARE_ENTITY_TYPES)[number];
export type SharePermission = "view" | "comment";

export interface ShareSummary {
  id: string;
  entityType: ShareEntityType;
  entityId: string;
  token: string;
  permission: SharePermission;
  createdAt: string;
}

/** Normalized read-only payload the public page renders. */
export interface SharedView {
  entityType: ShareEntityType;
  permission: SharePermission;
  workspaceName: string;
  title: string;
  // Exactly one of these is populated, matching entityType.
  task?: unknown;
  list?: { name: string; tasks: unknown[] };
  doc?: { name: string; pages: unknown[] };
  dashboard?: { name: string; cards: unknown[] };
  overview?: {
    kind: "space" | "folder";
    name: string;
    folders: { id: string; name: string }[];
    lists: { id: string; name: string }[];
  };
}

function isEntityType(v: unknown): v is ShareEntityType {
  return SHARE_ENTITY_TYPES.includes(v as ShareEntityType);
}

/**
 * Module 26 — public share links.
 *
 * A member creates a link for one entity; anyone with the link can then read
 * that entity (no account needed). The read is done by loading the entity **as
 * the user who shared it** — same workspace + user + role context every
 * authenticated read uses — so the public viewer sees exactly what the sharer
 * can see, and all the existing visibility/permission logic is reused rather
 * than re-implemented. The token itself is unguessable and resolved under the
 * fail-closed `app.share_token` RLS context.
 */
@Injectable()
export class SharesService {
  constructor(
    private readonly db: DbService,
    private readonly tasks: TasksService,
    private readonly docs: DocsService,
    private readonly dashboards: DashboardsService,
    private readonly hierarchy: HierarchyService,
  ) {}

  /** Create (or re-activate) the public link for an entity. Members only. */
  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { entityType?: string; entityId?: string; permission?: string },
  ): Promise<ShareSummary> {
    if (role === "guest") {
      throw new ForbiddenException("Guests cannot create share links");
    }
    const entityType = body?.entityType;
    const entityId = (body?.entityId ?? "").trim();
    if (!isEntityType(entityType)) {
      throw new BadRequestException("Unknown entity type");
    }
    if (!entityId) throw new BadRequestException("entityId is required");
    const permission: SharePermission =
      body?.permission === "comment" ? "comment" : "view";

    // Verify the caller can actually see the entity before exposing it — this
    // reuses each read's own visibility checks and 404s on anything invisible.
    await this.loadEntity(workspaceId, userId, role, entityType, entityId);

    const token = "share_" + randomBytes(24).toString("hex");
    const row = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        `INSERT INTO public_shares
           (workspace_id, entity_type, entity_id, token, permission, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, entity_type, entity_id)
           DO UPDATE SET permission = EXCLUDED.permission, revoked_at = NULL
         RETURNING id, entity_type, entity_id, token, permission, created_at`,
        [workspaceId, entityType, entityId, token, permission, userId],
      );
      return res.rows[0];
    });
    return toSummary(row);
  }

  /** The current live link for an entity, or null if none. */
  async forEntity(
    workspaceId: string,
    userId: string,
    entityType: string,
    entityId: string,
  ): Promise<ShareSummary | null> {
    if (!isEntityType(entityType)) return null;
    return this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        `SELECT id, entity_type, entity_id, token, permission, created_at
         FROM public_shares
         WHERE entity_type = $1 AND entity_id = $2 AND revoked_at IS NULL`,
        [entityType, entityId],
      );
      return res.rows[0] ? toSummary(res.rows[0]) : null;
    });
  }

  /** Revoke a link so it stops working immediately. */
  async revoke(workspaceId: string, userId: string, id: string): Promise<void> {
    const n = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const res = await c.query(
        "UPDATE public_shares SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
        [id],
      );
      return res.rowCount ?? 0;
    });
    if (n === 0) throw new NotFoundException("Share link not found");
  }

  /** PUBLIC: resolve a token to its entity's read-only content. */
  async resolve(token: string): Promise<SharedView> {
    if (typeof token !== "string" || !token) {
      throw new NotFoundException("This link is invalid or has been revoked");
    }
    // Read the one matching, non-revoked share row under the token RLS context.
    const share = await this.db.withShareToken(token, async (c) => {
      const res = await c.query(
        `SELECT workspace_id, entity_type, entity_id, permission, created_by
         FROM public_shares WHERE token = $1`,
        [token],
      );
      return res.rows[0] as
        | {
            workspace_id: string;
            entity_type: ShareEntityType;
            entity_id: string;
            permission: SharePermission;
            created_by: string | null;
          }
        | undefined;
    });
    if (!share) {
      throw new NotFoundException("This link is invalid or has been revoked");
    }

    // Resolve the sharer's identity + role so we can load the entity exactly as
    // they see it. Fall back to the workspace owner if the sharer is gone.
    const ctx = await this.db.withWorkspaceSystem(
      share.workspace_id,
      async (c) => {
        const wsRes = await c.query(
          "SELECT name FROM workspaces WHERE id = $1",
          [share.workspace_id],
        );
        const workspaceName = (wsRes.rows[0]?.name as string) ?? "Workspace";
        let user = share.created_by;
        let mRes = user
          ? await c.query(
              "SELECT user_id, role FROM memberships WHERE user_id = $1",
              [user],
            )
          : { rows: [] as { user_id: string; role: Role }[] };
        if (!mRes.rows[0]) {
          mRes = await c.query(
            "SELECT user_id, role FROM memberships WHERE role = 'owner' LIMIT 1",
          );
        }
        const m = mRes.rows[0] as { user_id: string; role: Role } | undefined;
        if (!m) throw new NotFoundException("This link is no longer available");
        user = m.user_id;
        return { workspaceName, userId: m.user_id, role: m.role };
      },
    );

    const content = await this.loadEntity(
      share.workspace_id,
      ctx.userId,
      ctx.role,
      share.entity_type,
      share.entity_id,
    );

    return {
      entityType: share.entity_type,
      permission: share.permission,
      workspaceName: ctx.workspaceName,
      ...content,
    };
  }

  /**
   * Load one entity's content as (userId, role). Reuses the same read methods
   * the authenticated app uses, so visibility rules are enforced identically.
   * Returns the SharedView fields for that entity (minus the share metadata).
   */
  private async loadEntity(
    workspaceId: string,
    userId: string,
    role: Role,
    entityType: ShareEntityType,
    entityId: string,
  ): Promise<Omit<SharedView, "entityType" | "permission" | "workspaceName">> {
    switch (entityType) {
      case "task": {
        const task = await this.tasks.getTask(workspaceId, userId, role, entityId);
        return { title: (task as { name?: string }).name ?? "Task", task };
      }
      case "list": {
        const [name, tasks] = await Promise.all([
          this.entityName(workspaceId, "lists", entityId, "List"),
          this.tasks.listTasks(workspaceId, userId, role, entityId),
        ]);
        return { title: name, list: { name, tasks } };
      }
      case "doc": {
        const { doc, pages } = await this.docs.getDoc(
          workspaceId,
          userId,
          role,
          entityId,
        );
        const full = await Promise.all(
          pages.map((p) =>
            this.docs.getPage(workspaceId, userId, role, (p as { id: string }).id),
          ),
        );
        const name = (doc as { name?: string }).name ?? "Doc";
        return { title: name, doc: { name, pages: full } };
      }
      case "dashboard": {
        const { dashboard, cards } = await this.dashboards.getDashboard(
          workspaceId,
          userId,
          entityId,
        );
        const name = (dashboard as { name?: string }).name ?? "Dashboard";
        return { title: name, dashboard: { name, cards } };
      }
      case "space":
      case "folder":
        return this.loadOverview(workspaceId, userId, role, entityType, entityId);
    }
  }

  /** Space/folder overview: its name + the folders and lists inside it. */
  private async loadOverview(
    workspaceId: string,
    userId: string,
    role: Role,
    kind: "space" | "folder",
    entityId: string,
  ): Promise<Omit<SharedView, "entityType" | "permission" | "workspaceName">> {
    // tree() already applies the caller's visibility, so the shared overview
    // can only include what the sharer can see.
    const tree = await this.hierarchy.tree(workspaceId, userId, role);
    type L = { id: string; name: string; folderId?: string | null };
    type F = { id: string; name: string; lists?: L[] };
    type S = { id: string; name: string; folders?: F[]; lists?: L[] };
    const spaces = (tree as { spaces?: S[] }).spaces ?? [];
    if (kind === "space") {
      const sp = spaces.find((s) => s.id === entityId);
      if (!sp) throw new NotFoundException("Space not found");
      const folders = (sp.folders ?? []).map((f) => ({ id: f.id, name: f.name }));
      const lists: { id: string; name: string }[] = [
        ...(sp.lists ?? []).map((l) => ({ id: l.id, name: l.name })),
        ...(sp.folders ?? []).flatMap((f) =>
          (f.lists ?? []).map((l) => ({ id: l.id, name: l.name })),
        ),
      ];
      return { title: sp.name, overview: { kind, name: sp.name, folders, lists } };
    }
    for (const sp of spaces) {
      const fol = (sp.folders ?? []).find((f) => f.id === entityId);
      if (fol) {
        const lists = (fol.lists ?? []).map((l) => ({ id: l.id, name: l.name }));
        return {
          title: fol.name,
          overview: { kind, name: fol.name, folders: [], lists },
        };
      }
    }
    throw new NotFoundException("Folder not found");
  }

  /** Look up a bare entity name under a workspace-system context. */
  private async entityName(
    workspaceId: string,
    table: "lists",
    id: string,
    fallback: string,
  ): Promise<string> {
    return this.db.withWorkspaceSystem(workspaceId, async (c) => {
      const res = await c.query(`SELECT name FROM ${table} WHERE id = $1`, [id]);
      return (res.rows[0]?.name as string) ?? fallback;
    });
  }
}

function toSummary(row: {
  id: string;
  entity_type: string;
  entity_id: string;
  token: string;
  permission: string;
  created_at: string;
}): ShareSummary {
  return {
    id: row.id,
    entityType: row.entity_type as ShareEntityType,
    entityId: row.entity_id,
    token: row.token,
    permission: row.permission as SharePermission,
    createdAt: row.created_at,
  };
}
