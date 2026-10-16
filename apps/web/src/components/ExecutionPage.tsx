import type { AccountSummary, ExecutionView, TaskView, VerificationCriterion } from "@keplar/contracts";
import { PERMISSIONS, TERMINAL_EXECUTION_STATES, formatCredits } from "@keplar/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { ArtifactDialog } from "./ArtifactDialog";
import { ReceiptPanel } from "./ReceiptPanel";
import { ExecutionStatus, Mono, SectionLabel, TaskStatus, relativeTime } from "./primitives";

const CAPABILITY_LABEL: Record<string, string> = {
  "web.fetch": "Read a web page",
  "doc.compose": "Write a document",
  "checklist.compose": "Build a checklist",
};

export function describeCriterion(c: VerificationCriterion): string {
  switch (c.kind) {
    case "artifact_exists":
      return `${c.artifactName} is saved`;
    case "artifact_integrity":
      return `${c.artifactName} matches its recorded SHA-256 digest`;
    case "min_length":
      return `${c.artifactName} has at least ${c.chars} characters`;
    case "has_sections":
      return `${c.artifactName} has sections: ${c.sections.join(", ")}`;
    case "cites_sources":
      return `${c.artifactName} cites every source it was given`;
    case "no_placeholders":
      return `${c.artifactName} contains no placeholder text`;
    case "http_ok":
      return "The page responds with HTTP 2xx";
    case "min_items":
      return `${c.artifactName} lists at least ${c.items} actions`;
  }
}

