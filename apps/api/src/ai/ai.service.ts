import { Injectable, NotFoundException } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { AiProvider } from "./ai.provider";

export type WriteAction = "improve" | "expand" | "shorten" | "fix" | "draft";

export interface AiCommand {
  intent: "create_task" | "search" | "unknown";
  // For create_task: the task name and optional list hint.
  taskName?: string;
  listHint?: string;
  // For search: the query string.
  query?: string;
  raw: string;
}

/**
 * AI Brain (M15). Every method has two paths: a Claude call via AiProvider
 * when a key is configured, and a deterministic heuristic when it is not —
 * so the endpoints always return something useful. `source` in each result
 * tells the client which path produced the text ('claude' | 'heuristic').
 */
@Injectable()
export class AiService {
  constructor(
    private readonly db: DbService,
    private readonly ai: AiProvider,
  ) {}

  status() {
    return { available: this.ai.available(), model: this.ai.model() };
  }

  /** Generate or transform prose (task descriptions, docs, comments). */
  async write(
    action: WriteAction,
    text: string,
    tone?: string,
  ): Promise<{ text: string; source: "claude" | "heuristic" }> {
    const system =
      "You are StackUp's writing assistant inside a project-management app. " +
      "Return only the rewritten text — no preamble, no quotes, no markdown fences.";
    const toneClause = tone ? ` Use a ${tone} tone.` : "";
    const instruction: Record<WriteAction, string> = {
      improve: "Improve the clarity, grammar and flow of the following text.",
      expand: "Expand the following into a fuller, well-structured description.",
      shorten: "Shorten the following to its essential points.",
      fix: "Fix spelling and grammar in the following text.",
      draft: "Write a clear, professional draft based on this brief.",
    };
    const prompt = `${instruction[action]}${toneClause}\n\n${text}`;
    const out = await this.ai.complete(system, prompt, 1200);
    if (out) return { text: out, source: "claude" };
    return { text: heuristicWrite(action, text), source: "heuristic" };
  }

  /** Summarize arbitrary text into a few bullet points. */
  async summarize(
    text: string,
  ): Promise<{ text: string; source: "claude" | "heuristic" }> {
    const out = await this.ai.complete(
      "You summarize project content. Reply with 2–4 concise bullet points, each starting with '- '.",
      `Summarize:\n\n${text}`,
      600,
    );
    if (out) return { text: out, source: "claude" };
    return { text: heuristicSummary(text), source: "heuristic" };
  }

  /** Summarize a task from its name, description and comment thread. */
  async taskSummary(
    workspaceId: string,
    userId: string,
    taskId: string,
  ): Promise<{ text: string; source: "claude" | "heuristic" }> {
    const data = await this.db.withWorkspace(workspaceId, userId, async (c) => {
      const t = await c.query(
        "SELECT name, description FROM tasks WHERE id = $1",
        [taskId],
      );
      if (t.rowCount === 0) return null;
      const comments = await c.query(
        `SELECT u.full_name AS author, m.body
           FROM comments m JOIN users u ON u.id = m.author_user_id
          WHERE m.task_id = $1 ORDER BY m.created_at LIMIT 50`,
        [taskId],
      );
      return {
        name: t.rows[0].name as string,
        description: t.rows[0].description as string,
        comments: comments.rows as { author: string; body: string }[],
      };
    });
    if (!data) throw new NotFoundException("Task not found");

    const thread = data.comments
      .map((c) => `${c.author}: ${c.body}`)
      .join("\n");
    const body = `Task: ${data.name}\n\nDescription:\n${
      data.description || "(none)"
    }\n\nComments:\n${thread || "(none)"}`;
    const out = await this.ai.complete(
      "You are a project assistant. Summarize the task's current state, key decisions, and any open questions in 2–4 bullets starting with '- '.",
      body,
      700,
    );
    if (out) return { text: out, source: "claude" };
    return { text: heuristicTaskSummary(data), source: "heuristic" };
  }

  /** Suggest a checklist of subtasks for a task (or a free-text brief). */
  async subtasks(
    workspaceId: string,
    userId: string,
    opts: { taskId?: string; prompt?: string },
  ): Promise<{ items: string[]; source: "claude" | "heuristic" }> {
    let brief = opts.prompt ?? "";
    if (opts.taskId) {
      const t = await this.db.withWorkspace(workspaceId, userId, async (c) => {
        const r = await c.query(
          "SELECT name, description FROM tasks WHERE id = $1",
          [opts.taskId],
        );
        return r.rows[0] as { name: string; description: string } | undefined;
      });
      if (!t) throw new NotFoundException("Task not found");
      brief = `${t.name}\n${t.description}`.trim();
    }
    const out = await this.ai.complete(
      "Break the work into 3–7 concrete, actionable subtasks. Reply with one subtask per line, no numbering, no bullets.",
      `Work item:\n${brief}`,
      500,
    );
    if (out) {
      const items = out
        .split("\n")
        .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
        .filter((l) => l.length > 0)
        .slice(0, 10);
      if (items.length > 0) return { items, source: "claude" };
    }
    return { items: heuristicSubtasks(brief), source: "heuristic" };
  }

