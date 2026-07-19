import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService, permAtLeast } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { EventsService } from "../events/events.service";
import {
  optionalName,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  requireUuid,
} from "../tasks/tasks.support";
import { sanitizeContent } from "./docs.support";

/** A Doc: container of nested Pages, workspace-wide or attached to a Space. */
export interface Doc {
  id: string;
  name: string;
  icon: string;
  spaceId: string | null;
  spaceName: string | null;
  isPrivate: boolean;
  createdBy: string | null;
  pageCount: number;
  updatedAt: string;
}

/** Page summary as returned in a doc's flat page list (no content). */
export interface PageSummary {
  id: string;
  parentPageId: string | null;
  title: string;
  position: number;
  updatedAt: string;
}

/** Full page detail, content included. */
export interface Page extends PageSummary {
  docId: string;
  content: string;
  updatedBy: string | null;
}

/** Personal notepad entry, strictly scoped to its owner. */
export interface Note {
  id: string;
  content: string;
  updatedAt: string;
}

const DOC_SELECT = `
  SELECT d.id, d.name, d.icon, d.space_id, d.is_private, d.created_by,
         d.updated_at, s.name AS space_name,
         (SELECT count(*)::int FROM doc_pages p WHERE p.doc_id = d.id)
           AS page_count
  FROM docs d LEFT JOIN spaces s ON s.id = d.space_id`;

const PAGE_COLUMNS =
  "id, doc_id, parent_page_id, title, content, position, updated_at, updated_by";

/** A doc row plus the caller's resolved rights on it. */
interface DocAccess {
  doc: Doc;
  editable: boolean;
}

/**
 * Module 7: Docs & wikis (nested pages) + personal Notepad.
 *
 * Visibility rules for a doc:
 *  - space_id set        -> follows the Space: visible iff the space is
 *                           visible to the caller (AccessService), editable
 *                           iff space permission >= edit.
 *  - unattached, public  -> visible & editable by every non-guest member.
 *                           M7 rule: GUESTS DO NOT SEE unattached docs at
 *                           all — they only reach docs via a shared space.
 *  - unattached, private -> visible/editable ONLY by created_by. Admins and
 *                           owners do NOT see others' private docs (like
 *                           ClickUp private docs).
 *
 * An invisible doc always reads as 404 (never leak existence).
 */
