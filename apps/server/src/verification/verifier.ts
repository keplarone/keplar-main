import { createHash } from "node:crypto";
import type { VerificationCheck, VerificationCriterion } from "@keplar/contracts";

/**
 * Independent verification. Runs after a capability finishes, reads what was actually persisted
 * (not what the capability or a model claimed), and evaluates each acceptance criterion.
 */

export interface PersistedArtifact {
  name: string;
  content: string;
  sha256: string;
  sourceUrl: string | null;
}

export interface VerificationInput {
  criteria: VerificationCriterion[];
  artifacts: PersistedArtifact[];
  outputs: Record<string, unknown>;
  /** Source artifacts from upstream tasks, used by cites_sources. */
  upstreamSources: { url: string }[];
}

const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|lorem ipsum|PLACEHOLDER)\b|\[insert[^\]]*\]/i;
const CHECKBOX_RE = /^\s*[-*] \[[ xX]\] \S/;

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function check(criterion: VerificationCriterion, input: VerificationInput): VerificationCheck {
  const artifact = "artifactName" in criterion ? input.artifacts.find((a) => a.name === criterion.artifactName) : undefined;
  const missing = (): VerificationCheck => ({ criterion, passed: false, detail: `Artifact ${"artifactName" in criterion ? criterion.artifactName : ""} was not saved` });
  switch (criterion.kind) {
    case "artifact_exists":
      return artifact ? { criterion, passed: true, detail: `${artifact.name} saved (${Buffer.byteLength(artifact.content)} bytes)` } : missing();
    case "artifact_integrity": {
      if (!artifact) return missing();
      const actual = sha256Hex(artifact.content);
      return actual === artifact.sha256
        ? { criterion, passed: true, detail: `sha256 ${actual} matches the stored digest` }
        : { criterion, passed: false, detail: `Stored digest ${artifact.sha256} does not match content digest ${actual}` };
    }
    case "min_length": {
      if (!artifact) return missing();
      const n = artifact.content.trim().length;
      return { criterion, passed: n >= criterion.chars, detail: `${n} characters (minimum ${criterion.chars})` };
    }
    case "has_sections": {
      if (!artifact) return missing();
      const headings = new Set(
        artifact.content.split("\n").flatMap((l) => {
          const m = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(l);
          return m ? [m[1]!.trim().toLowerCase()] : [];
        }),
      );
      const absent = criterion.sections.filter((s) => !headings.has(s.toLowerCase()));
      return absent.length === 0
        ? { criterion, passed: true, detail: `All ${criterion.sections.length} required sections present` }
        : { criterion, passed: false, detail: `Missing sections: ${absent.join(", ")}` };
    }
    case "cites_sources": {
      if (!artifact) return missing();
      if (input.upstreamSources.length === 0) return { criterion, passed: false, detail: "No sources were available to cite" };
      const uncited = input.upstreamSources.filter((s) => !artifact.content.includes(s.url));
      return uncited.length === 0
        ? { criterion, passed: true, detail: `All ${input.upstreamSources.length} sources cited by URL` }
        : { criterion, passed: false, detail: `Sources not cited: ${uncited.map((s) => s.url).join(", ")}` };
    }
    case "no_placeholders": {
      if (!artifact) return missing();
      const m = PLACEHOLDER_RE.exec(artifact.content);
      return m ? { criterion, passed: false, detail: `Placeholder text found: "${m[0]}"` } : { criterion, passed: true, detail: "No placeholder text found" };
    }
    case "min_items": {
      if (!artifact) return missing();
      const n = artifact.content.split("\n").filter((l) => CHECKBOX_RE.test(l)).length;
      return { criterion, passed: n >= criterion.items, detail: `${n} checklist items (minimum ${criterion.items})` };
    }
    case "http_ok": {
      const status = Number(input.outputs.status);
      return status >= 200 && status < 300
        ? { criterion, passed: true, detail: `HTTP ${status}` }
        : { criterion, passed: false, detail: `HTTP ${Number.isFinite(status) ? status : "unknown"}` };
    }
  }
}

export function verify(input: VerificationInput): { passed: boolean; checks: VerificationCheck[] } {
  const checks = input.criteria.map((c) => check(c, input));
  return { passed: checks.length > 0 && checks.every((c) => c.passed), checks };
}
