import { createHash } from "node:crypto";
import type { CapabilityId, Permission, RetryPolicy, VerificationCriterion } from "@keplar/contracts";
import { CAPABILITIES, MODEL_GENERATION_BUDGET_MC } from "../capabilities/catalog.js";
import type { Intent } from "./intent.js";

export const PLANNER_ID = "keplar-planner/rules-v1";

export interface TaskSpec {
  key: string;
  ordinal: number;
  title: string;
  description: string;
  capability: CapabilityId | null;
  inputs: Record<string, unknown>;
  expectedOutputs: string[];
  dependsOn: string[];
  permissions: Permission[];
  budgetMc: number;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  verification: VerificationCriterion[];
  /** Set when the planner already knows this task cannot run. */
  blockedReason: string | null;
}

export interface Plan {
  planner: string;
  tasks: TaskSpec[];
  estimatedMc: number;
  hash: string;
}

export interface PlannerOptions {
  /** True when a model provider is configured and the workspace plan allows model generation. */
  modelAvailable: boolean;
}

function retry(maxAttempts: number): RetryPolicy {
  return { maxAttempts, baseDelayMs: 1_000, maxDelayMs: 30_000 };
}

function capabilityTask(
  key: string,
  ordinal: number,
  capability: CapabilityId,
  fields: Pick<TaskSpec, "title" | "description" | "inputs" | "expectedOutputs" | "dependsOn" | "verification">,
  opts: PlannerOptions,
): TaskSpec {
  const spec = CAPABILITIES[capability];
  const usesModel = opts.modelAvailable && capability !== "web.fetch";
  return {
    key,
    ordinal,
    capability,
    ...fields,
    inputs: { ...fields.inputs, ...(capability !== "web.fetch" ? { composer: usesModel ? "model" : "template" } : {}) },
    permissions: usesModel ? [...spec.permissions, "model.generate"] : [...spec.permissions],
    budgetMc: spec.baseCostMc + (usesModel ? MODEL_GENERATION_BUDGET_MC : 0),
    timeoutMs: spec.timeoutMs,
    retryPolicy: retry(spec.maxAttempts),
    blockedReason: null,
  };
}

function blockedTask(key: string, ordinal: number, title: string, reason: string, dependsOn: string[] = []): TaskSpec {
  return {
    key,
    ordinal,
    title,
    description: reason,
    capability: null,
    inputs: {},
    expectedOutputs: [],
    dependsOn,
    permissions: [],
    budgetMc: 0,
    timeoutMs: 0,
    retryPolicy: retry(1),
    verification: [],
    blockedReason: reason,
  };
}

const docChecks = (name: string, sections: string[], minChars: number, citeSources: boolean): VerificationCriterion[] => [
  { kind: "artifact_exists", artifactName: name },
  { kind: "artifact_integrity", artifactName: name },
  { kind: "min_length", artifactName: name, chars: minChars },
  { kind: "has_sections", artifactName: name, sections },
  ...(citeSources ? [{ kind: "cites_sources", artifactName: name } as const] : []),
  { kind: "no_placeholders", artifactName: name },
];

export const RESEARCH_SECTIONS = ["Summary", "Findings", "Open questions", "Sources"];
export const BRIEF_SECTIONS = ["Objective", "Approach", "Deliverables", "Risks", "Next steps"];
export const CHECKLIST_SECTIONS = ["Checklist", "Done when"];

