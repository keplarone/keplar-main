import type { OutcomeReceipt, ReceiptTaskEntry } from "@keplar/contracts";
import { formatCredits } from "@keplar/contracts";
import { useEffect, useState } from "react";
import { api, sha256Hex } from "../api";
import { ExecutionStatus, Mono, SectionLabel } from "./primitives";

const OUTCOME_LABEL: Record<string, string> = {
  independently_verified: "Verified",
  completed: "Completed, not verified",
  failed: "Failed",
  blocked: "Blocked",
  cancelled: "Cancelled",
  planned: "Not started",
  awaiting_approval: "Not approved",
  submitted: "Queued",
  accepted: "Started",
  prepared: "Prepared",
};

function Rows({ title, entries }: { title: string; entries: ReceiptTaskEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <>
      <tr className="receipt-group">
        <th colSpan={3} scope="colgroup">
          {title}
        </th>
      </tr>
      {entries.map((e) => (
        <tr key={e.key}>
          <th scope="row">{e.title}</th>
          <td>{OUTCOME_LABEL[e.outcome] ?? e.outcome}</td>
          <td className="num">
            {e.verification.length > 0 ? `${e.verification.filter((v) => v.passed).length}/${e.verification.length}` : "—"}
          </td>
        </tr>
      ))}
    </>
  );
}

export function ReceiptPanel({ executionId, index }: { executionId: string; index: string }) {
  const [data, setData] = useState<{ receipt: OutcomeReceipt; raw: string; digest: string; verified: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .receipt(executionId)
      .then(async (r) => {
        const verified = (await sha256Hex(r.raw)) === r.digest;
        if (live) setData({ ...r, verified });
      })
      .catch(() => live && setError("The receipt could not be loaded."));
    return () => {
      live = false;
    };
  }, [executionId]);

  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.raw], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `keplar-receipt-${executionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="receipt-title" className="receipt-section">
      <SectionLabel index={index} id="receipt-title">
        Outcome receipt
      </SectionLabel>
      {error && <p className="form-error">{error}</p>}
      {data && (
        <div className="receipt">
          <div className="receipt-top">
            <ExecutionStatus status={data.receipt.finalStatus} />
            <button type="button" className="button quiet small" onClick={download}>
              Download JSON
            </button>
          </div>
          <table className="receipt-table">
            <caption className="visually-hidden">Outcome of each step</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Outcome</th>
                <th scope="col" className="num">
                  Checks
                </th>
              </tr>
            </thead>
            <tbody>
              <Rows title="Done" entries={data.receipt.tasks.completed} />
              <Rows title="Failed" entries={data.receipt.tasks.failed} />
              <Rows title="Blocked" entries={data.receipt.tasks.blocked} />
              <Rows title="Not finished" entries={data.receipt.tasks.pending} />
            </tbody>
          </table>
          {data.receipt.humanFollowUp.length > 0 && (
            <div className="follow-up">
              <h3>Left for you</h3>
              <ul>
                {data.receipt.humanFollowUp.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className="receipt-facts">
            <div>
              <dt>Charged</dt>
              <dd>{formatCredits(data.receipt.usage.chargedMc)} credits</dd>
            </div>
            <div>
              <dt>Returned</dt>
              <dd>{formatCredits(data.receipt.usage.releasedMc)} credits</dd>
            </div>
            <div>
              <dt>Model spend</dt>
              <dd>{data.receipt.usage.modelCalls.length === 0 ? "No model calls" : `$${data.receipt.usage.providerCostUsd.toFixed(4)}`}</dd>
            </div>
            <div>
              <dt>Took</dt>
              <dd>{(data.receipt.usage.wallClockMs / 1000).toFixed(1)} s</dd>
            </div>
            <div>
              <dt>External confirmations</dt>
              <dd>{data.receipt.externalConfirmations.length === 0 ? "None (nothing was sent outside Keplar)" : data.receipt.externalConfirmations.length}</dd>
            </div>
          </dl>
          <p className={`receipt-digest ${data.verified ? "tone-ok" : "tone-fail"}`}>
            {data.verified ? "Receipt digest checked in your browser" : "Receipt digest does not match"} · <Mono title={data.digest}>sha256 {data.digest.slice(0, 24)}…</Mono>
          </p>
        </div>
      )}
    </section>
  );
}
