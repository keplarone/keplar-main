import { optionalEnv } from "./env";

// OpenRouter credit (USD) granted every time a plan payment succeeds,
// including each renewal.
export const PLAN_CREDITS_USD = {
  lite: 4.8,
  plus: 12,
  pro: 27,
} as const;

export type Tier = keyof typeof PLAN_CREDITS_USD;

export type Grant =
  | { kind: "plan"; tier: Tier; amountUsd: number }
  | { kind: "pack"; amountUsd: number };

function idList(name: string): string[] {
  return (optionalEnv(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Whop plan ids per tier, comma separated so a tier can have several plans
// (e.g. monthly and yearly): WHOP_PLAN_IDS_LITE=plan_abc,plan_def
export function tierForPlan(planId: string): Tier | undefined {
  for (const tier of Object.keys(PLAN_CREDITS_USD) as Tier[]) {
    if (idList(`WHOP_PLAN_IDS_${tier.toUpperCase()}`).includes(planId)) return tier;
  }
  return undefined;
}

// One-time "buy more credits" packs: WHOP_CREDIT_PACKS={"plan_xyz":5,"plan_uvw":10}
// maps a Whop one-time plan to the OpenRouter credit (USD) it grants.
export function creditPacks(): Record<string, number> {
  const raw = optionalEnv("WHOP_CREDIT_PACKS");
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("WHOP_CREDIT_PACKS must be a JSON object");
  const packs: Record<string, number> = {};
  for (const [planId, amount] of Object.entries(parsed)) {
    if (typeof amount !== "number" || !(amount > 0)) throw new Error(`Invalid credit amount for ${planId}`);
    packs[planId] = amount;
  }
  return packs;
}

export function grantForPlan(planId: string): Grant | undefined {
  const tier = tierForPlan(planId);
  if (tier) return { kind: "plan", tier, amountUsd: PLAN_CREDITS_USD[tier] };
  const pack = creditPacks()[planId];
  if (pack) return { kind: "pack", amountUsd: pack };
  return undefined;
}
