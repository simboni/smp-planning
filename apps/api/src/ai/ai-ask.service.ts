import { Injectable } from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { AiProvider } from "./ai.provider";
import { AiContextService, type WorkspaceSnapshot } from "./ai-context.service";
import { SearchService, type SearchResults } from "../search/search.service";

/**
 * Ask (Copilot Q&A) — answers a natural-language question about the workspace.
 *
 * Grounding has two legs so BROAD questions work as well as specific ones:
 *   1. A workspace-state snapshot (open / overdue / recently-completed tasks
 *      with owners) — so "how's this week going?" or "what's pending?" have
 *      real material to summarize.
 *   2. Keyword search — so "what's the status of the Stripe task?" pulls the
 *      exact item.
 * Both are permission-scoped. The model must answer only from these sources and
 * report which it used, so answers are attributable and never invented.
 */

export interface AskSource {
  ref: string;
  type: "task" | "list" | "space" | "doc" | "goal" | "whiteboard" | "channel";
  title: string;
  url: string;
}

export interface AskAnswer {
  answer: string;
  sources: AskSource[];
  source: "claude" | "heuristic";
}

const ASK_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    answer: { type: "string" },
    usedRefs: { type: "array", items: { type: "string" } },
  },
  required: ["answer"],
};

const SYSTEM_ASK =
  "You are StackUp's assistant. Answer the user's question using ONLY the " +
  "workspace state and items provided. For status or weekly questions, say what " +
  "was completed recently and what's still open, and name the owners. Be concise " +
  "and specific; reference the items you rely on and list their refs in usedRefs. " +
  "If the provided state doesn't cover the question, say what you can see and what " +
  "you'd need — never invent tasks, dates, names or statuses.";

@Injectable()
export class AiAskService {
  constructor(
    private readonly ai: AiProvider,
    private readonly context: AiContextService,
    private readonly search: SearchService,
  ) {}

  async ask(
    workspaceId: string,
    userId: string,
    role: Role,
    question: string,
  ): Promise<AskAnswer> {
    const q = question.trim();
    if (role === "guest") {
      return {
        answer: "Ask is available to workspace members.",
        sources: [],
        source: "heuristic",
      };
    }

    const snapshot = await this.context.snapshot(workspaceId, userId, role, 40);
    let searchResults: SearchResults | null = null;
    try {
      searchResults = (await this.search.search(workspaceId, userId, role, q, 6)).results;
    } catch {
      searchResults = null;
    }

    const { sources, taskById } = buildSources(snapshot, searchResults);

    if (!this.ai.available()) {
      return {
        answer: heuristicAnswer(q, snapshot),
        sources: sources.slice(0, 6),
        source: "heuristic",
      };
    }

    const prompt = buildPrompt(q, snapshot, sources, taskById);
    const structured = (await this.ai.completeJson(
      SYSTEM_ASK,
      prompt,
      ASK_SCHEMA,
      1000,
    )) as { answer?: unknown; usedRefs?: unknown } | null;

    if (structured && typeof structured.answer === "string" && structured.answer.trim()) {
      const used = Array.isArray(structured.usedRefs)
        ? new Set(structured.usedRefs.filter((r): r is string => typeof r === "string"))
        : null;
      const cited = used ? sources.filter((s) => used.has(s.ref)) : [];
      return {
        answer: structured.answer.trim(),
        sources: (cited.length > 0 ? cited : sources).slice(0, 6),
        source: "claude",
      };
    }

    const text = await this.ai.complete(SYSTEM_ASK, prompt, 1000);
    if (text && text.trim()) {
      return { answer: text.trim(), sources: sources.slice(0, 6), source: "claude" };
    }
    return { answer: heuristicAnswer(q, snapshot), sources: sources.slice(0, 6), source: "heuristic" };
  }
}

/* ---- grounding helpers -------------------------------------------- */