export function buildPlan(goal: string, intent: Intent, opts: PlannerOptions): Plan {
  const tasks: TaskSpec[] = [];
  let n = 0;
  const nextKey = () => `t${++n}`;

  if (intent.kind === "research") {
    const sourceKeys: string[] = [];
    if (intent.urls.length === 0) {
      const key = nextKey();
      sourceKeys.push(key);
      tasks.push(
        blockedTask(key, n, "Find sources on the web",
          "No web search provider is connected, so Keplar cannot choose sources by itself. Add the links you want read to your goal."),
      );
    }
    for (const url of intent.urls) {
      const key = nextKey();
      sourceKeys.push(key);
      tasks.push(
        capabilityTask(key, n, "web.fetch", {
          title: `Read ${new URL(url).hostname}`,
          description: `Fetch ${url}, keep a snapshot and extract its readable text as a cited source.`,
          inputs: { url },
          expectedOutputs: [`source-${key}.txt`],
          dependsOn: [],
          verification: [
            { kind: "http_ok", url },
            { kind: "artifact_exists", artifactName: `source-${key}.txt` },
            { kind: "artifact_integrity", artifactName: `source-${key}.txt` },
            { kind: "min_length", artifactName: `source-${key}.txt`, chars: 40 },
          ],
        }, opts),
      );
    }
    const key = nextKey();
    tasks.push(
      capabilityTask(key, n, "doc.compose", {
        title: "Write the research brief",
        description: "Synthesize the collected sources into a brief that cites every source it uses.",
        inputs: { goal, mode: "research", sourceKeys },
        expectedOutputs: ["research-brief.md"],
        dependsOn: sourceKeys,
        verification: docChecks("research-brief.md", RESEARCH_SECTIONS, 400, true),
      }, opts),
    );
  } else if (intent.kind === "checklist" || intent.gaps.some((g) => ["payments", "booking", "messaging"].includes(g.category))) {
    const key = nextKey();
    tasks.push(
      capabilityTask(key, n, "checklist.compose", {
        title: "Build the action checklist",
        description: "Break the goal into concrete, ordered actions with a clear definition of done.",
        inputs: { goal, gapCategories: intent.gaps.map((g) => g.category) },
        expectedOutputs: ["checklist.md"],
        dependsOn: [],
        verification: [...docChecks("checklist.md", CHECKLIST_SECTIONS, 200, false), { kind: "min_items", artifactName: "checklist.md", items: 5 }],
      }, opts),
    );
  } else {
    const key = nextKey();
    tasks.push(
      capabilityTask(key, n, "doc.compose", {
        title: intent.gaps.some((g) => g.category === "app_builder") ? "Write the project brief" : "Write the document",
        description: "Draft a structured brief covering objective, approach, deliverables, risks and next steps.",
        inputs: { goal, mode: "brief", sourceKeys: [] },
        expectedOutputs: ["brief.md"],
        dependsOn: [],
        verification: docChecks("brief.md", BRIEF_SECTIONS, 500, false),
      }, opts),
    );
  }

  const dependsOnAll = tasks.map((t) => t.key);
  for (const gap of intent.gaps) {
    const key = nextKey();
    tasks.push(blockedTask(key, n, `Not yet supported: ${gap.description.toLowerCase()}`, `${gap.description} is not available yet. ${gap.followUp}`, dependsOnAll));
  }

  // A task that depends on something that cannot run cannot run either; say so up front.
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of tasks) {
      const dead = !t.blockedReason && t.dependsOn.map((k) => tasks.find((x) => x.key === k)!).find((d) => d.blockedReason);
      if (dead) {
        t.blockedReason = `Depends on "${dead.title}", which cannot run.`;
        changed = true;
      }
    }
  }

  const estimatedMc = tasks.filter((t) => !t.blockedReason).reduce((sum, t) => sum + t.budgetMc, 0);
  return { planner: PLANNER_ID, tasks, estimatedMc, hash: hashPlan(goal, tasks) };
}

/** Canonical hash of everything the user is approving. Approval must present the same hash. */
export function hashPlan(goal: string, tasks: TaskSpec[]): string {
  const canonical = JSON.stringify({
    goal,
    tasks: tasks.map((t) => [t.key, t.capability, sortKeys(t.inputs), t.dependsOn, [...t.permissions].sort(), t.budgetMc, t.blockedReason]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function sortKeys(obj: Record<string, unknown>): [string, unknown][] {
  return Object.keys(obj).sort().map((k) => [k, obj[k]]);
}
