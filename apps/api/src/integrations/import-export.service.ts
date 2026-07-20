import { BadRequestException, Injectable } from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";
import { HierarchyService } from "../hierarchy/hierarchy.service";
import { TasksService } from "../tasks/tasks.service";

type Ctx = readonly [string, string, Role];

export interface ImportResult {
  spaceId: string;
  lists: number;
  tasks: number;
}

/**
 * Import / Export (M15). Export serializes the caller's visible hierarchy to
 * JSON, or a single list to CSV. Import ingests a CSV of tasks into a list, or
 * a board (Trello / Asana / Jira / native) into a fresh space — reusing the
 * normal Hierarchy/Tasks services so statuses, positions, RLS and audit all
 * behave exactly as interactive creation does.
 */
@Injectable()
export class ImportExportService {
  constructor(
    private readonly db: DbService,
    private readonly hierarchy: HierarchyService,
    private readonly tasks: TasksService,
  ) {}

  /** Full JSON export of everything the caller can see. */
  async exportWorkspace(workspaceId: string, userId: string, role: Role) {
    const spaces = await this.hierarchy.listSpaces(workspaceId, userId, role);
    const spaceIds = spaces.map((s) => s.id);
    const { lists, tasks } = await this.db.withWorkspace(
      workspaceId,
      userId,
      async (c) => {
        if (spaceIds.length === 0) return { lists: [], tasks: [] };
        const l = await c.query(
          `SELECT id, space_id, name FROM lists WHERE space_id = ANY($1) AND archived = false ORDER BY sort_order`,
          [spaceIds],
        );
        const t = await c.query(
          `SELECT t.id, t.list_id, t.name, t.description, t.priority, t.due_date, s.name AS status
             FROM tasks t LEFT JOIN statuses s ON s.id = t.status_id
            WHERE t.space_id = ANY($1) AND t.parent_task_id IS NULL AND t.archived = false
            ORDER BY t.position`,
          [spaceIds],
        );
        return { lists: l.rows, tasks: t.rows };
      },
    );
    return {
      exportedAt: null as string | null, // stamped by the client/response layer
      spaces: spaces.map((s) => ({
        id: s.id,
        name: s.name,
        lists: lists
          .filter((l) => l.space_id === s.id)
          .map((l) => ({
            id: l.id,
            name: l.name,
            tasks: tasks
              .filter((t) => t.list_id === l.id)
              .map((t) => ({
                name: t.name,
                description: t.description,
                status: t.status,
                priority: t.priority,
                dueDate: t.due_date,
              })),
          })),
      })),
    };
  }

  /** CSV of one list's tasks (Name, Description, Status, Priority, Due Date). */
  async exportListCsv(
    workspaceId: string,
    userId: string,
    role: Role,
    listId: string,
  ): Promise<string> {
    const cards = await this.tasks.listTasks(workspaceId, userId, role, listId);
    const header = ["Name", "Description", "Status", "Priority", "Due Date"];
    const rows = cards.map((c) =>
      [
        c.name,
        (c as { description?: string }).description ?? "",
        c.status?.name ?? "",
        c.priority ?? "",
        c.dueDate ?? "",
      ].map(csvCell),
    );
    return [header.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join(
      "\r\n",
    );
  }

  /** Create tasks in a list from CSV text. First row may be a header. */
  async importCsv(
    ctx: Ctx,
    listId: string,
    csv: string,
  ): Promise<{ tasks: number }> {
    const rows = parseCsv(csv);
    if (rows.length === 0) throw new BadRequestException("Empty CSV");
    let start = 0;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const nameCol = header.indexOf("name");
    let descCol = header.indexOf("description");
    let idxName = 0;
    if (nameCol >= 0) {
      start = 1;
      idxName = nameCol;
    } else {
      descCol = -1; // no header — treat col 0 as name only
    }
    let count = 0;
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      const name = (row[idxName] ?? "").trim();
      if (!name) continue;
      await this.tasks.createTask(...ctx, listId, {
        name,
        description: descCol >= 0 ? (row[descCol] ?? "").trim() : "",
      });
      count++;
    }
    return { tasks: count };
  }

