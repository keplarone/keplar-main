import type { ModelSpec } from "./types.js";

/**
 * Capability registry. Prices are Anthropic's published first-party rates as of 2026-10 and must be
 * re-verified before launch. OpenAI and Google entries are intentionally absent: no adapter exists
 * yet, and listing a model implies Keplar can call it.
 */
export const MODEL_REGISTRY: ModelSpec[] = [
  {
    id: "claude-haiku-5-5",
    provider: "anthropic",
    tier: "light",
    modalities: ["text", "image"],
    toolCalling: true,
    contextTokens: 1_000_000,
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    suitableFor: ["classification", "extraction", "short drafting", "checklists"],
  },
  {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    tier: "standard",
    modalities: ["text", "image"],
    toolCalling: true,
    contextTokens: 1_000_000,
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    suitableFor: ["research synthesis", "long-form writing", "coding"],
  },
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    tier: "complex",
    modalities: ["text", "image"],
    toolCalling: true,
    contextTokens: 1_000_000,
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    suitableFor: ["architecture", "debugging", "multi-step reasoning"],
  },
];

export function costUsd(spec: ModelSpec, inputTokens: number, outputTokens: number): number {
  return (inputTokens * spec.inputUsdPerMTok + outputTokens * spec.outputUsdPerMTok) / 1_000_000;
}
