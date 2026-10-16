import type { AccountSummary, ExecutionListItem, SessionInfo } from "@keplar/contracts";
import { formatCredits } from "@keplar/contracts";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, setCsrfToken } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { Composer } from "./components/Composer";
import { ExecutionPage } from "./components/ExecutionPage";
import { UsagePage } from "./components/UsagePage";
import { ExecutionStatus, Mark, relativeTime } from "./components/primitives";
import { navigate, useRoute } from "./router";
import { ThemeToggle } from "./theme";

function CreditMeter({ account }: { account: AccountSummary }) {
  const { availableMc, grantedMc, reservedMc } = account.credits;
  const pct = grantedMc > 0 ? Math.max(0, Math.min(100, (availableMc / grantedMc) * 100)) : 0;
  return (
    <a
      className="credit-meter"
      href="/usage"
      title={`${formatCredits(reservedMc)} credits reserved for running work`}
      onClick={(e) => {
        e.preventDefault();
        navigate("/usage");
      }}
    >
      <span className="credit-text">
        <strong>{formatCredits(availableMc)}</strong> of {formatCredits(grantedMc)} credits · {account.plan.name}
      </span>
      <span className="credit-bar" role="meter" aria-label="Credits available" aria-valuemin={0} aria-valuemax={grantedMc / 1000} aria-valuenow={availableMc / 1000}>
        <span style={{ inlineSize: `${pct}%` }} />
      </span>
    </a>
  );
}

function History({ items, activeId, onPick }: { items: ExecutionListItem[]; activeId: string | null; onPick: () => void }) {
  if (items.length === 0) {
    return <p className="history-empty">Your goals will appear here, with their status and receipts.</p>;
  }
  return (
    <ul className="history">
      {items.map((e) => (
        <li key={e.id}>
          <a
            href={`/e/${e.id}`}
            className={`history-item${e.id === activeId ? " active" : ""}`}
            aria-current={e.id === activeId ? "page" : undefined}
            onClick={(ev) => {
              ev.preventDefault();
              navigate(`/e/${e.id}`);
              onPick();
            }}
          >
            <ExecutionStatus status={e.status} compact />
            <span className="history-goal">{e.goal}</span>
            <span className="history-time">{relativeTime(e.createdAt)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [history, setHistory] = useState<ExecutionListItem[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const route = useRoute();

  useEffect(() => {
    api
      .session()
      .then((s) => {
        setCsrfToken(s.csrfToken);
        setSession(s);
      })
      .catch((err) => setSession(err instanceof ApiError && err.status === 401 ? null : null));
  }, []);

  const refresh = useCallback(() => {
    void api.account().then(setAccount).catch(() => undefined);
    void api.executions().then(setHistory).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (session) refresh();
  }, [session, refresh]);

  if (session === undefined) {
    return (
      <div className="boot" role="status">
        <Mark size={28} />
        <span className="visually-hidden">Loading Keplar</span>
      </div>
    );
  }
  if (session === null) {
    return (
      <AuthScreen
        onSignedIn={(s) => {
          setCsrfToken(s.csrfToken);
          setSession(s);
        }}
      />
    );
  }

  const activeId = route.name === "execution" ? route.id : null;

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="icon-button nav-toggle" aria-expanded={navOpen} aria-controls="sidebar" onClick={() => setNavOpen((v) => !v)}>
            <span className="visually-hidden">Show history</span>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 5h12M3 9h12M3 13h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <a
            className="brand"
            href="/"
            aria-label="Keplar One, start a new goal"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <Mark size={22} />
            <span className="wordmark">Keplar One</span>
          </a>
        </div>
        <div className="topbar-right">
          {account && <CreditMeter account={account} />}
          <ThemeToggle />
          <button
            type="button"
            className="button quiet small"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setCsrfToken("");
              setSession(null);
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <nav id="sidebar" className={`sidebar${navOpen ? " open" : ""}`} aria-label="Goal history">
        <button
          type="button"
          className="button block new-goal"
          onClick={() => {
            navigate("/");
            setNavOpen(false);
          }}
        >
          New goal
        </button>
        <a
          href="/usage"
          className={`sidebar-link${route.name === "usage" ? " active" : ""}`}
          aria-current={route.name === "usage" ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate("/usage");
            setNavOpen(false);
          }}
        >
          Usage and credits
        </a>
        <h2 className="sidebar-title">Recent</h2>
        <History items={history} activeId={activeId} onPick={() => setNavOpen(false)} />
        <p className="sidebar-foot">
          Signed in as <span className="mono">{session.user.email}</span>
          {account && !account.modelProvider.configured && (
            <>
              <br />
              No AI model is connected, so documents are drafted by Keplar's template composer.
            </>
          )}
        </p>
      </nav>
      <main id="main" className="main">
        {route.name === "home" && <Composer onPlanned={refresh} />}
        {route.name === "usage" && <UsagePage />}
        {route.name === "execution" && <ExecutionPage id={route.id} account={account} onChanged={refresh} />}
        {route.name === "not_found" && (
          <section className="empty-state">
            <h1>Nothing here</h1>
            <a className="button" href="/">
              Start a new goal
            </a>
          </section>
        )}
      </main>
    </div>
  );
}