  /**
   * Import a board into a new space. Accepts Trello board JSON, an Asana-style
   * export, a Jira issue list, or StackUp's own native shape — all normalized
   * to { name, lists:[{ name, tasks:[{ name, description }] }] }.
   */
  async importBoard(
    ctx: Ctx,
    source: string,
    data: unknown,
  ): Promise<ImportResult> {
    const board = normalizeBoard(source, data);
    const space = await this.hierarchy.createSpace(...ctx, {
      name: board.name,
    });
    let listCount = 0;
    let taskCount = 0;
    for (const list of board.lists) {
      const created = await this.hierarchy.createList(...ctx, space.id, {
        name: list.name,
      });
      listCount++;
      for (const task of list.tasks) {
        if (!task.name.trim()) continue;
        await this.tasks.createTask(...ctx, created.id, {
          name: task.name.slice(0, 500),
          description: task.description ?? "",
        });
        taskCount++;
      }
    }
    return { spaceId: space.id, lists: listCount, tasks: taskCount };
  }
}

interface NormBoard {
  name: string;
  lists: { name: string; tasks: { name: string; description?: string }[] }[];
}

function normalizeBoard(source: string, data: unknown): NormBoard {
  const d = (data ?? {}) as Record<string, unknown>;
  const src = source.toLowerCase();

  // Trello: { name, lists:[{id,name}], cards:[{name,desc,idList}] }
  if (src === "trello" || (Array.isArray(d.cards) && Array.isArray(d.lists))) {
    const lists = (d.lists as { id: string; name: string }[]) ?? [];
    const cards = (d.cards as { name: string; desc?: string; idList: string }[]) ?? [];
    return {
      name: (d.name as string) || "Imported from Trello",
      lists: lists.map((l) => ({
        name: l.name,
        tasks: cards
          .filter((c) => c.idList === l.id)
          .map((c) => ({ name: c.name, description: c.desc })),
      })),
    };
  }

  // Asana: { data:[{ name, notes, memberships:[{section:{name}}] }] } or flat list.
  if (src === "asana" || Array.isArray(d.data)) {
    const items = (d.data as {
      name: string;
      notes?: string;
      memberships?: { section?: { name?: string } }[];
    }[]) ?? [];
    const bySection = new Map<string, { name: string; description?: string }[]>();
    for (const it of items) {
      const section = it.memberships?.[0]?.section?.name ?? "Tasks";
      const arr = bySection.get(section) ?? [];
      arr.push({ name: it.name, description: it.notes });
      bySection.set(section, arr);
    }
    return {
      name: (d.name as string) || "Imported from Asana",
      lists: [...bySection.entries()].map(([name, tasks]) => ({ name, tasks })),
    };
  }

  // Jira: { issues:[{ fields:{ summary, description, status:{name} } }] }
  if (src === "jira" || Array.isArray(d.issues)) {
    const issues = (d.issues as {
      fields?: { summary?: string; description?: string; status?: { name?: string } };
    }[]) ?? [];
    const byStatus = new Map<string, { name: string; description?: string }[]>();
    for (const is of issues) {
      const status = is.fields?.status?.name ?? "Backlog";
      const arr = byStatus.get(status) ?? [];
      arr.push({
        name: is.fields?.summary ?? "Untitled",
        description: is.fields?.description,
      });
      byStatus.set(status, arr);
    }
    return {
      name: (d.name as string) || "Imported from Jira",
      lists: [...byStatus.entries()].map(([name, tasks]) => ({ name, tasks })),
    };
  }

  // Native StackUp shape: { name, lists:[{ name, tasks:[{ name, description }] }] }
  if (Array.isArray(d.lists)) {
    const lists = d.lists as {
      name?: string;
      tasks?: { name?: string; description?: string }[];
    }[];
    return {
      name: (d.name as string) || "Imported board",
      lists: lists.map((l) => ({
        name: l.name || "List",
        tasks: (l.tasks ?? []).map((t) => ({
          name: t.name || "Task",
          description: t.description,
        })),
      })),
    };
  }

  throw new BadRequestException("Unrecognized board format");
}

/* ---- CSV helpers --------------------------------------------------- */

function csvCell(value: string): string {
  const v = value ?? "";
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** RFC-4180-ish CSV parser (handles quotes, embedded commas and newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}
