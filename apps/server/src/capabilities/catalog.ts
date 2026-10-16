import type { CapabilityId, Permission } from "@keplar/contracts";

/** Static capability metadata the planner uses. Implementations live next to this file. */
export interface CapabilitySpec {
  id: CapabilityId;
  label: string;
  agent: "research" | "strategy" | "execution";
  permissions: Permission[];
  /** Base metered cost in millicredits, charged when the task runs. */
  baseCostMc: number;
  timeoutMs: number;
  maxAttempts: number;
}

export const CAPABILITIES: Record<CapabilityId, CapabilitySpec> = {
  "web.fetch": {
    id: "web.fetch",
    label: "Read a web page",
    agent: "research",
    permissions: ["network.public_http", "workspace.write_artifact"],
    baseCostMc: 150,
    timeoutMs: 20_000,
    maxAttempts: 3,
  },
  "doc.compose": {
    id: "doc.compose",
    label: "Write a document",
    agent: "strategy",
    permissions: ["workspace.write_artifact"],
    baseCostMc: 300,
    timeoutMs: 120_000,
    maxAttempts: 2,
  },
  "checklist.compose": {
    id: "checklist.compose",
    label: "Build an action checklist",
    agent: "strategy",
    permissions: ["workspace.write_artifact"],
    baseCostMc: 200,
    timeoutMs: 60_000,
    maxAttempts: 2,
  },
};

/** Extra budget allowed when a model provider writes the content instead of the template composer. */
export const MODEL_GENERATION_BUDGET_MC = 700;
