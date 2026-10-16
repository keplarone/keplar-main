import type { SessionInfo } from "@keplar/contracts";
import { type FormEvent, useId, useState } from "react";
import { ApiError, api } from "../api";
import { Mark } from "./primitives";

export function AuthScreen({ onSignedIn }: { onSignedIn: (s: SessionInfo) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errId = useId();
  const pwHintId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(mode === "signin" ? await api.login(email, password) : await api.signup(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-panel">
        <div className="auth-brand">
          <Mark size={36} />
          <span className="wordmark">Keplar One</span>
        </div>
        <h1 className="auth-title">{mode === "signin" ? "Sign in" : "Create your account"}</h1>
        <p className="auth-lede">Tell Keplar what you want done. It plans the work, runs what you approve, checks the result and gives you a receipt.</p>
        <form onSubmit={submit} noValidate aria-describedby={error ? errId : undefined}>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === "signup" ? pwHintId : undefined}
            />
            {mode === "signup" && (
              <span className="field-hint" id={pwHintId}>
                At least 12 characters. A short phrase works well.
              </span>
            )}
          </label>
          {error && (
            <p className="form-error" id={errId} role="alert">
              {error}
            </p>
          )}
          <button className="button primary block" type="submit" disabled={busy}>
            {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "signin" ? "New to Keplar?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
          >
            {mode === "signin" ? "Create an account" : "Sign in instead"}
          </button>
        </p>
      </div>
    </main>
  );
}
