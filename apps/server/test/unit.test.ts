import { describe, expect, it } from "vitest";
import { TASK_STATES } from "@keplar/contracts";
import { providerCostToMc, taskChargeMc } from "../src/billing/metering.js";
import { PLANS } from "../src/billing/plans.js";
import { backoffMs } from "../src/engine/queue.js";
import { finalStatus } from "../src/engine/progress.js";
import { routeModel } from "../src/models/router.js";
import { extractUrls, interpretGoal } from "../src/orchestrator/intent.js";
import { buildPlan, hashPlan } from "../src/orchestrator/planner.js";
import { canTransitionExecution, canTransitionTask } from "../src/orchestrator/state-machine.js";
import { sha256Hex, verify } from "../src/verification/verifier.js";
import { outcomeOf } from "../src/verification/receipt.js";

describe("goal interpretation", () => {
  it("extracts and normalizes URLs, ignoring trailing punctuation", () => {
    expect(extractUrls("Read https://example.com/a, and http://foo.org/b.")).toEqual(["https://example.com/a", "http://foo.org/b"]);
  });

  it("caps the number of URLs", () => {
    const goal = Array.from({ length: 9 }, (_, i) => `https://e${i}.com`).join(" ");
    expect(extractUrls(goal)).toHaveLength(5);
  });

  it("classifies research, checklist and document goals", () => {
    expect(interpretGoal("Summarize https://example.com for me").kind).toBe("research");
    expect(interpretGoal("Research the history of the printing press").kind).toBe("research");
    expect(interpretGoal("Make a checklist for moving apartments").kind).toBe("checklist");
    expect(interpretGoal("Write a product launch memo for our new app store listing").kind).toBe("document");
  });

  it("detects capability gaps honestly", () => {
    expect(interpretGoal("Book a flight to Paris next Friday").gaps.map((g) => g.category)).toContain("booking");
    expect(interpretGoal("Buy 3 ergonomic chairs for the office").gaps.map((g) => g.category)).toContain("payments");
    expect(interpretGoal("Build a website for my bakery").gaps.map((g) => g.category)).toContain("app_builder");
    expect(interpretGoal("Write a short memo about quarterly goals").gaps).toEqual([]);
  });

  it("does not mistake ordinary writing tasks for actions it cannot take", () => {
    for (const goal of [
      "Write a launch plan for our community workshop series",
      "Outline a book about urban gardening",
      "Draft an email to my team about the offsite",
      "Explain in order to decide which option to pick",
      "Summarize the text of the policy",
    ]) {
      expect(interpretGoal(goal).gaps, goal).toEqual([]);
    }
    expect(interpretGoal("Deploy the website to production").gaps.map((g) => g.category)).toContain("deployment");
    expect(interpretGoal("Send the report to all customers").gaps.map((g) => g.category)).toContain("messaging");
  });

  it("does not detect gaps from words that only appear inside URLs", () => {
    expect(interpretGoal("Summarize https://example.com/book-reviews").gaps).toEqual([]);
  });
});

