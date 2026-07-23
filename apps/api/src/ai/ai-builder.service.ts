import { Injectable } from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { AiProvider } from "./ai.provider";
import { DbService } from "../db/db.service";
import { HierarchyService } from "../hierarchy/hierarchy.service";
import { TasksService } from "../tasks/tasks.service";
import { DocsService } from "../docs/docs.service";
import { FormsService } from "../forms/forms.service";
import { permAtLeast } from "../access/access.service";

/**
 * AI Builder — turns a natural-language brief into real StackUp work, and is
 * aware of the workspace that already exists.
 *
 * Instead of always inventing new spaces, the planner is given the current
 * hierarchy (editable spaces + their lists) and decides, per group of tasks,
 * WHERE the work belongs:
 *   - add to an existing list,
 *   - a new list inside an existing space,
 *   - or a brand-new space + list.
 * When it can't tell, it makes a best guess and flags `needsChoice` so the UI
 * asks the user before anything is built.
 *
 * Two steps, no surprises:
 *   1. plan(prompt)  → a BuildPlan of destinations (no writes).
 *   2. build(plan)   → executes through the ordinary create services, so RLS,
 *      role capabilities and plan limits all still apply.
 */

const MAX_TARGETS = 8;
const MAX_TASKS_PER_TARGET = 20;
const MAX_TOTAL_TASKS = 100;
const MAX_DOCS_PER_TARGET = 3;
const MAX_CONTEXT_SPACES = 40;
const MAX_CONTEXT_LISTS = 20;

const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);

export interface PlanTask {
  name: string;
  description?: string;
  priority?: "urgent" | "high" | "normal" | "low";
  dueInDays?: number;
  /** Workspace member ids to assign (validated against the context). */
  assigneeIds?: string[];
}

export interface PlanDoc {
  name: string;
  icon?: string;
  content?: string;
}

/** Where a target's space lives: an existing one, or a request to create it. */
export type SpaceRef =
  | { existingId: string }
  | { create: true; name: string; icon?: string };

/** Where a target's list lives: an existing one, or a request to create it. */
export type ListRef =
  | { existingId: string }
  | { create: true; name: string; folderId?: string };

/** One destination + the work that goes there. */
export interface PlanTarget {
  space: SpaceRef;
  list: ListRef;
  tasks: PlanTask[];
  docs?: PlanDoc[];
  /** The planner was unsure where this belongs — the UI must confirm. */
  needsChoice?: boolean;
  /** Short human note, e.g. "matches your existing “Web” list". */
  note?: string;
}

export interface BuildPlan {
  summary: string;
  targets: PlanTarget[];
}

/** Compact workspace context handed to the planner and returned to the UI. */
export interface BuilderContext {
  spaces: {
    id: string;
    name: string;
    folders: { id: string; name: string }[];
    lists: { id: string; name: string }[];
  }[];
  /** Active workspace members the AI can assign tasks to. */
  members: { id: string; name: string }[];
}

export interface BuildResult {
  summary: string;
  spaces: { id: string; name: string; url: string; created: boolean }[];
  lists: { id: string; name: string; url: string; created: boolean }[];
  tasks: { id: string; name: string; listId: string }[];
  docs: { id: string; name: string; url: string }[];
  counts: {
    spacesCreated: number;
    listsCreated: number;
    tasks: number;
    docs: number;
  };
}

const FORM_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "number",
  "select",
  "date",
  "checkbox",
]);
const MAX_FORM_FIELDS = 18;

export interface PlanFormField {
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  asTitle?: boolean;
}

export interface FormPlan {
  name: string;
  description?: string;
  fields: PlanFormField[];
}

export interface FormBuildResult {
  formId: string;
  listId: string;
  listUrl: string;
  publicToken: string;
  fieldCount: number;
}

@Injectable()
export class AiBuilderService {
  constructor(
    private readonly ai: AiProvider,
    private readonly db: DbService,
    private readonly hierarchy: HierarchyService,
    private readonly tasks: TasksService,
    private readonly docs: DocsService,
    private readonly forms: FormsService,
  ) {}

  status() {
    return { available: this.ai.available(), model: this.ai.model() };
  }