function TaskRow({ task, all }: { task: TaskView; all: TaskView[] }) {
  const deps = task.dependsOn.map((k) => all.find((t) => t.key === k)).filter(Boolean) as TaskView[];
  const results = task.verificationResults;
  return (
    <li className={`task state-${task.status}`}>
      <div className="task-rail" aria-hidden="true">
        <span className="task-index">{String(task.ordinal).padStart(2, "0")}</span>
      </div>
      <div className="task-body">
        <div className="task-head">
          <h3 className="task-title">{task.title}</h3>
          <TaskStatus status={task.status} />
        </div>
        <p className="task-desc">{task.blockedReason ?? task.description}</p>
        <dl className="task-meta">
          {task.capability && (
            <div>
              <dt>Does</dt>
              <dd>{CAPABILITY_LABEL[task.capability] ?? task.capability}</dd>
            </div>
          )}
          {deps.length > 0 && (
            <div>
              <dt>After</dt>
              <dd>{deps.map((d) => String(d.ordinal).padStart(2, "0")).join(", ")}</dd>
            </div>
          )}
          {task.capability && (
            <div>
              <dt>Budget</dt>
              <dd>{formatCredits(task.budgetMc)} cr</dd>
            </div>
          )}
          {task.attempts > 1 && (
            <div>
              <dt>Attempts</dt>
              <dd>
                {task.attempts} of {task.retryPolicy.maxAttempts}
              </dd>
            </div>
          )}
        </dl>
        {task.lastError && task.status !== "completed" && <p className="task-error">{task.lastError}</p>}
        {task.verification.length > 0 && (
          <details className="checks">
            <summary>
              {results.length > 0
                ? `${results.filter((r) => r.passed).length} of ${results.length} checks passed`
                : `${task.verification.length} checks Keplar will run`}
            </summary>
            <ul>
              {(results.length > 0 ? results : task.verification.map((criterion) => ({ criterion, passed: null as boolean | null, detail: "" }))).map((r, i) => (
                <li key={i} className={r.passed === true ? "pass" : r.passed === false ? "fail" : "pending"}>
                  <span className="check-mark" aria-hidden="true">
                    {r.passed === true ? "✓" : r.passed === false ? "✕" : "·"}
                  </span>
                  <span className="visually-hidden">{r.passed === true ? "Passed: " : r.passed === false ? "Failed: " : "Planned: "}</span>
                  <span>
                    {describeCriterion(r.criterion)}
                    {r.detail && <span className="check-detail"> — {r.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

export function ExecutionPage({ id, account, onChanged }: { id: string; account: AccountSummary | null; onChanged: () => void }) {
  const [exec, setExec] = useState<ExecutionView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api.execution(id);
      setExec(v);
      setError(null);
      if (lastStatus.current && lastStatus.current !== v.status) onChanged();
      lastStatus.current = v.status;
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", "Could not load this execution."));
    }
  }, [id, onChanged]);

  useEffect(() => {
    setExec(null);
    lastStatus.current = null;
    void load();
  }, [load]);

  useEffect(() => {
    if (exec) titleRef.current?.focus();
    // Focus the page title once per navigation, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec?.id]);

  // Poll while work is in flight. Execution continues server-side whether or not this page is open.
  useEffect(() => {
    if (!exec || exec.status !== "running") return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [exec, load]);

  async function act(fn: () => Promise<ExecutionView>) {
    setBusy(true);
    setActionError(null);
    try {
      setExec(await fn());
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err : new ApiError(0, "error", "That didn't work. Try again."));
      void load();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="empty-state" aria-labelledby="exec-error">
        <h1 id="exec-error">{error.status === 404 ? "This execution doesn't exist" : "Couldn't load this execution"}</h1>
        <p>{error.status === 404 ? "It may belong to another workspace, or the link is wrong." : error.message}</p>
        <a className="button" href="/">
          Start a new goal
        </a>
      </section>
    );
  }
  if (!exec) {
    return (
      <div className="loading" role="status">
        <span className="visually-hidden">Loading execution</span>
        <div className="skeleton line wide" />
        <div className="skeleton line" />
        <div className="skeleton block" />
      </div>
    );
  }

  const permissions = [...new Set(exec.tasks.filter((t) => t.status === "awaiting_approval").flatMap((t) => t.permissions))];
  const terminal = TERMINAL_EXECUTION_STATES.includes(exec.status);
  const events = showAllEvents ? exec.events : exec.events.slice(-10);
  const completedTasks = exec.tasks.filter((t) => t.status === "completed").length;
  const insufficient = actionError?.code === "insufficient_credits";

  return (
    <article className="execution" aria-labelledby="exec-title">
      <header className="exec-header">
        <p className="eyebrow">Goal</p>
        <h1 id="exec-title" ref={titleRef} tabIndex={-1} className="exec-title">
          {exec.goal}
        </h1>
        <div className="exec-meta">
          <ExecutionStatus status={exec.status} />
          <span className="meta-sep" aria-hidden="true" />
          <span>
            {completedTasks} of {exec.tasks.length} {exec.tasks.length === 1 ? "step" : "steps"} verified
          </span>
          <span className="meta-sep" aria-hidden="true" />
          <span>Planned {relativeTime(exec.createdAt)}</span>
          <span className="meta-sep" aria-hidden="true" />
          <Mono title={exec.id}>{exec.id.slice(0, 8)}</Mono>
        </div>
        <p className="visually-hidden" aria-live="polite">
          Status: {exec.status.replace("_", " ")}
        </p>
      </header>

      {exec.intent.gaps.length > 0 && (
        <aside className="notice attention" aria-label="What Keplar can't do yet">
          <h2 className="notice-title">Some of this Keplar can't do yet</h2>
          <ul>
            {exec.intent.gaps.map((g) => (
              <li key={g.category}>
                <strong>{g.description}.</strong> {g.followUp}
              </li>
            ))}
          </ul>
        </aside>
      )}

      {exec.status === "awaiting_approval" && (
        <section className="approval" aria-labelledby="approval-title">
          <SectionLabel index="01" id="approval-title">
            Your approval
          </SectionLabel>
          <div className="approval-grid">
            <div>
              <p className="approval-lede">Nothing has run yet. If you approve, Keplar will:</p>
              <ul className="permission-list">
                {permissions.map((p) => (
                  <li key={p}>{PERMISSIONS[p]}</li>
                ))}
              </ul>
            </div>
            <dl className="cost">
              <div>
                <dt>Reserved now</dt>
                <dd>
                  <span className="cost-figure">{formatCredits(exec.estimatedMc)}</span> credits
                </dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>{account ? `${formatCredits(account.credits.availableMc)} credits` : "—"}</dd>
              </div>
              <div>
                <dt className="visually-hidden">Billing</dt>
                <dd className="cost-note">You are charged for what actually runs. The rest is returned when the work finishes.</dd>
              </div>
            </dl>
          </div>
          {actionError && (
            <div className={`notice ${insufficient ? "attention" : "fail"}`} role="alert">
              <p>{actionError.message}</p>
              {insufficient && <p className="notice-sub">Paid plans include more credits. Billing is not live yet, so upgrades are not available in this build.</p>}
            </div>
          )}
          <div className="actions">
            <button className="button signal" type="button" disabled={busy} onClick={() => act(() => api.approve(exec.id, exec.planHash))}>
              {busy ? "Starting…" : "Approve and run"}
            </button>
            <button className="button quiet" type="button" disabled={busy} onClick={() => act(() => api.cancel(exec.id))}>
              Discard plan
            </button>
          </div>
        </section>
      )}

      <section aria-labelledby="plan-title">
        <div className="section-head">
          <SectionLabel index={exec.status === "awaiting_approval" ? "02" : "01"} id="plan-title">
            Plan
          </SectionLabel>
          {exec.status === "running" && (
            <button className="button quiet small" type="button" disabled={busy} onClick={() => act(() => api.cancel(exec.id))}>
              Stop
            </button>
          )}
        </div>
        <ol className="task-track">
          {exec.tasks.map((t) => (
            <TaskRow key={t.id} task={t} all={exec.tasks} />
          ))}
        </ol>
        <p className="fine">
          Planned by <Mono>{exec.planner}</Mono> · plan <Mono title={exec.planHash}>{exec.planHash.slice(0, 12)}</Mono>
        </p>
      </section>

      {exec.artifacts.length > 0 && (
        <section aria-labelledby="results-title">
          <SectionLabel index={exec.status === "awaiting_approval" ? "03" : "02"} id="results-title">
            Results
          </SectionLabel>
          <ul className="artifact-list">
            {exec.artifacts.map((a) => (
              <li key={a.id}>
                <button type="button" className="artifact" onClick={() => setOpenArtifact(a.id)}>
                  <span className="artifact-name">{a.name}</span>
                  <span className="artifact-meta">
                    {a.sourceUrl ? new URL(a.sourceUrl).hostname : a.kind} · {(a.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                    <Mono title={a.sha256}>{a.sha256.slice(0, 10)}</Mono>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {terminal && exec.receiptId && <ReceiptPanel executionId={exec.id} index={exec.artifacts.length > 0 ? "03" : "02"} />}

      <section aria-labelledby="activity-title" className="activity">
        <SectionLabel index="—" id="activity-title">
          Activity
        </SectionLabel>
        <ol className="event-log">
          {events.map((ev) => (
            <li key={ev.id}>
              <time dateTime={ev.createdAt} className="mono">
                {new Date(ev.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
              </time>
              <span className="event-subject">{ev.taskKey ? `Step ${ev.taskKey.slice(1).padStart(2, "0")}` : "Execution"}</span>
              <span className="event-change">
                {ev.fromStatus ? `${ev.fromStatus.replace(/_/g, " ")} → ` : ""}
                {ev.toStatus.replace(/_/g, " ")}
              </span>
              {ev.reason && <span className="event-reason">{ev.reason}</span>}
            </li>
          ))}
        </ol>
        {exec.events.length > 10 && (
          <button type="button" className="link-button" onClick={() => setShowAllEvents((v) => !v)}>
            {showAllEvents ? "Show recent activity only" : `Show all ${exec.events.length} events`}
          </button>
        )}
      </section>

      {openArtifact && <ArtifactDialog artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />}
    </article>
  );
}