describe("planner", () => {
  const opts = { modelAvailable: false };

  it("builds a fully specified task graph for research goals", () => {
    const goal = "Compare https://a.example.com and https://b.example.com";
    const plan = buildPlan(goal, interpretGoal(goal), opts);
    expect(plan.tasks.map((t) => t.capability)).toEqual(["web.fetch", "web.fetch", "doc.compose"]);
    const doc = plan.tasks[2]!;
    expect(doc.dependsOn).toEqual(["t1", "t2"]);
    for (const t of plan.tasks) {
      expect(t.key).toMatch(/^t\d+$/);
      expect(t.verification.length).toBeGreaterThan(0);
      expect(t.retryPolicy.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(t.timeoutMs).toBeGreaterThan(0);
      expect(t.budgetMc).toBeGreaterThan(0);
      expect(t.expectedOutputs.length).toBeGreaterThan(0);
    }
    expect(plan.estimatedMc).toBe(150 + 150 + 300);
    expect(doc.verification.map((v) => v.kind)).toContain("cites_sources");
  });

  it("blocks research it cannot source instead of inventing sources", () => {
    const goal = "Research the best CRM tools for small agencies";
    const plan = buildPlan(goal, interpretGoal(goal), opts);
    expect(plan.tasks[0]!.blockedReason).toMatch(/search provider/);
    expect(plan.tasks[1]!.blockedReason).toMatch(/cannot run/);
    expect(plan.estimatedMc).toBe(0);
  });

  it("adds blocked tasks for capability gaps and plans what it can do", () => {
    const goal = "Book a hotel in Lisbon for the conference";
    const plan = buildPlan(goal, interpretGoal(goal), opts);
    expect(plan.tasks[0]!.capability).toBe("checklist.compose");
    expect(plan.tasks.at(-1)!.blockedReason).toMatch(/Booking/);
  });

  it("requests model permission and extra budget only when a model will be used", () => {
    const goal = "Write a memo about our hiring plan for next quarter";
    const withModel = buildPlan(goal, interpretGoal(goal), { modelAvailable: true });
    const without = buildPlan(goal, interpretGoal(goal), { modelAvailable: false });
    expect(withModel.tasks[0]!.permissions).toContain("model.generate");
    expect(without.tasks[0]!.permissions).not.toContain("model.generate");
    expect(withModel.estimatedMc).toBeGreaterThan(without.estimatedMc);
    expect(withModel.hash).not.toBe(without.hash);
  });

  it("produces a stable hash that changes with the goal", () => {
    const g = "Write a memo about our hiring plan";
    const a = buildPlan(g, interpretGoal(g), opts);
    const b = buildPlan(g, interpretGoal(g), opts);
    expect(a.hash).toBe(b.hash);
    expect(hashPlan(`${g}!`, a.tasks)).not.toBe(a.hash);
  });

  it("keeps every plan inside the free plan's per-execution ceiling", () => {
    const goal = `Research ${Array.from({ length: 5 }, (_, i) => `https://s${i}.example.com`).join(" ")}`;
    expect(buildPlan(goal, interpretGoal(goal), { modelAvailable: true }).estimatedMc).toBeLessThanOrEqual(PLANS.free.maxCreditsPerExecutionMc);
  });
});

describe("state machine", () => {
  it("allows the happy path and retries", () => {
    expect(canTransitionTask("awaiting_approval", "queued")).toBe(true);
    expect(canTransitionTask("queued", "running")).toBe(true);
    expect(canTransitionTask("running", "verifying")).toBe(true);
    expect(canTransitionTask("verifying", "completed")).toBe(true);
    expect(canTransitionTask("running", "retrying")).toBe(true);
    expect(canTransitionTask("retrying", "running")).toBe(true);
  });

  it("rejects skipping verification and leaving terminal states", () => {
    expect(canTransitionTask("running", "completed")).toBe(false);
    expect(canTransitionTask("awaiting_approval", "running")).toBe(false);
    for (const s of TASK_STATES) {
      expect(canTransitionTask("completed", s)).toBe(false);
      expect(canTransitionTask("failed", s)).toBe(false);
    }
    expect(canTransitionExecution("completed", "running")).toBe(false);
    expect(canTransitionExecution("awaiting_approval", "running")).toBe(true);
  });

  it("derives the final execution status from task outcomes", () => {
    expect(finalStatus(["completed", "completed"], false)).toBe("completed");
    expect(finalStatus(["completed", "blocked"], false)).toBe("partially_completed");
    expect(finalStatus(["failed", "blocked"], false)).toBe("failed");
    expect(finalStatus(["blocked"], false)).toBe("blocked");
    expect(finalStatus(["completed", "cancelled"], true)).toBe("cancelled");
  });
});

describe("verifier", () => {
  const doc = "# Brief\n\n## Summary\n\nText citing https://a.example.com.\n\n## Sources\n\n1. https://a.example.com\n";
  const artifact = { name: "doc.md", content: doc, sha256: sha256Hex(doc), sourceUrl: null };

  it("passes when every criterion holds", () => {
    const r = verify({
      criteria: [
        { kind: "artifact_exists", artifactName: "doc.md" },
        { kind: "artifact_integrity", artifactName: "doc.md" },
        { kind: "has_sections", artifactName: "doc.md", sections: ["Summary", "Sources"] },
        { kind: "cites_sources", artifactName: "doc.md" },
        { kind: "no_placeholders", artifactName: "doc.md" },
        { kind: "min_length", artifactName: "doc.md", chars: 20 },
      ],
      artifacts: [artifact],
      outputs: {},
      upstreamSources: [{ url: "https://a.example.com" }],
    });
    expect(r.passed).toBe(true);
  });

  it("detects tampering, missing sections, missing citations, placeholders and missing artifacts", () => {
    const tampered = { ...artifact, content: `${doc}TODO: finish` };
    const r = verify({
      criteria: [
        { kind: "artifact_integrity", artifactName: "doc.md" },
        { kind: "has_sections", artifactName: "doc.md", sections: ["Findings"] },
        { kind: "cites_sources", artifactName: "doc.md" },
        { kind: "no_placeholders", artifactName: "doc.md" },
        { kind: "artifact_exists", artifactName: "other.md" },
      ],
      artifacts: [tampered],
      outputs: {},
      upstreamSources: [{ url: "https://b.example.com" }],
    });
    expect(r.passed).toBe(false);
    expect(r.checks.map((c) => c.passed)).toEqual([false, false, false, false, false]);
  });

  it("never passes an empty criteria list", () => {
    expect(verify({ criteria: [], artifacts: [], outputs: {}, upstreamSources: [] }).passed).toBe(false);
  });

  it("checks HTTP status and checklist item counts", () => {
    const list = "## Checklist\n- [ ] a\n- [x] b\n- [ ] c\n";
    const r = verify({
      criteria: [{ kind: "http_ok", url: "u" }, { kind: "min_items", artifactName: "c.md", items: 3 }],
      artifacts: [{ name: "c.md", content: list, sha256: sha256Hex(list), sourceUrl: null }],
      outputs: { status: 200 },
      upstreamSources: [],
    });
    expect(r.passed).toBe(true);
    expect(verify({ criteria: [{ kind: "http_ok", url: "u" }], artifacts: [], outputs: { status: 503 }, upstreamSources: [] }).passed).toBe(false);
  });

  it("only reports a task as independently verified when every check passed", () => {
    const passed = [{ criterion: { kind: "http_ok", url: "u" } as const, passed: true, detail: "" }];
    expect(outcomeOf({ status: "completed", verificationResults: passed })).toBe("independently_verified");
    expect(outcomeOf({ status: "completed", verificationResults: [] })).toBe("completed");
    expect(outcomeOf({ status: "queued", verificationResults: [] })).toBe("submitted");
  });
});

describe("metering, routing and backoff", () => {
  it("converts provider spend to credits and caps at the task budget", () => {
    expect(providerCostToMc(0)).toBe(0);
    expect(providerCostToMc(0.15)).toBe(1000);
    expect(taskChargeMc(300, 0.015, 1000)).toBe(400);
    expect(taskChargeMc(300, 10, 1000)).toBe(1000);
  });

  it("routes to the cheapest suitable model the plan allows and never escalates", () => {
    const free = routeModel({ preferredTier: "standard", allowedTiers: PLANS.free.modelTiers, availableProviders: ["anthropic"] });
    expect(free.map((m) => m.id)).toEqual(["claude-haiku-5-5"]);
    const pro = routeModel({ preferredTier: "standard", allowedTiers: PLANS.pro.modelTiers, availableProviders: ["anthropic"] });
    expect(pro.map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    const light = routeModel({ preferredTier: "light", allowedTiers: PLANS.plus.modelTiers, availableProviders: ["anthropic"] });
    expect(light.map((m) => m.id)).toEqual(["claude-haiku-5-5"]);
    expect(routeModel({ preferredTier: "light", allowedTiers: ["light"], availableProviders: [] })).toEqual([]);
  });

  it("backs off exponentially within bounds", () => {
    const max = () => 0.999999;
    expect(backoffMs(1, 1000, 30_000, max)).toBeLessThan(1000);
    expect(backoffMs(3, 1000, 30_000, max)).toBeLessThan(4000);
    expect(backoffMs(3, 1000, 30_000, max)).toBeGreaterThan(3000);
    expect(backoffMs(20, 1000, 30_000, max)).toBeLessThanOrEqual(30_000);
    expect(backoffMs(5, 1000, 30_000, () => 0)).toBe(500);
  });
});
