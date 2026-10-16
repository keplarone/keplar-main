/**
 * Shared contracts between the Keplar API, worker and web client.
 * Every payload that crosses a process boundary is defined here once.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Task and execution state vocabularies
// ---------------------------------------------------------------------------

export const TASK_STATES = [
  "created",
  "planned",
  "awaiting_approval",
  "queued",
  "running",
  "verifying",
  "retrying",
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["completed", "blocked", "failed", "cancelled"];

export const EXECUTION_STATES = [
  "awaiting_approval",
  "running",
  "completed",
  "partially_completed",
  "blocked",
  "failed",
  "cancelled",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const TERMINAL_EXECUTION_STATES: readonly ExecutionState[] = [
  "completed",
  "partially_completed",
  "blocked",
  "failed",
  "cancelled",
];

/** Outcome vocabulary used in receipts. Never collapses "the model said done" into "verified". */
export const OUTCOME_STATES = [
  "planned",
  "prepared",
  "awaiting_approval",
  "submitted",
  "accepted",
  "completed",
  "independently_verified",
  "blocked",
  "failed",
  "cancelled",
] as const;
export type OutcomeState = (typeof OUTCOME_STATES)[number];

// ---------------------------------------------------------------------------
// Permissions and capabilities
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  "network.public_http": "Read public web pages you listed",
  "model.generate": "Send your goal and collected sources to an AI model provider",
  "workspace.write_artifact": "Save results as files in this workspace",
} as const;
export type Permission = keyof typeof PERMISSIONS;

export const CAPABILITY_IDS = ["web.fetch", "doc.compose", "checklist.compose"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export const VerificationCriterion = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("artifact_exists"), artifactName: z.string() }),
  z.object({ kind: z.literal("artifact_integrity"), artifactName: z.string() }),
  z.object({ kind: z.literal("min_length"), artifactName: z.string(), chars: z.number().int().positive() }),
  z.object({ kind: z.literal("has_sections"), artifactName: z.string(), sections: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("cites_sources"), artifactName: z.string() }),
  z.object({ kind: z.literal("no_placeholders"), artifactName: z.string() }),
  z.object({ kind: z.literal("http_ok"), url: z.string() }),
  z.object({ kind: z.literal("min_items"), artifactName: z.string(), items: z.number().int().positive() }),
]);
export type VerificationCriterion = z.infer<typeof VerificationCriterion>;

export const VerificationCheck = z.object({
  criterion: VerificationCriterion,
  passed: z.boolean(),
  detail: z.string(),
});
export type VerificationCheck = z.infer<typeof VerificationCheck>;

export const RetryPolicy = z.object({
  maxAttempts: z.number().int().min(1).max(5),
  baseDelayMs: z.number().int().min(100),
  maxDelayMs: z.number().int().min(100),
});
export type RetryPolicy = z.infer<typeof RetryPolicy>;

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export const Credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(12, "Use at least 12 characters").max(256),
});
export type Credentials = z.infer<typeof Credentials>;

export const SignupRequest = Credentials.extend({
  workspaceName: z.string().trim().min(1).max(80).optional(),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const CreateExecutionRequest = z.object({
  goal: z.string().trim().min(8, "Describe the goal in a little more detail").max(4000),
});
export type CreateExecutionRequest = z.infer<typeof CreateExecutionRequest>;

export const ApproveExecutionRequest = z.object({
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ApproveExecutionRequest = z.infer<typeof ApproveExecutionRequest>;

export interface SessionInfo {
  user: { id: string; email: string };
  workspace: { id: string; name: string; planId: string; role: string };
  csrfToken: string;
}

export interface AccountSummary {
  plan: { id: string; name: string; monthlyPriceUsd: number | null };
  credits: { availableMc: number; reservedMc: number; grantedMc: number; periodStart: string };
  requests: { used: number; limit: number };
  modelProvider: { configured: boolean; provider: string | null };
}

/** Usage for the current credit period. Money is in USD micros (1e-6 USD); credits in millicredits. */
export interface UsageSummary {
  period: { start: string; end: string };
  credits: { grantedMc: number; availableMc: number; reservedMc: number; chargedMc: number };
  requests: { used: number; limit: number };
  executions: { total: number; byStatus: Partial<Record<ExecutionState, number>> };
  capabilities: { capability: string; tasks: number; chargedMc: number }[];
  models: { provider: string; model: string; calls: number; failures: number; inputTokens: number; outputTokens: number; costUsdMicros: number }[];
  providerCostUsdMicros: number;
  ledger: {
    id: number;
    kind: "grant" | "reserve" | "release" | "charge";
    amountMc: number;
    availableAfterMc: number;
    executionId: string | null;
    goal: string | null;
    memo: string | null;
    createdAt: string;
  }[];
}

export interface TaskView {
  id: string;
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
  status: TaskState;
  attempts: number;
  blockedReason: string | null;
  lastError: string | null;
  verificationResults: VerificationCheck[];
  evidence: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ArtifactView {
  id: string;
  taskId: string;
  kind: string;
  name: string;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  sourceUrl: string | null;
  createdAt: string;
}

export interface ExecutionEventView {
  id: number;
  taskKey: string | null;
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}

export interface CapabilityGap {
  category: string;
  description: string;
  followUp: string;
}

export interface ExecutionView {
  id: string;
  goal: string;
  status: ExecutionState;
  intent: { kind: string; urls: string[]; gaps: CapabilityGap[] };
  planner: string;
  planHash: string;
  estimatedMc: number;
  reservedMc: number;
  chargedMc: number;
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  tasks: TaskView[];
  artifacts: ArtifactView[];
  events: ExecutionEventView[];
  receiptId: string | null;
}

export interface ExecutionListItem {
  id: string;
  goal: string;
  status: ExecutionState;
  createdAt: string;
}

export interface ReceiptTaskEntry {
  key: string;
  title: string;
  capability: string | null;
  outcome: OutcomeState;
  attempts: number;
  verification: VerificationCheck[];
  evidence: string[];
  error: string | null;
  blockedReason: string | null;
}

export interface OutcomeReceipt {
  receiptVersion: 1;
  executionId: string;
  workspaceId: string;
  goal: string;
  finalStatus: ExecutionState;
  planner: string;
  planHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
  completedAt: string;
  tasks: {
    completed: ReceiptTaskEntry[];
    failed: ReceiptTaskEntry[];
    pending: ReceiptTaskEntry[];
    blocked: ReceiptTaskEntry[];
  };
  artifacts: { id: string; name: string; sha256: string; sizeBytes: number; sourceUrl: string | null }[];
  externalConfirmations: { system: string; reference: string }[];
  usage: {
    estimatedMc: number;
    chargedMc: number;
    releasedMc: number;
    modelCalls: { provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }[];
    providerCostUsd: number;
    wallClockMs: number;
  };
  humanFollowUp: string[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Millicredits → display credits. 1 execution credit = 1000 mc. */
export function formatCredits(mc: number): string {
  const v = mc / 1000;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
