import type { ExecutionState, TaskState } from "@keplar/contracts";
import type { ReactNode } from "react";

/** The Keplar mark. Inverted by the theme in dark mode. */
export function Mark({ size = 24 }: { size?: number }) {
  return <img className="mark" src="/keplar-mark.png" width={size} height={size} alt="" aria-hidden="true" />;
}

type Tone = "neutral" | "active" | "attention" | "ok" | "fail" | "muted";

const TASK_META: Record<TaskState, { label: string; tone: Tone; shape: "square" | "triangle" | "circle" | "cross" | "dash" }> = {
  created: { label: "Drafted", tone: "muted", shape: "square" },
  planned: { label: "Waiting on earlier steps", tone: "muted", shape: "square" },
  awaiting_approval: { label: "Needs your approval", tone: "attention", shape: "square" },
  queued: { label: "Queued", tone: "neutral", shape: "square" },
  running: { label: "Running", tone: "active", shape: "square" },
  verifying: { label: "Verifying", tone: "active", shape: "circle" },
  retrying: { label: "Retrying", tone: "attention", shape: "triangle" },
  completed: { label: "Verified", tone: "ok", shape: "circle" },
  blocked: { label: "Blocked", tone: "attention", shape: "triangle" },
  failed: { label: "Failed", tone: "fail", shape: "cross" },
  cancelled: { label: "Cancelled", tone: "muted", shape: "dash" },
};

const EXEC_META: Record<ExecutionState, { label: string; tone: Tone; shape: "square" | "triangle" | "circle" | "cross" | "dash" }> = {
  awaiting_approval: { label: "Needs your approval", tone: "attention", shape: "square" },
  running: { label: "Running", tone: "active", shape: "square" },
  completed: { label: "Completed and verified", tone: "ok", shape: "circle" },
  partially_completed: { label: "Partly completed", tone: "attention", shape: "triangle" },
  blocked: { label: "Blocked", tone: "attention", shape: "triangle" },
  failed: { label: "Failed", tone: "fail", shape: "cross" },
  cancelled: { label: "Cancelled", tone: "muted", shape: "dash" },
};

/** Geometric status glyph drawn from the brand mark's shapes. Always paired with a text label. */
export function Glyph({ shape, tone, pulse = false }: { shape: string; tone: Tone; pulse?: boolean }) {
  return (
    <svg className={`glyph tone-${tone}${pulse ? " pulse" : ""}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {shape === "square" && <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill={tone === "active" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />}
      {shape === "circle" && <circle cx="6" cy="6" r="4.75" fill="currentColor" />}
      {shape === "triangle" && <path d="M6 1.5 10.75 10H1.25Z" fill="currentColor" />}
      {shape === "cross" && <path d="M2.5 2.5l7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />}
      {shape === "dash" && <path d="M2 6h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />}
    </svg>
  );
}

export function TaskStatus({ status }: { status: TaskState }) {
  const m = TASK_META[status];
  return (
    <span className={`status tone-${m.tone}`}>
      <Glyph shape={m.shape} tone={m.tone} pulse={status === "running" || status === "verifying"} />
      {m.label}
    </span>
  );
}

export function ExecutionStatus({ status, compact = false }: { status: ExecutionState; compact?: boolean }) {
  const m = EXEC_META[status];
  return (
    <span className={`status tone-${m.tone}${compact ? " compact" : ""}`}>
      <Glyph shape={m.shape} tone={m.tone} pulse={status === "running"} />
      {compact ? <span className="visually-hidden">{m.label}</span> : m.label}
    </span>
  );
}

export function SectionLabel({ index, children, id }: { index: string; children: ReactNode; id?: string }) {
  return (
    <h2 className="section-label" id={id}>
      <span className="section-index">{index}</span>
      {children}
    </h2>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code className="mono" title={title}>
      {children}
    </code>
  );
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
