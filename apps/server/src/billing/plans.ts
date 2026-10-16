/**
 * Plan catalogue. Prices and limits are initial commercial hypotheses (see docs/PRICING_AND_UNIT_ECONOMICS.md),
 * not validated numbers. Enforcement reads only from here, server-side.
 */
export type ModelTier = "light" | "standard" | "complex";

export interface PlanDefinition {
  id: "free" | "pro" | "plus" | "business" | "enterprise";
  name: string;
  monthlyPriceUsd: number | null; // null = negotiated
  monthlyRequests: number;
  monthlyExecutionCreditsMc: number;
  activeProjects: number;
  /** Hard ceiling for a single execution, protecting both the user and Keplar. */
  maxCreditsPerExecutionMc: number;
  modelTiers: ModelTier[];
  features: {
    businessWorkflows: boolean;
    scheduledExecution: boolean;
    advancedCoding: boolean;
    paidThirdPartyOperations: boolean;
  };
  /** Monthly provider-cost guardrail in USD for this plan's included usage. */
  providerCostBudgetUsd: number | null;
}

export const PLANS: Record<PlanDefinition["id"], PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    monthlyPriceUsd: 0,
    monthlyRequests: 30,
    monthlyExecutionCreditsMc: 5_000,
    activeProjects: 1,
    maxCreditsPerExecutionMc: 2_000,
    modelTiers: ["light"],
    features: { businessWorkflows: false, scheduledExecution: false, advancedCoding: false, paidThirdPartyOperations: false },
    providerCostBudgetUsd: 0.75,
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceUsd: 39,
    monthlyRequests: 500,
    monthlyExecutionCreditsMc: 60_000,
    activeProjects: 5,
    maxCreditsPerExecutionMc: 10_000,
    modelTiers: ["light", "standard"],
    features: { businessWorkflows: false, scheduledExecution: false, advancedCoding: false, paidThirdPartyOperations: false },
    providerCostBudgetUsd: 9.75,
  },
  plus: {
    id: "plus",
    name: "Plus",
    monthlyPriceUsd: 99,
    monthlyRequests: 1_500,
    monthlyExecutionCreditsMc: 200_000,
    activeProjects: 20,
    maxCreditsPerExecutionMc: 25_000,
    modelTiers: ["light", "standard", "complex"],
    features: { businessWorkflows: false, scheduledExecution: false, advancedCoding: true, paidThirdPartyOperations: false },
    providerCostBudgetUsd: 29.7,
  },
  business: {
    id: "business",
    name: "Business",
    monthlyPriceUsd: 299,
    monthlyRequests: 4_000,
    monthlyExecutionCreditsMc: 600_000,
    activeProjects: 50,
    maxCreditsPerExecutionMc: 50_000,
    modelTiers: ["light", "standard", "complex"],
    features: { businessWorkflows: true, scheduledExecution: true, advancedCoding: true, paidThirdPartyOperations: true },
    providerCostBudgetUsd: 89.7,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    monthlyPriceUsd: null,
    monthlyRequests: 20_000,
    monthlyExecutionCreditsMc: 3_000_000,
    activeProjects: 500,
    maxCreditsPerExecutionMc: 200_000,
    modelTiers: ["light", "standard", "complex"],
    features: { businessWorkflows: true, scheduledExecution: true, advancedCoding: true, paidThirdPartyOperations: true },
    providerCostBudgetUsd: null,
  },
};

export function getPlan(planId: string): PlanDefinition {
  const plan = PLANS[planId as PlanDefinition["id"]];
  if (!plan) throw new Error(`Unknown plan ${planId}`);
  return plan;
}