@Injectable()
export class DocsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  // --- helpers --------------------------------------------------------------

  private toDoc(r: Record<string, unknown>): Doc {
    return {
      id: r.id as string,
      name: r.name as string,
      icon: r.icon as string,
      spaceId: (r.space_id as string | null) ?? null,
      spaceName: (r.space_name as string | null) ?? null,
      isPrivate: r.is_private as boolean,
      createdBy: (r.created_by as string | null) ?? null,
      pageCount: r.page_count as number,
      updatedAt: r.updated_at as string,
    };
  }

  private toPageSummary(r: Record<string, unknown>): PageSummary {
    return {
      id: r.id as string,
      parentPageId: (r.parent_page_id as string | null) ?? null,
      title: r.title as string,
      position: r.position as number,
      updatedAt: r.updated_at as string,
    };
  }

  private toPage(r: Record<string, unknown>): Page {
    return {
      ...this.toPageSummary(r),
      docId: r.doc_id as string,
      content: r.content as string,
      updatedBy: (r.updated_by as string | null) ?? null,
    };
  }

  private toNote(r: Record<string, unknown>): Note {
    return {
      id: r.id as string,
      content: r.content as string,
      updatedAt: r.updated_at as string,
    };
  }

  /**
   * Load a doc and resolve the caller's rights per the M7 rules above.
   * Not visible (including "does not exist") -> 404.
   */
  private async requireDocVisible(
    client: PoolClient,
    userId: string,
    role: Role,
    docId: string,
  ): Promise<DocAccess> {
    const res = await client.query(`${DOC_SELECT} WHERE d.id = $1`, [docId]);
    if (!res.rows[0]) throw new NotFoundException("Doc not found");
    const doc = this.toDoc(res.rows[0]);

    if (doc.spaceId !== null) {
      // Attached: follows the space (404 when invisible via the helper).
      const perm = await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        doc.spaceId,
      );
      return { doc, editable: permAtLeast(perm, "edit") };
    }
    if (doc.isPrivate) {
      // Private unattached doc: creator ONLY — admins/owners do not see it.
      if (doc.createdBy !== userId) throw new NotFoundException("Doc not found");
      return { doc, editable: true };
    }
    // Public unattached doc: all non-guest members. M7 rule: guests never
    // see unattached docs (they only reach docs through a shared space).
    if (role === "guest") throw new NotFoundException("Doc not found");
    return { doc, editable: true };
  }

  /** requireDocVisible + editability (403 when visible but read-only). */
  private async requireDocEditable(
    client: PoolClient,
    userId: string,
    role: Role,
    docId: string,
  ): Promise<Doc> {
    const { doc, editable } = await this.requireDocVisible(
      client,
      userId,
      role,
      docId,
    );
    if (!editable) {
      throw new ForbiddenException("You need edit access on this doc");
    }
    return doc;
  }

  // --- docs -----------------------------------------------------------------

  /** All docs visible to the caller, most recently updated first. */
  async listDocs(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<Doc[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visibleSpaces = await this.access.visibleSpaceIds(
        client,
        userId,
        role,
      );
      const res = await client.query(`${DOC_SELECT} ORDER BY d.updated_at DESC`);
      return res.rows
        .filter((r) => {
          const spaceId = r.space_id as string | null;
          if (spaceId !== null) return visibleSpaces.has(spaceId);
          if (r.is_private as boolean) return r.created_by === userId;
          return role !== "guest"; // M7: guests never see unattached docs
        })
        .map((r) => this.toDoc(r));
    });
  }

  async createDoc(
    workspaceId: string,
    userId: string,
    role: Role,
    body: { name?: string; icon?: string; spaceId?: string; isPrivate?: boolean },
  ): Promise<Doc> {
    if (role === "guest") {
      throw new ForbiddenException("Guests cannot create docs");
    }
    const name = requireName(body?.name);
    const icon = this.validIcon(body?.icon) ?? "📄";
    const isPrivate = body?.isPrivate === true;
    const spaceId =
      body?.spaceId === undefined || body?.spaceId === null
        ? null
        : requireUuid(body.spaceId, "spaceId");

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      if (spaceId !== null) {
        await requireSpaceEdit(this.access, client, userId, role, spaceId);
      }
      const ins = await client.query(
        `INSERT INTO docs (workspace_id, space_id, name, icon, is_private, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [workspaceId, spaceId, name, icon, isPrivate, userId],
      );
      const docId = ins.rows[0].id as string;
      // Every doc starts with one root page titled like the doc.
      await client.query(
        `INSERT INTO doc_pages (workspace_id, doc_id, title, position, updated_by)
         VALUES ($1, $2, $3, 0, $4)`,
        [workspaceId, docId, name, userId],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "doc.created",
        entity: "doc",
        entityId: docId,
        data: { name, spaceId, isPrivate },
      });
      const res = await client.query(`${DOC_SELECT} WHERE d.id = $1`, [docId]);
      return this.toDoc(res.rows[0]);
    });
  }

  /** Doc detail + its flat page list (client builds the tree). */
  async getDoc(
    workspaceId: string,
    userId: string,
    role: Role,
    docId: string,
  ): Promise<{ doc: Doc; pages: PageSummary[] }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { doc } = await this.requireDocVisible(client, userId, role, docId);
      const res = await client.query(
        `SELECT id, parent_page_id, title, position, updated_at
         FROM doc_pages WHERE doc_id = $1
         ORDER BY (parent_page_id IS NOT NULL), parent_page_id, position, created_at`,
        [docId],
      );
      return { doc, pages: res.rows.map((r) => this.toPageSummary(r)) };
    });
  }

  async updateDoc(
    workspaceId: string,
    userId: string,
    role: Role,
    docId: string,
    body: {
      name?: string;
      icon?: string;
      spaceId?: string | null;
      isPrivate?: boolean;
    },
  ): Promise<Doc> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireDocEditable(client, userId, role, docId);

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      const name = optionalName(body?.name);
      if (name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(name);
      }
      const icon = this.validIcon(body?.icon);
      if (icon !== undefined) {
        sets.push(`icon = $${i++}`);
        params.push(icon);
      }
      if (body?.isPrivate !== undefined) {
        sets.push(`is_private = $${i++}`);
        params.push(body.isPrivate === true);
      }
      if (body?.spaceId !== undefined) {
        const spaceId =
          body.spaceId === null ? null : requireUuid(body.spaceId, "spaceId");
        // Attaching (or moving) requires edit on the TARGET space too.
        if (spaceId !== null) {
          await requireSpaceEdit(this.access, client, userId, role, spaceId);
        }
        sets.push(`space_id = $${i++}`);
        params.push(spaceId);
      }

      if (sets.length > 0) {
        sets.push(`updated_at = now()`);
        params.push(docId);
        await client.query(
          `UPDATE docs SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "doc.updated",
        entity: "doc",
        entityId: docId,
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(icon !== undefined ? { icon } : {}),
          ...(body?.isPrivate !== undefined
            ? { isPrivate: body.isPrivate === true }
            : {}),
          ...(body?.spaceId !== undefined ? { spaceId: body.spaceId } : {}),
        },
      });
      const res = await client.query(`${DOC_SELECT} WHERE d.id = $1`, [docId]);
      return this.toDoc(res.rows[0]);
    });
  }

  /** Delete a doc (pages cascade). Creator or workspace admin/owner only. */
  async removeDoc(
    workspaceId: string,
    userId: string,
    role: Role,
    docId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const { doc } = await this.requireDocVisible(client, userId, role, docId);
      const isAdmin = role === "owner" || role === "admin";
      if (doc.createdBy !== userId && !isAdmin) {
        throw new ForbiddenException(
          "Only the doc's creator or a workspace admin can delete it",
        );
      }
      await client.query(`DELETE FROM docs WHERE id = $1`, [docId]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "doc.deleted",
        entity: "doc",
        entityId: docId,
        data: { name: doc.name },
      });
    });
  }

  // --- pages ----------------------------------------------------------------

  async getPage(
    workspaceId: string,
    userId: string,
    role: Role,
    pageId: string,
  ): Promise<Page> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const page = await this.loadPage(client, pageId);
      await this.requireDocVisible(client, userId, role, page.docId);
      return page;
    });
  }

  async createPage(
    workspaceId: string,
    userId: string,
    role: Role,
    docId: string,
    body: { title?: string; parentPageId?: string },
  ): Promise<Page> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.requireDocEditable(client, userId, role, docId);
      const title = optionalName(body?.title, "title") ?? "Untitled";
      const parentPageId =
        body?.parentPageId === undefined || body?.parentPageId === null
          ? null
          : requireUuid(body.parentPageId, "parentPageId");
      if (parentPageId !== null) {
        const parent = await this.loadPage(client, parentPageId);
        if (parent.docId !== docId) {
          throw new BadRequestException("parentPageId must be a page of this doc");
        }
      }
      // position = max+1 among siblings (same parent, NULL-safe).
      const posRes = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n
         FROM doc_pages
         WHERE doc_id = $1 AND parent_page_id IS NOT DISTINCT FROM $2`,
        [docId, parentPageId],
      );
      const res = await client.query(
        `INSERT INTO doc_pages
           (workspace_id, doc_id, parent_page_id, title, position, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${PAGE_COLUMNS}`,
        [workspaceId, docId, parentPageId, title, posRes.rows[0].n, userId],
      );
      return this.toPage(res.rows[0]);
    });
  }

  async updatePage(
    workspaceId: string,
    userId: string,
    role: Role,
    pageId: string,
    body: {
      title?: string;
      content?: string;
      parentPageId?: string | null;
      position?: number;
    },
  ): Promise<Page> {
    const page = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (client) => {
        const current = await this.loadPage(client, pageId);
        await this.requireDocEditable(client, userId, role, current.docId);

        const sets: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        const title = optionalName(body?.title, "title");
        if (title !== undefined) {
          sets.push(`title = $${i++}`);
          params.push(title);
        }
        if (body?.content !== undefined) {
          if (typeof body.content !== "string") {
            throw new BadRequestException("content must be a string");
          }
          sets.push(`content = $${i++}`);
          params.push(sanitizeContent(body.content));
        }
        if (body?.parentPageId !== undefined) {
          const parentPageId =
            body.parentPageId === null
              ? null
              : requireUuid(body.parentPageId, "parentPageId");
          await this.assertValidParent(client, current, parentPageId);
          sets.push(`parent_page_id = $${i++}`);
          params.push(parentPageId);
        }
        if (body?.position !== undefined) {
          if (!Number.isInteger(body.position) || body.position < 0) {
            throw new BadRequestException("position must be an integer >= 0");
          }
          sets.push(`position = $${i++}`);
          params.push(body.position);
        }
        if (sets.length === 0) return current;

        sets.push(`updated_by = $${i++}`, `updated_at = now()`);
        params.push(userId, pageId);
        const res = await client.query(
          `UPDATE doc_pages SET ${sets.join(", ")}
           WHERE id = $${i}
           RETURNING ${PAGE_COLUMNS}`,
          params,
        );
        // Any page edit bumps the doc so /docs sorts by real recency.
        await client.query(`UPDATE docs SET updated_at = now() WHERE id = $1`, [
          current.docId,
        ]);
        return this.toPage(res.rows[0]);
      },
    );
    this.events.publish(workspaceId, {
      type: "doc.changed",
      payload: { docId: page.docId, pageId: page.id },
    });
    return page;
  }

  /** Delete a page (children cascade); a doc's LAST page cannot go -> 400. */
  async removePage(
    workspaceId: string,
    userId: string,
    role: Role,
    pageId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const page = await this.loadPage(client, pageId);
      await this.requireDocEditable(client, userId, role, page.docId);
      // Deleting cascades the whole subtree; refuse when that would leave
      // the doc with zero pages (a doc always keeps at least one page).
      const counts = await client.query(
        `WITH RECURSIVE subtree AS (
           SELECT id FROM doc_pages WHERE id = $1
           UNION ALL
           SELECT p.id FROM doc_pages p
             JOIN subtree s ON p.parent_page_id = s.id
         )
         SELECT (SELECT count(*) FROM subtree) AS gone,
                (SELECT count(*) FROM doc_pages WHERE doc_id = $2) AS total`,
        [pageId, page.docId],
      );
      const { gone, total } = counts.rows[0] as { gone: string; total: string };
      if (Number(gone) >= Number(total)) {
        throw new BadRequestException("Cannot delete a doc's last page");
      }
      await client.query(`DELETE FROM doc_pages WHERE id = $1`, [pageId]);
    });
  }

  // --- notepad --------------------------------------------------------------

  /** The caller's notes, newest first. Strictly user_id = token sub. */
  async listNotes(workspaceId: string, userId: string): Promise<Note[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, content, updated_at FROM notes
         WHERE user_id = $1 ORDER BY updated_at DESC, created_at DESC`,
        [userId],
      );
      return res.rows.map((r) => this.toNote(r));
    });
  }

  async createNote(
    workspaceId: string,
    userId: string,
    body: { content?: string },
  ): Promise<Note> {
    const content = this.validContent(body?.content ?? "");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `INSERT INTO notes (workspace_id, user_id, content)
         VALUES ($1, $2, $3)
         RETURNING id, content, updated_at`,
        [workspaceId, userId, content],
      );
      return this.toNote(res.rows[0]);
    });
  }

  async updateNote(
    workspaceId: string,
    userId: string,
    noteId: string,
    body: { content?: string },
  ): Promise<Note> {
    const content = this.validContent(body?.content);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // Scoped to the caller: someone else's note reads as 404, never 403.
      const res = await client.query(
        `UPDATE notes SET content = $1, updated_at = now()
         WHERE id = $2 AND user_id = $3
         RETURNING id, content, updated_at`,
        [content, noteId, userId],
      );
      if (!res.rows[0]) throw new NotFoundException("Note not found");
      return this.toNote(res.rows[0]);
    });
  }

  async removeNote(
    workspaceId: string,
    userId: string,
    noteId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id`,
        [noteId, userId],
      );
      if (!res.rows[0]) throw new NotFoundException("Note not found");
    });
  }

  // --- small validators -----------------------------------------------------

  private validIcon(icon: unknown): string | undefined {
    if (icon === undefined) return undefined;
    if (typeof icon !== "string" || !icon.trim() || icon.length > 16) {
      throw new BadRequestException("icon must be a short non-empty string");
    }
    return icon.trim();
  }

  /** Notes hold editor HTML too — run the same sanitizer before storing. */
  private validContent(content: unknown): string {
    if (typeof content !== "string") {
      throw new BadRequestException("content must be a string");
    }
    return sanitizeContent(content);
  }

  private async loadPage(client: PoolClient, pageId: string): Promise<Page> {
    const res = await client.query(
      `SELECT ${PAGE_COLUMNS} FROM doc_pages WHERE id = $1`,
      [pageId],
    );
    if (!res.rows[0]) throw new NotFoundException("Page not found");
    return this.toPage(res.rows[0]);
  }

  /**
   * A page may move under any page of the SAME doc, or to the root (null) —
   * but never under itself or one of its own descendants (cycle).
   */
  private async assertValidParent(
    client: PoolClient,
    page: Page,
    parentPageId: string | null,
  ): Promise<void> {
    if (parentPageId === null) return;
    if (parentPageId === page.id) {
      throw new BadRequestException("A page cannot be its own parent");
    }
    const parent = await this.loadPage(client, parentPageId);
    if (parent.docId !== page.docId) {
      throw new BadRequestException("parentPageId must be a page of this doc");
    }
    // Walk up from the new parent; hitting the page itself means a cycle.
    let cursor: string | null = parent.parentPageId;
    while (cursor !== null) {
      if (cursor === page.id) {
        throw new BadRequestException(
          "Cannot move a page under one of its own descendants",
        );
      }
      const res = await client.query(
        `SELECT parent_page_id FROM doc_pages WHERE id = $1`,
        [cursor],
      );
      cursor = (res.rows[0]?.parent_page_id as string | null) ?? null;
    }
  }
}
