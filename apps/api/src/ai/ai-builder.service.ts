import { Injectable } from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { AiProvider } from "./ai.provider";
import { HierarchyService } from "../hierarchy/hierarchy.service";
import { TasksService } from "../tasks/tasks.service";
import { DocsService } from "../docs/docs.service";

/**
 * AI Builder — turns a single natural-language brief into a real StackUp
 * structure (spaces → lists → tasks, plus docs). It runs in two steps so the
 * user is never surprised by a mutation:
 *
 *   1. plan(prompt)  → a structured BuildPlan (no writes). Claude when a key
 *      is configured, a deterministic heuristic otherwise. The client previews
 *      it and the user can edit before building.
 *   2. build(plan)   → executes the plan through the ordinary create services,
 *      so RLS, role capabilities, plan limits and search indexing all still
 *      apply. Nothing is bypassed; the AI is only a fast way to fill forms.
 *
 * Sizes are clamped on both the plan and the build so a prompt can never spawn
 * a runaway amount of work.
 */

const MAX_SPACES = 4;
const MAX_LISTS_PER_SPACE = 8;
const MAX_TASKS_PER_LIST = 15;
const MAX_DOCS_PER_SPACE = 4;
const MAX_TOTAL_TASKS = 80;

const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);

export interface PlanTask {
  name: string;
  description?: string;
  priority?: "urgent" | "high" | "normal" | "low";
  /** Relative due date, in days from the build time. */
  dueInDays?: number;
}

export interface PlanList {
  name: string;
  tasks: PlanTask[];
}

export interface PlanDoc {
  name: string;
  icon?: string;
  content?: string;
}

export interface PlanSpace {
  name: string;
  icon?: string;
  lists: PlanList[];
  docs?: PlanDoc[];
}

export interface BuildPlan {
  /** One-line, human-readable description of what will be built. */
  summary: string;
  spaces: PlanSpace[];
}

export interface BuildResult {
  summary: string;
  spaces: { id: string; name: string; url: string }[];
  lists: { id: string; name: string; url: string }[];
  tasks: { id: string; name: string; listId: string }[];
  docs: { id: string; name: string; url: string }[];
  counts: { spaces: number; lists: number; tasks: number; docs: number };
}

@Injectable()
export class AiBuilderService {
  constructor(
    private readonly ai: AiProvider,
    private readonly hierarchy: HierarchyService,
    private readonly tasks: TasksService,
    private readonly docs: DocsService,
  ) {}

  status() {
    return { available: this.ai.available(), model: this.ai.model() };
  }

  /**
   * Turn a brief into a structured plan. Returns the (clamped) plan and the
   * source so the UI can badge heuristic output. Never writes anything.
   */
  async plan(
    prompt: string,
  ): Promise<{ plan: BuildPlan; source: "claude" | "heuristic" }> {
    const brief = prompt.trim();
    if (this.ai.available()) {
      const out = await this.ai.complete(SYSTEM_PLAN, planPrompt(brief), 2000);
      if (out) {
        const parsed = tryParsePlan(out);
        if (parsed && parsed.spaces.length > 0) {
          return { plan: clampPlan(parsed), source: "claude" };
        }
      }
    }
    return { plan: clampPlan(heuristicPlan(brief)), source: "heuristic" };
  }

