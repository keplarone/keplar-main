import { FetchPolicyError, htmlToText, safeFetch } from "./safe-fetch.js";
import type { CapabilityHandler } from "./types.js";
import { PermanentTaskError } from "./types.js";

const MAX_TEXT_CHARS = 60_000;

export const webFetch: CapabilityHandler = async (ctx) => {
  const url = String(ctx.inputs.url ?? "");
  let res;
  try {
    res = await safeFetch(url, { ...ctx.fetchOptions, signal: ctx.signal });
  } catch (err) {
    if (err instanceof FetchPolicyError) throw new PermanentTaskError(`Fetch blocked by network policy: ${err.message}`);
    throw err;
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    throw new PermanentTaskError(`The page returned HTTP ${res.status}`);
  }
  if (res.status >= 400) throw new Error(`The page returned HTTP ${res.status}`);
  const isHtml = /html/i.test(res.contentType);
  const isText = isHtml || /^(text\/|application\/(json|xml))/i.test(res.contentType);
  if (!isText) throw new PermanentTaskError(`Unsupported content type ${res.contentType}`);
  const extracted = isHtml ? htmlToText(res.body) : { title: null, text: res.body };
  const text = extracted.text.slice(0, MAX_TEXT_CHARS);
  const header = [`Title: ${extracted.title ?? "(none)"}`, `URL: ${res.finalUrl}`, `HTTP status: ${res.status}`, `Content-Type: ${res.contentType}`, ""].join("\n");
  return {
    outputs: { url, finalUrl: res.finalUrl, status: res.status, title: extracted.title, truncated: res.truncated || extracted.text.length > MAX_TEXT_CHARS },
    artifacts: [{ kind: "web_snapshot", name: `source-${ctx.taskKey}.txt`, mediaType: "text/plain", content: header + text, sourceUrl: res.finalUrl }],
    evidence: [`HTTP ${res.status} from ${res.finalUrl}`],
    providerCostUsd: 0,
  };
};
