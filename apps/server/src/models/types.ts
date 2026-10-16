import type { ModelTier } from "../billing/plans.js";

export interface ModelSpec {
  id: string;
  provider: "anthropic" | "openai" | "google";
  tier: ModelTier;
  modalities: ("text" | "image")[];
  toolCalling: boolean;
  contextTokens: number;
  /** USD per million tokens, from the provider's published price list. Re-check before launch. */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  suitableFor: string[];
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

/** Provider adapter. Implementations must surface refusals, truncation and errors, never paper over them. */
export interface ModelProvider {
  readonly name: ModelSpec["provider"];
  generate(model: string, req: GenerateRequest): Promise<GenerateResult>;
}

export class ModelOutputError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}
