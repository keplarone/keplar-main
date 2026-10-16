/**
 * Weighted metering. Provider spend converts to credits at a fixed rate chosen so that included
 * usage keeps variable cost near 20–25% of Pro revenue ($39 / 60 credits ≈ $0.65 per credit).
 * See docs/PRICING_AND_UNIT_ECONOMICS.md. This is a hypothesis to validate with real usage data.
 */
export const PROVIDER_USD_PER_CREDIT = 0.15;

export function providerCostToMc(costUsd: number): number {
  if (!(costUsd > 0)) return 0;
  return Math.ceil((costUsd / PROVIDER_USD_PER_CREDIT) * 1000);
}

/** Charge for one task: its base cost plus provider spend, never above the approved task budget. */
export function taskChargeMc(baseCostMc: number, providerCostUsd: number, budgetMc: number): number {
  return Math.min(budgetMc, baseCostMc + providerCostToMc(providerCostUsd));
}