  /** Editable spaces (+ folders/lists) and members the caller can build with. */
  async context(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<BuilderContext> {
    const tree = await this.hierarchy.tree(workspaceId, userId, role);
    const spaces = tree.spaces
      .filter((s) => permAtLeast(s.myPermission, "edit"))
      .slice(0, MAX_CONTEXT_SPACES)
      .map((s) => {
        const lists = [
          ...s.lists,
          ...s.folders.flatMap((f) => f.lists),
        ].map((l) => ({ id: l.id, name: l.name }));
        return {
          id: s.id,
          name: s.name,
          folders: s.folders
            .slice(0, MAX_CONTEXT_LISTS)
            .map((f) => ({ id: f.id, name: f.name })),
          lists: lists.slice(0, MAX_CONTEXT_LISTS),
        };
      });
    const members = await this.loadMembers(workspaceId, userId);
    return { spaces, members };
  }

  /** Active workspace members (id + display name) for AI assignment. */
  private async loadMembers(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string; name: string }[]> {
    try {
      return await this.db.withWorkspace(workspaceId, userId, async (client) => {
        const res = await client.query(
          `SELECT u.id, u.full_name, u.email
             FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.workspace_id = $1 AND m.status = 'active'
            ORDER BY m.created_at
            LIMIT 100`,
          [workspaceId],
        );
        return res.rows.map((r) => ({
          id: r.id as string,
          name: (r.full_name as string) || (r.email as string) || "Member",
        }));
      });
    } catch {
      return [];
    }
  }

  /**
   * Plan where a brief's work should go. Returns the plan, the source (claude
   * vs heuristic) and the workspace context the UI needs to render/edit the
   * chosen destinations. Never writes.
   */
  async plan(
    workspaceId: string,
    userId: string,
    role: Role,
    prompt: string,
  ): Promise<{ plan: BuildPlan; source: "claude" | "heuristic"; context: BuilderContext }> {
    const brief = prompt.trim();
    const context = await this.context(workspaceId, userId, role);

    if (this.ai.available()) {
      const p = planPrompt(brief, context);
      // Preferred: schema-constrained structured output (no parse failures).
      const structured = await this.ai.completeJson(SYSTEM_PLAN, p, PLAN_SCHEMA, 2400);
      const fromStructured = structured ? normalizePlan(structured, context) : null;
      if (fromStructured && fromStructured.targets.length > 0) {
        return { plan: clampPlan(fromStructured), source: "claude", context };
      }
      // Fallback: free-text completion + tolerant parse.
      const out = await this.ai.complete(SYSTEM_PLAN, p, 2400);
      const parsed = out ? tryParsePlan(out, context) : null;
      if (parsed && parsed.targets.length > 0) {
        return { plan: clampPlan(parsed), source: "claude", context };
      }
    }
    return {
      plan: clampPlan(heuristicPlan(brief, context)),
      source: "heuristic",
      context,
    };
  }

  /**
   * Execute a plan. Newly-created spaces/lists are de-duplicated by name within
   * the build so "create space X" twice makes one X. Everything goes through
   * the real create services — permissions and limits still apply.
   */
  async build(
    workspaceId: string,
    userId: string,
    role: Role,
    rawPlan: BuildPlan,
  ): Promise<BuildResult> {
    const plan = clampPlan(rawPlan);
    const result: BuildResult = {
      summary: plan.summary,
      spaces: [],
      lists: [],
      tasks: [],
      docs: [],
      counts: { spacesCreated: 0, listsCreated: 0, tasks: 0, docs: 0 },
    };
    // Dedupe caches for entities created during THIS build.
    const newSpaceByName = new Map<string, string>(); // lower(name) -> spaceId
    const newListByKey = new Map<string, string>(); // spaceId|lower(name) -> listId
    let totalTasks = 0;

    for (const target of plan.targets) {
      // 1. Resolve the space.
      const spaceId = await this.resolveSpace(
        workspaceId,
        userId,
        role,
        target.space,
        newSpaceByName,
        result,
      );
      if (!spaceId) continue;

      // 2. Resolve the list.
      const listId = await this.resolveList(
        workspaceId,
        userId,
        role,
        spaceId,
        target.list,
        newListByKey,
        result,
      );
      if (!listId) continue;

      // 3. Create the tasks.
      for (const pt of target.tasks ?? []) {
        if (totalTasks >= MAX_TOTAL_TASKS) break;
        try {
          const task = await this.tasks.createTask(
            workspaceId,
            userId,
            role,
            listId,
            {
              name: pt.name,
              description: pt.description,
              priority: pt.priority ?? null,
              dueDate: dueDateFromDays(pt.dueInDays),
              assigneeIds: pt.assigneeIds?.length ? pt.assigneeIds : undefined,
            },
          );
          result.tasks.push({ id: task.id, name: task.name, listId });
          result.counts.tasks++;
          totalTasks++;
        } catch {
          /* skip one bad task */
        }
      }

      // 4. Create docs in the resolved space.
      for (const pd of target.docs ?? []) {
        try {
          const doc = await this.docs.createDoc(workspaceId, userId, role, {
            name: pd.name,
            icon: pd.icon,
            spaceId,
          });
          if (pd.content && pd.content.trim()) {
            const { pages } = await this.docs.getDoc(workspaceId, userId, role, doc.id);
            if (pages[0]) {
              await this.docs.updatePage(workspaceId, userId, role, pages[0].id, {
                content: pd.content,
              });
            }
          }
          result.docs.push({ id: doc.id, name: doc.name, url: `/doc?id=${doc.id}` });
          result.counts.docs++;
        } catch {
          /* skip one bad doc */
        }
      }
    }

    return result;
  }

  /* ---- Forms ------------------------------------------------------- */

  /**
   * Draft a form (name + fields) from a brief. Questions are kept short and
   * mostly single-tap; a couple are required and one is flagged as the task
   * title. No writes — the UI previews before building.
   */
  async planForm(
    prompt: string,
  ): Promise<{ form: FormPlan; source: "claude" | "heuristic" }> {
    const brief = prompt.trim();
    if (this.ai.available()) {
      const p = formPrompt(brief);
      const structured = await this.ai.completeJson(SYSTEM_FORM, p, FORM_SCHEMA, 2000);
      const fromStructured = structured ? normalizeForm(structured) : null;
      if (fromStructured && fromStructured.fields.length > 0) {
        return { form: clampForm(fromStructured), source: "claude" };
      }
      const out = await this.ai.complete(SYSTEM_FORM, p, 2000);
      const parsed = out ? tryParseForm(out) : null;
      if (parsed && parsed.fields.length > 0) {
        return { form: clampForm(parsed), source: "claude" };
      }
    }
    return { form: clampForm(heuristicForm(brief)), source: "heuristic" };
  }

  /**
   * Create a form from a (previewed) plan into a destination list — creating
   * the space/list first when requested. Runs through the real create services.
   */
  async buildForm(
    workspaceId: string,
    userId: string,
    role: Role,
    form: FormPlan,
    space: SpaceRef,
    list: ListRef,
  ): Promise<FormBuildResult> {
    const result: BuildResult = {
      summary: "",
      spaces: [],
      lists: [],
      tasks: [],
      docs: [],
      counts: { spacesCreated: 0, listsCreated: 0, tasks: 0, docs: 0 },
    };
    const spaceId = await this.resolveSpace(
      workspaceId,
      userId,
      role,
      space,
      new Map(),
      result,
    );
    if (!spaceId) {
      throw new Error("Could not resolve or create the destination space");
    }
    const listId = await this.resolveList(
      workspaceId,
      userId,
      role,
      spaceId,
      list,
      new Map(),
      result,
    );
    if (!listId) {
      throw new Error("Could not resolve or create the destination list");
    }
    const created = await this.forms.createForm(workspaceId, userId, role, {
      name: form.name,
      listId,
      description: form.description,
      fields: clampForm(form).fields,
    });
    return {
      formId: created.id,
      listId,
      listUrl: `/list?id=${listId}`,
      publicToken: created.publicToken,
      fieldCount: created.fields.length,
    };
  }

  private async resolveSpace(
    workspaceId: string,
    userId: string,
    role: Role,
    ref: SpaceRef,
    cache: Map<string, string>,
    result: BuildResult,
  ): Promise<string | null> {
    if ("existingId" in ref) {
      // Record it once for the response links (name filled lazily at build end
      // is unnecessary — we only surface created spaces prominently).
      return ref.existingId;
    }
    const key = ref.name.trim().toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    try {
      const space = await this.hierarchy.createSpace(workspaceId, userId, role, {
        name: ref.name,
        icon: ref.icon,
      });
      cache.set(key, space.id);
      result.spaces.push({
        id: space.id,
        name: space.name,
        url: `/space?id=${space.id}`,
        created: true,
      });
      result.counts.spacesCreated++;
      return space.id;
    } catch {
      return null; // e.g. role can't create spaces
    }
  }

  private async resolveList(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    ref: ListRef,
    cache: Map<string, string>,
    result: BuildResult,
  ): Promise<string | null> {
    if ("existingId" in ref) return ref.existingId;
    // Dedupe by (space, folder, name) — same-named lists in different folders
    // are distinct and must not collapse into one.
    const folderPart = ref.folderId ? ref.folderId : "root";
    const key = `${spaceId}|${folderPart}|${ref.name.trim().toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) return cached;
    // Create in the requested folder; if that folder placement is rejected
    // (e.g. a stale/foreign folderId), fall back to the space root rather than
    // dropping the whole target and losing its tasks.
    let list = await this.hierarchy
      .createList(workspaceId, userId, role, spaceId, {
        name: ref.name,
        folderId: ref.folderId,
      })
      .catch(() => null);
    if (!list && ref.folderId) {
      list = await this.hierarchy
        .createList(workspaceId, userId, role, spaceId, { name: ref.name })
        .catch(() => null);
    }
    if (!list) return null;
    cache.set(key, list.id);
    result.lists.push({
      id: list.id,
      name: list.name,
      url: `/list?id=${list.id}`,
      created: true,
    });
    result.counts.listsCreated++;
    return list.id;
  }
}

/* ---- Plan parsing / clamping -------------------------------------- */

/**
 * Normalize a raw plan object (from structured output OR a tolerant text
 * parse) against the workspace context — validating every id, folder and
 * member. This is the single source of truth for turning a model reply into a
 * safe BuildPlan; the schema guarantees the SHAPE, this guarantees the VALUES.
 */
function normalizePlan(obj: unknown, ctx: BuilderContext): BuildPlan | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const rawTargets = Array.isArray(o.targets) ? o.targets : [];
  const spaceIds = new Set(ctx.spaces.map((s) => s.id));
  const listIds = new Set(ctx.spaces.flatMap((s) => s.lists.map((l) => l.id)));
  // Folders are validated PER SPACE — a folder is only usable for a new list
  // in the space that owns it (never cross-space, never in a new space).
  const spaceFolders = new Map(
    ctx.spaces.map((s) => [s.id, new Set(s.folders.map((f) => f.id))]),
  );
  const memberIds = new Set(ctx.members.map((m) => m.id));
  const targets = rawTargets
    .map((t) => normalizeTarget(t, spaceIds, listIds, spaceFolders, memberIds))
    .filter((t): t is PlanTarget => t !== null);
  return {
    summary: typeof o.summary === "string" ? o.summary : "AI-generated plan",
    targets,
  };
}

/** Tolerant text→plan parse (fallback when structured output is unavailable). */
function tryParsePlan(raw: string, ctx: BuilderContext): BuildPlan | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    return normalizePlan(JSON.parse(json), ctx);
  } catch {
    return null;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function normalizeSpaceRef(
  v: unknown,
  spaceIds: Set<string>,
): SpaceRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const existing = str(o.existingId);
  if (existing && spaceIds.has(existing)) return { existingId: existing };
  const name = str(o.name);
  if (o.create === true && name) return { create: true, name, icon: str(o.icon) };
  // A hallucinated existingId falls back to creating a space by that name if
  // one was also provided; otherwise it's invalid.
  if (name) return { create: true, name, icon: str(o.icon) };
  return null;
}

function normalizeListRef(v: unknown, listIds: Set<string>): ListRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const existing = str(o.existingId);
  if (existing && listIds.has(existing)) return { existingId: existing };
  const name = str(o.name);
  if (name) {
    // folderId is carried through raw here; normalizeTarget validates it
    // against the RESOLVED space (a folder must belong to that space).
    const folderId = str(o.folderId);
    return folderId ? { create: true, name, folderId } : { create: true, name };
  }
  return null;
}

function normalizeTarget(
  v: unknown,
  spaceIds: Set<string>,
  listIds: Set<string>,
  spaceFolders: Map<string, Set<string>>,
  memberIds: Set<string>,
): PlanTarget | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const space = normalizeSpaceRef(o.space, spaceIds);
  const list = normalizeListRef(o.list, listIds);
  if (!space || !list) return null;
  // A folder is only valid for a NEW list in an EXISTING space, and only when
  // the folder actually belongs to that space. Otherwise drop it — never let a
  // cross-space (or new-space) folderId through.
  if ("create" in list && list.folderId) {
    const ok =
      "existingId" in space &&
      spaceFolders.get(space.existingId)?.has(list.folderId);
    if (!ok) delete list.folderId;
  }
  // An existing list must live in its real space — trust the list's identity.
  const tasks = Array.isArray(o.tasks)
    ? o.tasks.map((t) => normalizeTask(t, memberIds)).filter((t): t is PlanTask => t !== null)
    : [];
  const docs = Array.isArray(o.docs)
    ? o.docs.map(normalizeDoc).filter((d): d is PlanDoc => d !== null)
    : [];
  return {
    space,
    list,
    tasks,
    docs,
    needsChoice: o.needsChoice === true,
    note: str(o.note),
  };
}

function normalizeTask(v: unknown, memberIds: Set<string>): PlanTask | null {
  if (typeof v === "string") return str(v) ? { name: v.trim() } : null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name) ?? str(o.title);
  if (!name) return null;
  const priority =
    typeof o.priority === "string" && PRIORITIES.has(o.priority)
      ? (o.priority as PlanTask["priority"])
      : undefined;
  const dueInDays =
    typeof o.dueInDays === "number" && isFinite(o.dueInDays)
      ? Math.max(0, Math.min(365, Math.round(o.dueInDays)))
      : undefined;
  const assigneeIds = Array.isArray(o.assigneeIds)
    ? (o.assigneeIds
        .map((x) => str(x))
        .filter((x): x is string => !!x && memberIds.has(x))
        .slice(0, 10))
    : undefined;
  return {
    name,
    description: str(o.description),
    priority,
    dueInDays,
    assigneeIds: assigneeIds && assigneeIds.length ? assigneeIds : undefined,
  };
}

function normalizeDoc(v: unknown): PlanDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name) ?? str(o.title);
  if (!name) return null;
  return { name, icon: str(o.icon), content: str(o.content) };
}

/** Enforce hard size caps so a plan can never spawn a runaway build. */
function clampPlan(plan: BuildPlan): BuildPlan {
  let taskBudget = MAX_TOTAL_TASKS;
  const targets = (plan.targets ?? []).slice(0, MAX_TARGETS).map((t) => {
    const tasks = (t.tasks ?? []).slice(0, MAX_TASKS_PER_TARGET).slice(0, taskBudget);
    taskBudget -= tasks.length;
    const docs = (t.docs ?? []).slice(0, MAX_DOCS_PER_TARGET);
    return { ...t, tasks, docs };
  });
  return { summary: plan.summary || "AI-generated plan", targets };
}

function dueDateFromDays(days?: number): string | null {
  if (typeof days !== "number" || !isFinite(days)) return null;
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/* ---- Claude prompt ------------------------------------------------- */

/**
 * JSON Schema for the build plan, used as the forced tool's input schema so
 * the model's reply is always a well-formed plan object. Kept intentionally
 * permissive (optional fields) — id/folder/member VALIDITY is enforced by
 * normalizePlan against the live workspace context, not by the schema.
 */
const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string" },
    targets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          space: {
            type: "object",
            properties: {
              existingId: { type: "string" },
              create: { type: "boolean" },
              name: { type: "string" },
              icon: { type: "string" },
            },
          },
          list: {
            type: "object",
            properties: {
              existingId: { type: "string" },
              create: { type: "boolean" },
              name: { type: "string" },
              folderId: { type: "string" },
            },
          },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
                dueInDays: { type: "number" },
                assigneeIds: { type: "array", items: { type: "string" } },
              },
              required: ["name"],
            },
          },
          docs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                icon: { type: "string" },
                content: { type: "string" },
              },
              required: ["name"],
            },
          },
          needsChoice: { type: "boolean" },
          note: { type: "string" },
        },
        required: ["space", "list", "tasks"],
      },
    },
  },
  required: ["summary", "targets"],
};

const SYSTEM_PLAN =
  "You are StackUp's build planner. Turn the user's brief into a JSON plan that " +
  "places tasks into the RIGHT destination in their existing workspace. You are " +
  "given the current spaces and their lists (with ids). Prefer existing places:\n" +
  "- Add to an existing list when the work clearly belongs there.\n" +
  "- Make a new list inside an existing space when the space fits but no list does.\n" +
  "- Make a new space only for a genuinely new project/area.\n" +
  "If you are unsure where a group belongs, still give your best guess but set " +
  '"needsChoice": true so the app can ask the user.\n' +
  "You may assign tasks to teammates and place a new list inside a folder when " +
  "the brief implies it — use only ids from the context.\n" +
  "Reply with ONLY valid JSON, no prose, no fences:\n" +
  '{"summary":"one short sentence","targets":[{' +
  '"space":{"existingId":"<id>"} OR {"create":true,"name":"...","icon":"📁"},' +
  '"list":{"existingId":"<id>"} OR {"create":true,"name":"...","folderId":"<id optional>"},' +
  '"tasks":[{"name":"...","description":"optional one line","priority":"urgent|high|normal|low (optional)","dueInDays":7,"assigneeIds":["<memberId>"]}],' +
  '"needsChoice":false,"note":"short reason"}]}\n' +
  "Rules: at most 6 targets, 12 tasks per target. Use real ids from the context " +
  "for existing places, folders and members. Only assign someone when the brief " +
  "names them or their role clearly fits. Make task names concrete and actionable.";

function planPrompt(brief: string, ctx: BuilderContext): string {
  const lines: string[] = [];
  if (ctx.spaces.length === 0) {
    lines.push("(The workspace has no spaces you can edit yet.)");
  } else {
    lines.push("Existing spaces you can build into:");
    for (const s of ctx.spaces) {
      const lists =
        s.lists.length > 0
          ? s.lists.map((l) => `{id=${l.id} "${l.name}"}`).join(", ")
          : "(no lists yet)";
      const folders =
        s.folders.length > 0
          ? ` — folders: ${s.folders.map((f) => `{id=${f.id} "${f.name}"}`).join(", ")}`
          : "";
      lines.push(`- space id=${s.id} "${s.name}" — lists: ${lists}${folders}`);
    }
  }
  if (ctx.members.length > 0) {
    lines.push("");
    lines.push("Teammates you can assign (use the id):");
    for (const m of ctx.members) {
      lines.push(`- member id=${m.id} "${m.name}"`);
    }
  }
  return `Brief:\n${brief}\n\n${lines.join("\n")}\n\nReturn the JSON plan.`;
}

/* ---- Heuristic fallback (no AI key) -------------------------------- */

function heuristicPlan(brief: string, ctx: BuilderContext): BuildPlan {
  const clean = brief.replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();

  // Try to match an existing list by name mentioned in the brief.
  for (const s of ctx.spaces) {
    for (const l of s.lists) {
      if (l.name.length >= 3 && lower.includes(l.name.toLowerCase())) {
        return {
          summary: `Add tasks to your existing “${l.name}” list.`,
          targets: [
            {
              space: { existingId: s.id },
              list: { existingId: l.id },
              tasks: heuristicTasks(clean),
              note: `Matched your existing “${l.name}” list`,
            },
          ],
        };
      }
    }
  }
  // Else match an existing space by name → a new list inside it.
  for (const s of ctx.spaces) {
    if (s.name.length >= 3 && lower.includes(s.name.toLowerCase())) {
      const listName = titleCase(clean.split(/[.,\n]/)[0].slice(0, 40)) || "Tasks";
      return {
        summary: `A new “${listName}” list in your “${s.name}” space.`,
        targets: [
          {
            space: { existingId: s.id },
            list: { create: true, name: listName },
            tasks: heuristicTasks(clean),
            note: `Matched your existing “${s.name}” space`,
          },
        ],
      };
    }
  }
  // Otherwise propose a new space + list, and ask the user to confirm the
  // destination since we couldn't infer one.
  const spaceName = titleCase(clean.split(/[.,\n]/)[0].slice(0, 40)) || "New space";
  return {
    summary: `A new “${spaceName}” space with a starter list.`,
    targets: [
      {
        space: { create: true, name: spaceName, icon: "🚀" },
        list: { create: true, name: "Tasks" },
        tasks: heuristicTasks(clean),
        needsChoice: ctx.spaces.length > 0,
        note:
          ctx.spaces.length > 0
            ? "No existing place matched — confirm or pick a destination"
            : undefined,
      },
    ],
  };
}

function heuristicTasks(brief: string): PlanTask[] {
  const noun = brief.split(/[.\n]/)[0].slice(0, 50) || "the project";
  return [
    { name: `Define scope and goals for ${noun}` },
    { name: "Identify owners and key dates" },
    { name: "Break the work into milestones" },
    { name: "Kick off and track progress" },
  ];
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
}

/* ---- Form planning ------------------------------------------------- */

/** Normalize a raw form object (structured output OR tolerant text parse). */
function normalizeForm(obj: unknown): FormPlan | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const rawFields = Array.isArray(o.fields) ? o.fields : [];
  const fields = rawFields
    .map(normalizeFormField)
    .filter((f): f is PlanFormField => f !== null);
  return {
    name: str(o.name) ?? "Feedback form",
    description: str(o.description),
    fields,
  };
}

function tryParseForm(raw: string): FormPlan | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    return normalizeForm(JSON.parse(json));
  } catch {
    return null;
  }
}

function normalizeFormField(v: unknown): PlanFormField | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const label = str(o.label) ?? str(o.name) ?? str(o.question);
  if (!label) return null;
  let type = (str(o.type) ?? "text").toLowerCase();
  if (!FORM_FIELD_TYPES.has(type)) type = "text";
  const field: PlanFormField = {
    label,
    type,
    required: o.required === true,
    asTitle: o.asTitle === true,
  };
  if (type === "select") {
    const opts = Array.isArray(o.options)
      ? o.options.map((x) => str(x)).filter((x): x is string => !!x).slice(0, 20)
      : [];
    // A select needs options; fall back to text if the model gave none.
    if (opts.length === 0) field.type = "text";
    else field.options = opts;
  }
  return field;
}

/** Clamp field count and enforce a single asTitle flag. */
function clampForm(form: FormPlan): FormPlan {
  let titleSeen = false;
  const fields = form.fields.slice(0, MAX_FORM_FIELDS).map((f) => {
    const out = { ...f };
    if (out.asTitle) {
      if (titleSeen) out.asTitle = false;
      else titleSeen = true;
    }
    return out;
  });
  return { name: form.name || "Feedback form", description: form.description, fields };
}

/** JSON Schema for a drafted form (forced-tool input schema). */
const FORM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          type: {
            type: "string",
            enum: ["text", "textarea", "email", "number", "select", "date", "checkbox"],
          },
          required: { type: "boolean" },
          options: { type: "array", items: { type: "string" } },
          asTitle: { type: "boolean" },
        },
        required: ["label", "type"],
      },
    },
  },
  required: ["name", "fields"],
};

const SYSTEM_FORM =
  "You are StackUp's form builder. Turn the user's brief into a concise intake " +
  "form. Reply with ONLY valid JSON, no prose, no fences:\n" +
  '{"name":"...","description":"one short sentence","fields":[' +
  '{"label":"...","type":"text|textarea|email|number|select|date|checkbox",' +
  '"required":false,"options":["A","B"],"asTitle":false}]}\n' +
  "Rules: keep it short and easy — at most 14 questions, mostly `select` " +
  "(single choice, needs `options`) or `checkbox` so answers are one tap. Use " +
  "`textarea` only for 1–2 open questions. Mark at most 3 fields required. Mark " +
  "exactly ONE short field asTitle (e.g. a name or role). `email` for any email " +
  "field. Make labels short and precise.";

function formPrompt(brief: string): string {
  return `Brief:\n${brief}\n\nReturn the JSON form.`;
}

function heuristicForm(brief: string): FormPlan {
  const topic = titleCase(brief.replace(/\s+/g, " ").trim().slice(0, 40)) || "Feedback";
  return {
    name: `${topic} form`,
    description: "A quick form — your answers help us improve.",
    fields: [
      { label: "Your name", type: "text", asTitle: true },
      { label: "Email", type: "email" },
      {
        label: "How would you rate your experience?",
        type: "select",
        required: true,
        options: ["Excellent", "Good", "Okay", "Poor"],
      },
      { label: "What could we improve?", type: "textarea" },
      { label: "Would you recommend us?", type: "checkbox" },
    ],
  };
}
