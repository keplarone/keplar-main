import type { CapabilityGap } from "@keplar/contracts";

/**
 * Deterministic goal interpretation (planner v1). It never calls a model, so classification is free,
 * reproducible and testable. Model-assisted planning slots in behind the same interface later.
 */
export type IntentKind = "research" | "document" | "checklist";

export interface Intent {
  kind: IntentKind;
  urls: string[];
  gaps: CapabilityGap[];
  title: string;
}

const MAX_URLS = 5;
const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

interface GapRule {
  category: string;
  pattern: RegExp;
  description: string;
  followUp: string;
}

// Actions Keplar cannot perform yet. Detected honestly instead of being silently "done" by a model.
const GAP_RULES: GapRule[] = [
  {
    category: "payments",
    pattern: /\b(pay for|pay the|purchase|buy|checkout|place an order|order (?:a|an|the|some|\d+)|subscribe to|transfer (?:money|funds)|wire (?:money|funds))\b/i,
    description: "Making purchases or payments",
    followUp: "Complete the purchase yourself; Keplar has no payment integration enabled.",
  },
  {
    category: "booking",
    pattern: /\b(?:book|reserve)\s+(?:(?:a|an|the|my|our|me|us|two|three|four|five|six|\d+)\s+)?(?:flights?|hotels?|tables?|rooms?|tickets?|appointments?|seats?|cars?|trips?|venues?|restaurants?)\b|\bmake a reservation\b|\bschedule an? appointment\b/i,
    description: "Booking or reserving services",
    followUp: "Book it directly with the provider; no booking provider is connected.",
  },
  {
    category: "messaging",
    pattern: /\b(?:send|forward|dm)\b[^.]*\b(?:to|them|him|her|team|customers?|clients?|list|everyone)\b|\be-?mail (?:it|this|them|everyone|my|our|the)\b/i,
    description: "Sending email or messages on your behalf",
    followUp: "Send it yourself; no email or messaging integration is connected.",
  },
  {
    category: "deployment",
    pattern: /\b(?:deploy|launch|publish|host|go live)\b[^.]*\b(?:site|website|app|application|server|api|online|production|live|internet)\b|\bdeploy\b/i,
    description: "Deploying or publishing to the internet",
    followUp: "Deployment integrations are not enabled yet.",
  },
  {
    category: "app_builder",
    pattern: /\b(build|code|develop|program|implement)\b[^.]*\b(app|application|website|site|api|backend|frontend|saas)\b/i,
    description: "Generating and running application code",
    followUp: "Keplar can write the project brief now; code generation arrives with the app builder.",
  },
];

const RESEARCH_RE = /\b(research|investigate|compare|summari[sz]e|analy[sz]e|find out|review|sources?|read)\b/i;
const CHECKLIST_RE = /\b(checklist|to-?do|todo|steps|organi[sz]e|plan my|action items?|tasks? list|itinerary)\b/i;

export function extractUrls(goal: string): string[] {
  const seen = new Set<string>();
  for (const match of goal.matchAll(URL_RE)) {
    try {
      const u = new URL(match[0]);
      if (u.protocol === "http:" || u.protocol === "https:") seen.add(u.toString());
    } catch {
      // not a URL after all
    }
    if (seen.size >= MAX_URLS) break;
  }
  return [...seen];
}

function titleFrom(goal: string): string {
  const withoutUrls = goal.replace(URL_RE, "").replace(/\s+/g, " ").trim();
  const first = withoutUrls.split(/(?<=[.!?])\s/)[0] ?? withoutUrls;
  const t = first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function interpretGoal(goal: string): Intent {
  const urls = extractUrls(goal);
  const textOnly = goal.replace(URL_RE, " ");
  const gaps = GAP_RULES.filter((r) => r.pattern.test(textOnly)).map(({ category, description, followUp }) => ({
    category,
    description,
    followUp,
  }));
  let kind: IntentKind = "document";
  if (urls.length > 0 || RESEARCH_RE.test(textOnly)) kind = "research";
  else if (CHECKLIST_RE.test(textOnly)) kind = "checklist";
  return { kind, urls, gaps, title: titleFrom(goal) };
}
