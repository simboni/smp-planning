import { Injectable } from "@nestjs/common";
import type { Role } from "@stackup/shared";
import { AiProvider } from "./ai.provider";
import { SearchService, type SearchResults } from "../search/search.service";

/**
 * Ask (Copilot Q&A) — answers a natural-language question grounded in the
 * user's workspace instead of building anything.
 *
 * Grounding: we run the workspace search (permission-safe — it only returns
 * items the caller can see) and hand the hits to Claude as numbered sources.
 * The model must answer ONLY from those sources and report which ones it used,
 * so every answer is attributable (no confidently-wrong, un-cited output).
 * Falls back to a plain "here's what I found" listing when no key is set.
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
  "You are StackUp's assistant. Answer the user's question ONLY from the " +
  "workspace items provided as numbered sources. Be concise and specific. " +
  "Reference the items you rely on and list their refs in usedRefs. If the " +
  "sources don't contain the answer, say you couldn't find it in the workspace " +
  "— never invent tasks, dates, names or statuses.";

@Injectable()
export class AiAskService {
  constructor(
    private readonly ai: AiProvider,
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

    // Gather grounding: search returns only items the caller can see.
    let results: SearchResults;
    try {
      const r = await this.search.search(workspaceId, userId, role, q, 8);
      results = r.results;
    } catch {
      results = {
        tasks: [], lists: [], spaces: [], docs: [], goals: [],
        whiteboards: [], channels: [],
      };
    }
    const sources = toSources(results);

    if (!this.ai.available()) {
      return { answer: heuristicAnswer(q, sources), sources, source: "heuristic" };
    }

    const prompt = buildPrompt(q, sources);
    const structured = (await this.ai.completeJson(
      SYSTEM_ASK,
      prompt,
      ASK_SCHEMA,
      900,
    )) as { answer?: unknown; usedRefs?: unknown } | null;

    if (structured && typeof structured.answer === "string") {
      const used = Array.isArray(structured.usedRefs)
        ? new Set(structured.usedRefs.filter((r): r is string => typeof r === "string"))
        : null;
      const cited = used
        ? sources.filter((s) => used.has(s.ref))
        : sources.slice(0, 4);
      return {
        answer: structured.answer.trim() || heuristicAnswer(q, sources),
        sources: cited.length > 0 ? cited : sources.slice(0, 4),
        source: "claude",
      };
    }

    // Fallback: plain text answer over the same grounding.
    const text = await this.ai.complete(SYSTEM_ASK, prompt, 900);
    if (text) {
      return { answer: text.trim(), sources: sources.slice(0, 4), source: "claude" };
    }
    return { answer: heuristicAnswer(q, sources), sources, source: "heuristic" };
  }
}

/* ---- helpers ------------------------------------------------------- */

function toSources(r: SearchResults): AskSource[] {
  const out: AskSource[] = [];
  let n = 0;
  const push = (type: AskSource["type"], title: string, url: string) => {
    if (!title) return;
    n += 1;
    out.push({ ref: `S${n}`, type, title, url });
  };
  for (const t of r.tasks) push("task", t.title, `/list?id=${t.listId}&task=${t.id}`);
  for (const l of r.lists) push("list", l.name, `/list?id=${l.id}`);
  for (const s of r.spaces) push("space", s.name, `/space?id=${s.id}`);
  for (const d of r.docs) push("doc", d.name, `/doc?id=${d.id}`);
  for (const g of r.goals) push("goal", g.name, `/goal?id=${g.id}`);
  for (const w of r.whiteboards) push("whiteboard", w.name, `/whiteboard?id=${w.id}`);
  for (const c of r.channels) push("channel", c.name, `/chat?c=${c.id}`);
  return out.slice(0, 16);
}

function buildPrompt(question: string, sources: AskSource[]): string {
  if (sources.length === 0) {
    return `Question: ${question}\n\nNo matching workspace items were found. Say you couldn't find anything relevant in the workspace.`;
  }
  const lines = sources.map((s) => `${s.ref} [${s.type}] ${s.title}`);
  return `Question: ${question}\n\nWorkspace sources:\n${lines.join("\n")}\n\nAnswer from these sources only, and list the refs you used.`;
}

function heuristicAnswer(question: string, sources: AskSource[]): string {
  if (sources.length === 0) {
    return `I couldn't find anything in your workspace matching "${question}".`;
  }
  const top = sources.slice(0, 5).map((s) => `• ${s.title} (${s.type})`);
  return `Here's what I found related to "${question}":\n${top.join("\n")}`;
}
