import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { navigate } from "../router";

const EXAMPLES = [
  "Summarize https://en.wikipedia.org/wiki/Johannes_Kepler and pull out the three laws",
  "Write a launch plan for a weekend pottery workshop series",
  "Make a checklist for moving into a new apartment next month",
];

export function Composer({ onPlanned }: { onPlanned: () => void }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const errId = useId();

  useEffect(() => ref.current?.focus(), []);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const exec = await api.plan(goal.trim());
      onPlanned();
      navigate(`/e/${exec.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Keplar couldn't plan that. Try again.");
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  }

  return (
    <section className="composer" aria-labelledby="composer-title">
      <h1 id="composer-title" className="composer-title" tabIndex={-1}>
        What do you want accomplished?
      </h1>
      <form onSubmit={submit}>
        <label htmlFor="goal" className="visually-hidden">
          Your goal
        </label>
        <textarea
          id="goal"
          ref={ref}
          className="composer-input"
          rows={4}
          maxLength={4000}
          placeholder="Describe the outcome, and paste any links Keplar should read."
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={`${hintId}${error ? ` ${errId}` : ""}`}
          aria-invalid={error ? true : undefined}
        />
        <div className="composer-bar">
          <p id={hintId} className="composer-hint">
            Keplar shows you the plan and what it will cost before anything runs.
          </p>
          <button className="button primary" type="submit" disabled={busy || goal.trim().length < 8}>
            {busy ? "Planning…" : "Plan it"}
            <kbd className="kbd" aria-hidden="true">
              ⌘↵
            </kbd>
          </button>
        </div>
        {error && (
          <p className="form-error" id={errId} role="alert">
            {error}
          </p>
        )}
      </form>
      <div className="examples">
        <h2 className="examples-title">Try</h2>
        <ul>
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                className="example"
                onClick={() => {
                  setGoal(ex);
                  ref.current?.focus();
                }}
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