function buildSources(
  snapshot: WorkspaceSnapshot,
  search: SearchResults | null,
): { sources: AskSource[]; taskById: Map<string, { ref: string; line: string }> } {
  const sources: AskSource[] = [];
  const taskById = new Map<string, { ref: string; line: string }>();
  let n = 0;
  const nextRef = () => `S${(n += 1)}`;

  // Snapshot tasks first — the state that answers most questions.
  for (const t of snapshot.tasks) {
    const ref = nextRef();
    sources.push({
      ref,
      type: "task",
      title: t.name,
      url: `/list?id=${t.listId}&task=${t.id}`,
    });
    const owners = t.assignees.length ? t.assignees.map((a) => a.name).join(", ") : "unassigned";
    const state = t.done
      ? t.completedRecently
        ? "Done (this week)"
        : "Done"
      : t.overdue
        ? "Open · OVERDUE"
        : t.status
          ? `Open · ${t.status}`
          : "Open";
    const due = t.due ? ` · due ${t.due.slice(0, 10)}` : "";
    taskById.set(t.id, {
      ref,
      line: `${ref} [task] "${t.name}" — ${state} — owner: ${owners}${due} — space: ${t.spaceName}`,
    });
  }

  // Then relevant non-task hits from search (docs, lists, etc.).
  if (search) {
    const pushHit = (type: AskSource["type"], title: string, url: string) => {
      if (!title) return;
      sources.push({ ref: nextRef(), type, title, url });
    };
    for (const l of search.lists) pushHit("list", l.name, `/list?id=${l.id}`);
    for (const d of search.docs) pushHit("doc", d.name, `/doc?id=${d.id}`);
    for (const s of search.spaces) pushHit("space", s.name, `/space?id=${s.id}`);
    for (const g of search.goals) pushHit("goal", g.name, `/goal?id=${g.id}`);
    for (const w of search.whiteboards) pushHit("whiteboard", w.name, `/whiteboard?id=${w.id}`);
    for (const c of search.channels) pushHit("channel", c.name, `/chat?c=${c.id}`);
  }

  return { sources: sources.slice(0, 40), taskById };
}

function buildPrompt(
  question: string,
  snapshot: WorkspaceSnapshot,
  sources: AskSource[],
  taskById: Map<string, { ref: string; line: string }>,
): string {
  const c = snapshot.counts;
  const header =
    `Workspace state: ${c.openTasks} open task(s), ${c.overdue} overdue, ` +
    `${c.completedThisWeek} completed in the last 7 days, ${c.members} member(s) ` +
    `across ${c.spaces} space(s).`;

  const taskLines = [...taskById.values()].map((t) => t.line);
  const otherLines = sources
    .filter((s) => s.type !== "task")
    .map((s) => `${s.ref} [${s.type}] "${s.title}"`);

  const parts = [header];
  if (snapshot.spaces.length) {
    parts.push(
      "\nSpaces & lists:\n" +
        snapshot.spaces
          .map(
            (s) =>
              `- ${s.name}${s.lists.length ? ": " + s.lists.map((l) => l.name).join(", ") : " (no lists)"}`,
          )
          .join("\n"),
    );
  }
  if (snapshot.members.length) {
    parts.push("\nMembers: " + snapshot.members.map((m) => m.name).join(", "));
  }
  if (taskLines.length) parts.push("\nTasks:\n" + taskLines.join("\n"));
  if (otherLines.length) parts.push("\nRelevant items:\n" + otherLines.join("\n"));
  if (taskLines.length === 0 && otherLines.length === 0 && snapshot.spaces.length === 0) {
    parts.push("\n(No tasks or items are visible to summarize.)");
  }
  parts.push(`\nQuestion: ${question}\n\nAnswer from this state and list the refs you used.`);
  return parts.join("\n");
}

function heuristicAnswer(question: string, snapshot: WorkspaceSnapshot): string {
  const c = snapshot.counts;
  if (c.openTasks === 0 && c.completedThisWeek === 0 && snapshot.tasks.length === 0) {
    return "There's no task activity to report yet. Once you add tasks, I can summarize progress here.";
  }
  const lines = [
    `Here's where the workspace stands: ${c.openTasks} open task(s), ${c.overdue} overdue, and ${c.completedThisWeek} completed in the last 7 days.`,
  ];
  const overdue = snapshot.tasks.filter((t) => t.overdue).slice(0, 5);
  if (overdue.length) {
    lines.push(
      "Overdue: " +
        overdue
          .map((t) => `${t.name}${t.assignees[0] ? ` (${t.assignees[0].name})` : ""}`)
          .join(", "),
    );
  }
  const doneWeek = snapshot.tasks.filter((t) => t.completedRecently).slice(0, 5);
  if (doneWeek.length) {
    lines.push("Completed this week: " + doneWeek.map((t) => t.name).join(", "));
  }
  return lines.join("\n");
}
