import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";

/**
 * SSRF-resistant HTTP GET.
 * - Only http/https on ports 80/443.
 * - Every resolved address is checked at connect time (inside the socket's lookup), so DNS
 *   rebinding between "check" and "connect" cannot reach a private address.
 * - Redirects are followed manually and re-validated; response size and time are capped.
 */

export class FetchPolicyError extends Error {
  readonly permanent = true;
}

export class FetchTransientError extends Error {
  readonly permanent = false;
}

export type AddressPolicy = (address: string) => boolean;

/** Only globally routable unicast addresses are allowed. */
export const publicAddressesOnly: AddressPolicy = (address) => {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === "unicast";
};

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  addressPolicy: AddressPolicy;
  allowedPorts: number[];
  signal?: AbortSignal;
  userAgent: string;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

export const DEFAULT_FETCH_OPTIONS: Omit<SafeFetchOptions, "signal"> = {
  timeoutMs: 15_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  addressPolicy: publicAddressesOnly,
  allowedPorts: [80, 443],
  userAgent: "KeplarOne/0.1 (+https://keplar.one; research fetcher)",
};

export function validateUrl(raw: string, allowedPorts: number[] = [80, 443]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchPolicyError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchPolicyError(`Blocked scheme ${url.protocol}`);
  if (url.username || url.password) throw new FetchPolicyError("URLs with embedded credentials are not allowed");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!allowedPorts.includes(port)) throw new FetchPolicyError(`Blocked port ${port}`);
  return url;
}

function guardedLookup(policy: AddressPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as unknown as { address: string; family: number }[];
      const blocked = list.find((a) => !policy(a.address));
      if (blocked || list.length === 0) {
        return callback(new FetchPolicyError(`Blocked address for ${hostname}: ${blocked?.address ?? "none"}`), "", 0);
      }
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
      const first = list[0]!;
      callback(null, first.address, first.family);
    });
  };
}

function requestOnce(url: URL, opts: SafeFetchOptions): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    // Literal IP hosts never go through DNS, so check them directly.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (ipaddr.isValid(host) && !opts.addressPolicy(host)) {
      reject(new FetchPolicyError(`Blocked address ${host}`));
      return;
    }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(opts.addressPolicy),
        headers: { "user-agent": opts.userAgent, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1" },
        timeout: opts.timeoutMs,
        signal: opts.signal,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated }));
        res.on("error", (e) => reject(new FetchTransientError(e.message)));
      },
    );
    req.on("timeout", () => req.destroy(new FetchTransientError(`Timed out after ${opts.timeoutMs} ms`)));
    req.on("error", (e) => reject(e instanceof FetchPolicyError || e instanceof FetchTransientError ? e : classifyNetError(e)));
    req.end();
  });
}

function classifyNetError(e: Error & { code?: string }): Error {
  if (e.code === "ENOTFOUND") return new FetchPolicyError(`Host not found: ${e.message}`);
  if (e.name === "AbortError") return new FetchTransientError("Cancelled");
  return new FetchTransientError(e.message);
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  let url = validateUrl(rawUrl, opts.allowedPorts);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await requestOnce(url, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = validateUrl(new URL(res.headers.location, url).toString(), opts.allowedPorts);
      continue;
    }
    const contentType = String(res.headers["content-type"] ?? "application/octet-stream");
    return { finalUrl: url.toString(), status: res.status, contentType, body: res.body.toString("utf8"), truncated: res.truncated };
  }
  throw new FetchPolicyError(`Too many redirects (>${opts.maxRedirects})`);
}

/** Minimal, dependency-free HTML → readable text. Output is treated as untrusted data downstream. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.replace(/\s+/g, " ").trim()) : null;
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function safeCodePoint(cp: number): string {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
}