  /**
   * Execute a plan. Everything goes through the real create services, so a
   * caller who lacks permission (role capability, private space, plan limit)
   * is stopped exactly as they would be in the UI. Best-effort per item: one
   * failed task never aborts the whole build.
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
      counts: { spaces: 0, lists: 0, tasks: 0, docs: 0 },
    };
    let totalTasks = 0;

    for (const ps of plan.spaces) {
      let space;
      try {
        space = await this.hierarchy.createSpace(workspaceId, userId, role, {
          name: ps.name,
          icon: ps.icon,
        });
      } catch {
        continue; // e.g. role can't create spaces — skip, keep going.
      }
      result.spaces.push({
        id: space.id,
        name: space.name,
        url: `/space?id=${space.id}`,
      });
      result.counts.spaces++;

      for (const pl of ps.lists ?? []) {
        let list;
        try {
          list = await this.hierarchy.createList(
            workspaceId,
            userId,
            role,
            space.id,
            { name: pl.name },
          );
        } catch {
          continue;
        }
        result.lists.push({
          id: list.id,
          name: list.name,
          url: `/list?id=${list.id}`,
        });
        result.counts.lists++;

        for (const pt of pl.tasks ?? []) {
          if (totalTasks >= MAX_TOTAL_TASKS) break;
          try {
            const task = await this.tasks.createTask(
              workspaceId,
              userId,
              role,
              list.id,
              {
                name: pt.name,
                description: pt.description,
                priority: pt.priority ?? null,
                dueDate: dueDateFromDays(pt.dueInDays),
              },
            );
            result.tasks.push({ id: task.id, name: task.name, listId: list.id });
            result.counts.tasks++;
            totalTasks++;
          } catch {
            // skip a single bad task
          }
        }
      }

      for (const pd of ps.docs ?? []) {
        try {
          const doc = await this.docs.createDoc(workspaceId, userId, role, {
            name: pd.name,
            icon: pd.icon,
            spaceId: space.id,
          });
          if (pd.content && pd.content.trim()) {
            // The root page carries the doc's body.
            const { pages } = await this.docs.getDoc(
              workspaceId,
              userId,
              role,
              doc.id,
            );
            if (pages[0]) {
              await this.docs.updatePage(
                workspaceId,
                userId,
                role,
                pages[0].id,
                { content: pd.content },
              );
            }
          }
          result.docs.push({
            id: doc.id,
            name: doc.name,
            url: `/doc?id=${doc.id}`,
          });
          result.counts.docs++;
        } catch {
          // skip a single bad doc
        }
      }
    }

    return result;
  }
}

/* ---- Plan parsing / clamping -------------------------------------- */

function tryParsePlan(raw: string): BuildPlan | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    // Be tolerant of any prose the model wraps around the JSON.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    const spaces = Array.isArray(o.spaces) ? o.spaces : [];
    return {
      summary: typeof o.summary === "string" ? o.summary : "AI-generated plan",
      spaces: spaces.map(normalizeSpace).filter((s): s is PlanSpace => s !== null),
    };
  } catch {
    return null;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function normalizeSpace(v: unknown): PlanSpace | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return null;
  const lists = Array.isArray(o.lists) ? o.lists : [];
  const docs = Array.isArray(o.docs) ? o.docs : [];
  return {
    name,
    icon: str(o.icon),
    lists: lists.map(normalizeList).filter((l): l is PlanList => l !== null),
    docs: docs.map(normalizeDoc).filter((d): d is PlanDoc => d !== null),
  };
}

function normalizeList(v: unknown): PlanList | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return null;
  const tasks = Array.isArray(o.tasks) ? o.tasks : [];
  return {
    name,
    tasks: tasks.map(normalizeTask).filter((t): t is PlanTask => t !== null),
  };
}

function normalizeTask(v: unknown): PlanTask | null {
  if (typeof v === "string") {
    return str(v) ? { name: v.trim() } : null;
  }
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
  return { name, description: str(o.description), priority, dueInDays };
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
  const spaces = plan.spaces.slice(0, MAX_SPACES).map((s) => {
    const lists = (s.lists ?? []).slice(0, MAX_LISTS_PER_SPACE).map((l) => {
      const tasks = (l.tasks ?? []).slice(0, MAX_TASKS_PER_LIST).slice(0, taskBudget);
      taskBudget -= tasks.length;
      return { ...l, tasks };
    });
    const docs = (s.docs ?? []).slice(0, MAX_DOCS_PER_SPACE);
    return { ...s, lists, docs };
  });
  return { summary: plan.summary || "AI-generated plan", spaces };
}

function dueDateFromDays(days?: number): string | null {
  if (typeof days !== "number" || !isFinite(days)) return null;
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/* ---- Claude prompt ------------------------------------------------- */

const SYSTEM_PLAN =
  "You are StackUp's build planner. You turn a user's brief into a JSON plan " +
  "that creates a project structure: spaces, each with lists, each with tasks, " +
  "and optional docs. Reply with ONLY valid JSON — no prose, no markdown fences. " +
  "Shape:\n" +
  '{"summary":"one short sentence","spaces":[{"name":"...","icon":"📁",' +
  '"lists":[{"name":"...","tasks":[{"name":"...","description":"optional short",' +
  '"priority":"urgent|high|normal|low (optional)","dueInDays":7}]}],' +
  '"docs":[{"name":"...","icon":"📄","content":"optional short markdown"}]}]}\n' +
  "Rules: at most 3 spaces, 6 lists per space, 10 tasks per list, 2 docs per " +
  "space. `icon` is a single emoji. Prefer one space unless the brief clearly " +
  "spans distinct areas. Make task names concrete and actionable. Keep any " +
  "description to one line. Use dueInDays only when timing is implied.";

function planPrompt(brief: string): string {
  return `Brief:\n${brief}\n\nReturn the JSON plan.`;
}

/* ---- Heuristic fallback (no AI key) -------------------------------- */

function heuristicPlan(brief: string): BuildPlan {
  const clean = brief.replace(/\s+/g, " ").trim();
  const spaceName = titleCase(clean.split(/[.,\n]/)[0].slice(0, 40)) || "New space";
  const lists: PlanList[] = [
    { name: "Backlog", tasks: heuristicTasks(clean, "Plan") },
    { name: "In Progress", tasks: [] },
    { name: "Done", tasks: [] },
  ];
  return {
    summary: `A "${spaceName}" space with a starter board.`,
    spaces: [
      {
        name: spaceName,
        icon: "🚀",
        lists,
        docs: [{ name: `${spaceName} — Overview`, icon: "📄", content: clean }],
      },
    ],
  };
}

function heuristicTasks(brief: string, _hint: string): PlanTask[] {
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
