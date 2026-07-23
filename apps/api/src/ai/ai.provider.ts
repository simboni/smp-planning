import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "../config";

/**
 * Pluggable LLM provider for the AI Brain (M15).
 *
 * When ANTHROPIC_API_KEY is set the provider talks to Claude
 * (claude-opus-4-8 by default) through the official @anthropic-ai/sdk, using
 * streaming so long generations never hit a request timeout. When no key is
 * present `available()` is false and every AI service method falls back to a
 * deterministic, offline heuristic — so the feature is fully functional (and
 * testable) with or without credentials, and lights up real Claude
 * automatically the moment a key appears in the environment.
 *
 * Two call shapes:
 *   - complete()      → free text (writing, summaries). Adaptive thinking.
 *   - completeJson()  → a schema-constrained object via a forced tool call, so
 *                       the model CANNOT return prose or malformed JSON. This
 *                       is what powers the AI Builder's plans — it removes the
 *                       whole "AI returned something we can't parse" class of
 *                       bug. (Forced tool use is incompatible with extended
 *                       thinking, so this path runs without it.)
 *
 * Prompt caching: the (stable) system prompt is sent as a cached block, so
 * repeated calls in a session pay for it once — cheap enough to keep grounding
 * always on.
 *
 * The SDK is imported lazily: a keyless deployment never loads it.
 */

/** Minimal shape of the Anthropic streaming client we rely on. */
interface StreamClient {
  messages: {
    stream: (args: Record<string, unknown>) => {
      finalMessage: () => Promise<{
        content: Array<{ type: string; text?: string; input?: unknown }>;
      }>;
    };
  };
}

/** A cacheable system block — stable prefix, cached across calls in a window. */
function cachedSystem(text: string) {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

@Injectable()
export class AiProvider {
  private readonly logger = new Logger(AiProvider.name);
  private readonly config = loadConfig();
  // Cached SDK client; created on first use when a key is present.
  private client: StreamClient | null = null;

  /** True when a real model is reachable (an API key is configured). */
  available(): boolean {
    return this.config.anthropicApiKey.length > 0;
  }

  /** The model id the provider will call. */
  model(): string {
    return this.config.aiModel;
  }

  /**
   * Complete a prompt. Returns the model's text, or null when no key is
   * configured OR the call fails — callers treat null as "use the heuristic".
   * Never throws: the AI Brain degrades, it does not error the request.
   */
  async complete(
    system: string,
    prompt: string,
    maxTokens = 1024,
  ): Promise<string | null> {
    if (!this.available()) return null;
    try {
      const client = await this.getClient();
      // Stream and collect: robust for long outputs / high max_tokens.
      const stream = client.messages.stream({
        model: this.config.aiModel,
        max_tokens: maxTokens,
        // Adaptive thinking is the documented default for Opus 4.6+ — no
        // budget_tokens (rejected on this model family).
        thinking: { type: "adaptive" },
        system: cachedSystem(system),
        messages: [{ role: "user", content: prompt }],
      });
      const message = await stream.finalMessage();
      const text = message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim();
      return text.length > 0 ? text : null;
    } catch (err) {
      this.logger.warn(
        `AI provider call failed, using heuristic fallback: ${
          (err as Error).message
        }`,
      );
      return null;
    }
  }

  /**
   * Complete a prompt and return a value constrained to `schema` (a JSON
   * Schema). Implemented as a forced single-tool call, so the model's reply is
   * always a validated object of that shape — never prose, never broken JSON.
   * Returns null when no key is configured or the call fails; callers then fall
   * back to a text completion + tolerant parse, and ultimately the heuristic.
   */
  async completeJson(
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    maxTokens = 2048,
  ): Promise<unknown | null> {
    if (!this.available()) return null;
    try {
      const client = await this.getClient();
      const stream = client.messages.stream({
        model: this.config.aiModel,
        max_tokens: maxTokens,
        system: cachedSystem(system),
        // One tool, forced — the model must reply by "emitting" the result.
        tools: [
          {
            name: "emit_result",
            description: "Return the structured result for the request.",
            input_schema: schema,
          },
        ],
        tool_choice: { type: "tool", name: "emit_result" },
        messages: [{ role: "user", content: prompt }],
      });
      const message = await stream.finalMessage();
      const block = message.content.find(
        (b) => b.type === "tool_use" && b.input && typeof b.input === "object",
      );
      return block ? (block.input as unknown) : null;
    } catch (err) {
      this.logger.warn(
        `AI structured call failed, falling back: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async getClient(): Promise<StreamClient> {
    if (this.client) return this.client;
    // Lazy dynamic import so keyless deployments never load the SDK.
    const mod = (await import("@anthropic-ai/sdk")) as unknown as {
      default: new (opts: { apiKey: string }) => StreamClient;
    };
    const Anthropic = mod.default;
    this.client = new Anthropic({ apiKey: this.config.anthropicApiKey });
    return this.client;
  }
}
