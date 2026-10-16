import type { UsageSummary } from "@keplar/contracts";
import { EXECUTION_STATES, formatCredits } from "@keplar/contracts";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { navigate } from "../router";
import { ExecutionStatus, Mono, SectionLabel } from "./primitives";

const CAPABILITY_LABELS: Record<string, string> = {
  "web.fetch": "Read a web page",
  "doc.compose": "Write a document",
  "checklist.compose": "Build an action checklist",
};

const LEDGER_LABELS: Record<UsageSummary["ledger"][number]["kind"], string> = {
  grant: "Monthly grant",
  reserve: "Reserved",
  release: "Returned",
  charge: "Charged",
};

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros > 0 && micros < 10_000 ? 4 : 2)}`;
const int = new Intl.NumberFormat();

function CreditBreakdown({ credits }: { credits: UsageSummary["credits"] }) {
  const total = Math.max(credits.grantedMc, credits.availableMc + credits.reservedMc + credits.chargedMc, 1);
  const pct = (mc: number) => `${(mc / total) * 100}%`;
  return (
    <div className="usage-breakdown">
      <div className="usage-bar" aria-hidden="true">
        <span className="seg used" style={{ inlineSize: pct(credits.chargedMc) }} />
        <span className="seg reserved" style={{ inlineSize: pct(credits.reservedMc) }} />
      </div>
      <dl className="usage-stats">
        <div>
          <dt>
            <span className="key used" aria-hidden="true" />
            Used
          </dt>
          <dd>{formatCredits(credits.chargedMc)}</dd>
        </div>
        <div>
          <dt>
            <span className="key reserved" aria-hidden="true" />
            Reserved for running work
          </dt>
          <dd>{formatCredits(credits.reservedMc)}</dd>
        </div>
        <div>
          <dt>
            <span className="key available" aria-hidden="true" />
            Available
          </dt>
          <dd>{formatCredits(credits.availableMc)}</dd>
        </div>
        <div>
          <dt>Granted this period</dt>
          <dd>{formatCredits(credits.grantedMc)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function UsagePage() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api
      .usage()
      .then(setUsage)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (usage) titleRef.current?.focus();
  }, [usage]);

  if (error) {
    return (
      <section className="notice fail" role="alert">
        <p className="notice-title">Usage could not be loaded</p>
        <p className="notice-sub">{error}</p>
      </section>
    );
  }
  if (!usage) {
    return (
      <div className="loading" role="status">
        <span className="visually-hidden">Loading usage</span>
        <div className="skeleton line wide" />
        <div className="skeleton block" />
      </div>
    );
  }

  const start = dateFmt.format(new Date(`${usage.period.start}T00:00:00Z`));
  const end = dateFmt.format(new Date(`${usage.period.end}T00:00:00Z`));
  const statuses = EXECUTION_STATES.filter((s) => (usage.executions.byStatus[s] ?? 0) > 0);

  return (
    <article className="usage" aria-labelledby="usage-title">
      <header>
        <p className="eyebrow">Usage</p>
        <h1 id="usage-title" ref={titleRef} tabIndex={-1} className="exec-title">
          {formatCredits(usage.credits.chargedMc)} credits used this period
        </h1>
        <div className="exec-meta">
          <span>
            {start} to {end}
          </span>
          <span className="meta-sep" aria-hidden="true" />
          <span>
            {usage.requests.used} of {usage.requests.limit} requests
          </span>
          <span className="meta-sep" aria-hidden="true" />
          <span>
            {usage.executions.total} {usage.executions.total === 1 ? "goal" : "goals"}
          </span>
        </div>
      </header>

      <section aria-labelledby="credits-title">
        <SectionLabel index="01" id="credits-title">
          Credits
        </SectionLabel>
        <CreditBreakdown credits={usage.credits} />
        {statuses.length > 0 && (
          <ul className="usage-statuses" aria-label="Goals by outcome">
            {statuses.map((s) => (
              <li key={s}>
                <ExecutionStatus status={s} />
                <span className="mono">{usage.executions.byStatus[s]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="capabilities-title">
        <SectionLabel index="02" id="capabilities-title">
          Where credits went
        </SectionLabel>
        {usage.capabilities.length === 0 ? (
          <p className="fine">No verified steps this period yet. Credits are charged only for steps that pass verification.</p>
        ) : (
          <table className="receipt-table">
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col" className="num">
                  Verified
                </th>
                <th scope="col" className="num">
                  Credits
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.capabilities.map((c) => (
                <tr key={c.capability}>
                  <th scope="row">{CAPABILITY_LABELS[c.capability] ?? c.capability}</th>
                  <td className="num">{c.tasks}</td>
                  <td className="num">{formatCredits(c.chargedMc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="models-title">
        <SectionLabel index="03" id="models-title">
          AI model cost
        </SectionLabel>
        {usage.models.length === 0 ? (
          <p className="fine">No AI model was called this period. Documents were drafted by Keplar's template composer, at no provider cost.</p>
        ) : (
          <>
            <table className="receipt-table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col" className="num">
                    Calls
                  </th>
                  <th scope="col" className="num">
                    Tokens in / out
                  </th>
                  <th scope="col" className="num">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.models.map((m) => (
                  <tr key={`${m.provider}/${m.model}`}>
                    <th scope="row">
                      <Mono>{m.model}</Mono>
                      {m.failures > 0 && <span className="fine"> · {m.failures} failed</span>}
                    </th>
                    <td className="num">{m.calls}</td>
                    <td className="num">
                      {int.format(m.inputTokens)} / {int.format(m.outputTokens)}
                    </td>
                    <td className="num">{usd(m.costUsdMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine">
              Total provider cost {usd(usage.providerCostUsdMicros)}, from the token counts each provider reported.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="ledger-title">
        <SectionLabel index="04" id="ledger-title">
          Credit ledger
        </SectionLabel>
        <div className="table-scroll">
          <table className="receipt-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Entry</th>
                <th scope="col" className="num">
                  Credits
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {/* A settlement that returns nothing still writes a zero-amount release; it adds nothing for the reader. */}
              {usage.ledger.filter((l) => !(l.kind === "release" && l.amountMc === 0)).map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{timeFmt.format(new Date(l.createdAt))}</td>
                  <th scope="row">
                    {LEDGER_LABELS[l.kind]}
                    {l.goal && l.executionId ? (
                      <>
                        {" · "}
                        <a
                          href={`/e/${l.executionId}`}
                          onClick={(ev) => {
                            ev.preventDefault();
                            navigate(`/e/${l.executionId}`);
                          }}
                        >
                          {l.goal}
                        </a>
                      </>
                    ) : (
                      l.memo && <span className="fine"> · {l.memo}</span>
                    )}
                  </th>
                  <td className="num">
                    {/* Signs show the change to the available balance; a charge settles credits already reserved. */}
                    {l.kind === "grant" || l.kind === "release" ? "+" : l.kind === "reserve" ? "−" : ""}
                    {formatCredits(l.amountMc)}
                  </td>
                  <td className="num">{formatCredits(l.availableAfterMc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
