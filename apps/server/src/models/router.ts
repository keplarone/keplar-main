import type { ModelTier } from "../billing/plans.js";
import { MODEL_REGISTRY } from "./registry.js";
import type { ModelProvider, ModelSpec } from "./types.js";

const TIER_ORDER: ModelTier[] = ["light", "standard", "complex"];

export interface RouteRequest {
  /** The cheapest tier that can do this task well. */
  preferredTier: ModelTier;
  /** Tiers the workspace plan allows. */
  allowedTiers: ModelTier[];
  availableProviders: ModelProvider["name"][];
}

/**
 * Cost-aware routing: start at the preferred tier, never exceed what the plan allows, and fall back
 * to cheaper allowed tiers rather than escalating. Returns candidates in fallback order.
 */
export function routeModel(req: RouteRequest, registry: ModelSpec[] = MODEL_REGISTRY): ModelSpec[] {
  const allowed = new Set(req.allowedTiers);
  const preferredIdx = TIER_ORDER.indexOf(req.preferredTier);
  const tiers = [
    ...TIER_ORDER.slice(0, preferredIdx + 1).reverse(), // preferred, then cheaper
  ].filter((t) => allowed.has(t));
  const candidates: ModelSpec[] = [];
  for (const tier of tiers) {
    for (const m of registry) {
      if (m.tier === tier && req.availableProviders.includes(m.provider)) candidates.push(m);
    }
  }
  return candidates;
}
