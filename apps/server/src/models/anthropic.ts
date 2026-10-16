import Anthropic from "@anthropic-ai/sdk";
import type { GenerateRequest, GenerateResult, ModelProvider } from "./types.js";
import { ModelOutputError } from "./types.js";

/** Anthropic adapter using the official SDK. Only constructed when ANTHROPIC_API_KEY is configured. */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async generate(model: string, req: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.client.messages.create(
        {
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
        },
        { signal: req.signal },
      );
      if (response.stop_reason === "refusal") {
        throw new ModelOutputError("The model declined this request", false);
      }
      if (response.stop_reason === "max_tokens") {
        throw new ModelOutputError("The model output was cut off at the token limit", true);
      }
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (!text.trim()) throw new ModelOutputError("The model returned no text", true);
      return {
        text,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason ?? "unknown",
      };
    } catch (err) {
      if (err instanceof ModelOutputError) throw err;
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        throw new ModelOutputError(`Provider temporarily unavailable: ${(err as Error).message}`, true);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ModelOutputError(`Provider rejected the request (${err.status ?? "unknown"})`, false);
      }
      throw err;
    }
  }
}
