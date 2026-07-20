import { Injectable, Logger } from "@nestjs/common";
import { loadConfig } from "../config";

/**
 * Pluggable LLM provider for the AI Brain (M15).
 *
 * When ANTHROPIC_API_KEY is set the provider talks to Claude
 * (claude-opus-4-8 by default) through the official @anthropic-ai/sdk, using
 * adaptive thinking and streaming so long generations never hit a request
 * timeout. When no key is present `available()` is false and every AI service
 * method falls back to a deterministic, offline heuristic — so the feature is
 * fully functional (and testable) with or without credentials, and lights up
 * real Claude automatically the moment a key appears in the environment.
 *
 * The SDK is imported lazily inside complete(): a keyless deployment never
 * loads it, and the module has no hard runtime dependency on it.
 */
@Injectable()
export class AiProvider {
  private readonly logger = new Logger(AiProvider.name);
  private readonly config = loadConfig();
  // Cached SDK client; created on first use when a key is present.
  private client: unknown = null;

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
      const stream = (
        client as {
          messages: {
            stream: (args: Record<string, unknown>) => {
              finalMessage: () => Promise<{
                content: Array<{ type: string; text?: string }>;
              }>;
            };
          };
        }
      ).messages.stream({
        model: this.config.aiModel,
        max_tokens: maxTokens,
        // Adaptive thinking is the documented default for Opus 4.6+ — no
        // budget_tokens (rejected on this model family).
        thinking: { type: "adaptive" },
        system,
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

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;
    // Lazy dynamic import so keyless deployments never load the SDK.
    const mod = (await import("@anthropic-ai/sdk")) as unknown as {
      default: new (opts: { apiKey: string }) => unknown;
    };
    const Anthropic = mod.default;
    this.client = new Anthropic({ apiKey: this.config.anthropicApiKey });
    return this.client;
  }
}
