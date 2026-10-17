import { env } from "./env";

// OpenRouter key management ("provisioning") API. Every user gets their own
// key whose spending `limit` equals the credits they have paid for.

const BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterKey {
  hash: string;
  name: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  usage: number;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env("OPENROUTER_PROVISIONING_KEY")}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function createKey(name: string, limitUsd: number): Promise<{ key: string; data: OpenRouterKey }> {
  return call("/keys", { method: "POST", body: JSON.stringify({ name, limit: limitUsd }) });
}

export async function setKeyLimit(hash: string, limitUsd: number): Promise<OpenRouterKey> {
  const res = await call<{ data: OpenRouterKey }>(`/keys/${encodeURIComponent(hash)}`, {
    method: "PATCH",
    body: JSON.stringify({ limit: limitUsd }),
  });
  return res.data;
}

export async function getKey(hash: string): Promise<OpenRouterKey> {
  const res = await call<{ data: OpenRouterKey }>(`/keys/${encodeURIComponent(hash)}`, { method: "GET" });
  return res.data;
}
