import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { DbService } from "../db/db.service";

export interface SearchResults {
  tasks: {
    id: string;
    title: string;
    subtitle: string;
    listId: string;
    spaceId: string;
  }[];
  lists: { id: string; name: string; spaceId: string; spaceName: string }[];
  spaces: { id: string; name: string; icon: string | null }[];
  docs: { id: string; name: string; icon: string }[];
  goals: { id: string; name: string }[];
  whiteboards: { id: string; name: string }[];
  channels: { id: string; name: string }[];
}

/** An empty grouped result (used for a blank query, before any DB work). */
function emptyResults(): SearchResults {
  return {
    tasks: [],
    lists: [],
    spaces: [],
    docs: [],
    goals: [],
    whiteboards: [],
    channels: [],
  };
}

/**
 * Module 14: Universal search.
 *
 * A single grouped lookup across the caller's VISIBLE surface: tasks, lists
 * and spaces are confined to the spaces AccessService says the caller can see
 * (owner/admin -> all; member -> public + shared; guest -> shared only), and
 * workspace-wide surfaces (goals, unattached whiteboards, channels the caller
 * belongs to, unattached public docs) are added for members. Search is a
 * members-only surface — guests are refused outright (403), matching Chat and
 * the M14 test contract.
 *
 * Each group is a small independent query capped at `limit`; there is no
 * per-row fan-out (no N+1). Matching is case-insensitive substring (ILIKE)
 * on the primary name, newest-updated first.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  private clampLimit(limit: number | undefined): number {
    const n = typeof limit === "number" && Number.isFinite(limit) ? limit : 8;
    return Math.min(Math.max(Math.trunc(n), 1), 25);
  }

  async search(
    workspaceId: string,
    userId: string,
    role: Role,
    q: string | undefined,
    limit: number | undefined,
  ): Promise<{ results: SearchResults }> {
    if (role === "guest") {
      throw new ForbiddenException("Search is available to members only");
    }
    const term = (q ?? "").trim();
    if (!term) return { results: emptyResults() };
    // Escape LIKE metacharacters so a caller's literal %, _ or \ match as
    // themselves (pure substring search) rather than as wildcards.
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    const lim = this.clampLimit(limit);

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = [
        ...(await this.access.visibleSpaceIds(client, userId, role)),
      ];

      const tasks = await client.query(
        `SELECT t.id, t.name, t.list_id, t.space_id, l.name AS list_name
           FROM tasks t JOIN lists l ON l.id = t.list_id
          WHERE t.archived = false
            AND t.space_id = ANY($1::uuid[])
            AND t.name ILIKE $2
          ORDER BY t.updated_at DESC
          LIMIT $3`,
        [visible, like, lim],
      );

      const lists = await client.query(
        `SELECT l.id, l.name, l.space_id, s.name AS space_name
           FROM lists l JOIN spaces s ON s.id = l.space_id
          WHERE l.archived = false
            AND l.space_id = ANY($1::uuid[])
            AND l.name ILIKE $2
          ORDER BY l.created_at DESC
          LIMIT $3`,
        [visible, like, lim],
      );

      const spaces = await client.query(
        `SELECT id, name, icon FROM spaces
          WHERE archived = false
            AND id = ANY($1::uuid[])
            AND name ILIKE $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [visible, like, lim],
      );

      // Docs: attached-to-a-visible-space, OR unattached public (members), OR
      // the caller's own unattached private docs.
      const docs = await client.query(
        `SELECT id, name, icon FROM docs
          WHERE name ILIKE $2
            AND (space_id = ANY($1::uuid[])
              OR (space_id IS NULL AND is_private = false)
              OR (space_id IS NULL AND is_private = true AND created_by = $4))
          ORDER BY updated_at DESC
          LIMIT $3`,
        [visible, like, lim, userId],
      );

      // Goals are workspace-wide (folder-scoped, not space-scoped).
      const goals = await client.query(
        `SELECT id, name FROM goals
          WHERE archived = false AND name ILIKE $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [like, lim],
      );

      // Whiteboards: unattached (workspace-wide) or in a visible space.
      const whiteboards = await client.query(
        `SELECT id, name FROM whiteboards
          WHERE name ILIKE $2
            AND (space_id IS NULL OR space_id = ANY($1::uuid[]))
          ORDER BY updated_at DESC
          LIMIT $3`,
        [visible, like, lim],
      );

      // Channels the caller actually belongs to (never DMs).
      const channels = await client.query(
        `SELECT c.id, c.name
           FROM channels c
           JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
          WHERE c.is_dm = false AND c.name ILIKE $1
          ORDER BY c.created_at DESC
          LIMIT $3`,
        [like, userId, lim],
      );

      return {
        results: {
          tasks: tasks.rows.map((r) => ({
            id: r.id as string,
            title: r.name as string,
            subtitle: r.list_name as string,
            listId: r.list_id as string,
            spaceId: r.space_id as string,
          })),
          lists: lists.rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            spaceId: r.space_id as string,
            spaceName: r.space_name as string,
          })),
          spaces: spaces.rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            icon: (r.icon as string | null) ?? null,
          })),
          docs: docs.rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            icon: r.icon as string,
          })),
          goals: goals.rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
          })),
          whiteboards: whiteboards.rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
          })),
          channels: channels.rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
          })),
        },
      };
    });
  }
}
