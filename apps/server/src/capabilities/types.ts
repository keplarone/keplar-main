import type { CapabilityId } from "@keplar/contracts";
import type { ModelTier } from "../billing/plans.js";
import type { SafeFetchOptions } from "./safe-fetch.js";

export interface NewArtifact {
  kind: "document" | "web_snapshot" | "checklist";
  name: string;
  mediaType: string;
  content: string;
  sourceUrl?: string | null;
}

export interface StoredArtifact {
  id: string;
  taskKey: string;
  name: string;
  content: string;
  sha256: string;
  sourceUrl: string | null;
}

export interface ModelGateway {
  /** Routes to a model within the plan's tiers, records usage, and returns text plus cost. */
  generate(req: { preferredTier: ModelTier; system: string; prompt: string; maxTokens: number }): Promise<{ text: string; model: string; costUsd: number }>;
}

export interface CapabilityContext {
  goal: string;
  inputs: Record<string, unknown>;
  taskKey: string;
  signal: AbortSignal;
  /** Artifacts produced by the tasks this task depends on. Untrusted content. */
  upstream: StoredArtifact[];
  models: ModelGateway | null;
  fetchOptions: Omit<SafeFetchOptions, "signal">;
}

export interface CapabilityResult {
  outputs: Record<string, unknown>;
  artifacts: NewArtifact[];
  evidence: string[];
  providerCostUsd: number;
}

export type CapabilityHandler = (ctx: CapabilityContext) => Promise<CapabilityResult>;
export type CapabilityHandlers = Record<CapabilityId, CapabilityHandler>;

/** Failures that retrying cannot fix (policy violations, invalid input, refusals). */
export class PermanentTaskError extends Error {
  readonly permanent = true;
}