  /**
   * Parse a natural-language command into a structured action the client can
   * execute (create a task, run a search). The heuristic covers the common
   * "create/add … task" and "find/search …" shapes; Claude handles the rest.
   */
  async command(text: string): Promise<AiCommand> {
    const trimmed = text.trim();
    if (this.ai.available()) {
      const out = await this.ai.complete(
        "You convert a user's natural-language request into JSON for a project app. " +
          'Reply ONLY with JSON: {"intent":"create_task|search|unknown","taskName":string?,"listHint":string?,"query":string?}. No prose.',
        trimmed,
        300,
      );
      if (out) {
        try {
          const json = JSON.parse(out.replace(/```json|```/g, "").trim());
          return {
            intent: ["create_task", "search"].includes(json.intent)
              ? json.intent
              : "unknown",
            taskName: json.taskName,
            listHint: json.listHint,
            query: json.query,
            raw: trimmed,
          };
        } catch {
          // fall through to heuristic
        }
      }
    }
    return heuristicCommand(trimmed);
  }
}

/* ---- Heuristic fallbacks (offline, deterministic) ------------------ */

function heuristicWrite(action: WriteAction, text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  switch (action) {
    case "shorten": {
      const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
      return first.length < clean.length ? first : clean.slice(0, 140);
    }
    case "expand":
      return (
        clean +
        "\n\nContext & next steps:\n- Clarify the goal and success criteria.\n" +
        "- Identify owners and dependencies.\n- Define a checklist to track progress."
      );
    case "fix":
    case "improve":
    default: {
      const sentence = clean.replace(/\s+([.!?,])/g, "$1");
      return sentence.charAt(0).toUpperCase() + sentence.slice(1);
    }
  }
}

function heuristicSummary(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  const top = sentences.slice(0, 3);
  if (top.length === 0) return "- " + text.replace(/\s+/g, " ").trim();
  return top.map((s) => `- ${s}`).join("\n");
}

function heuristicTaskSummary(data: {
  name: string;
  description: string;
  comments: { author: string; body: string }[];
}): string {
  const lines = [`- Task “${data.name}”.`];
  if (data.description.trim()) {
    lines.push(`- ${firstSentence(data.description)}`);
  }
  if (data.comments.length > 0) {
    const last = data.comments[data.comments.length - 1];
    lines.push(
      `- ${data.comments.length} comment(s); latest from ${last.author}: ${firstSentence(last.body)}`,
    );
  } else {
    lines.push("- No discussion yet.");
  }
  return lines.join("\n");
}

function heuristicSubtasks(brief: string): string[] {
  const base = brief.replace(/\s+/g, " ").trim() || "the task";
  const noun = base.split(/[.\n]/)[0].slice(0, 60);
  return [
    `Define scope and acceptance criteria for ${noun}`,
    `Break down the work and identify dependencies`,
    `Implement the core of ${noun}`,
    `Review and test the result`,
    `Document and hand off`,
  ];
}

function heuristicCommand(text: string): AiCommand {
  const lower = text.toLowerCase();
  const createMatch = lower.match(
    /^(?:create|add|new|make)\s+(?:a\s+)?(?:task\s+)?(.*?)(?:\s+(?:in|to|under)\s+(.+))?$/,
  );
  if (/^(create|add|new|make)\b/.test(lower) && createMatch) {
    const name = (createMatch[1] || text).replace(/\btask\b/gi, "").trim();
    return {
      intent: "create_task",
      taskName: name || text,
      listHint: createMatch[2]?.trim(),
      raw: text,
    };
  }
  if (/^(find|search|show|list|where)\b/.test(lower)) {
    return {
      intent: "search",
      query: text.replace(/^(find|search|show|list|where(?:'s| is)?)\s+/i, "").trim(),
      raw: text,
    };
  }
  return { intent: "unknown", raw: text };
}

function firstSentence(s: string): string {
  const clean = s.replace(/\s+/g, " ").trim();
  const m = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return m.length > 160 ? m.slice(0, 157) + "…" : m;
}
