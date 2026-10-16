import type { AccountSummary, ApiErrorBody, ExecutionListItem, ExecutionView, OutcomeReceipt, SessionInfo } from "@keplar/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken = "";
export function setCsrfToken(token: string) {
  csrfToken = token;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-keplar-client": "web" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "Keplar can't be reached. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  session: () => request<SessionInfo>("GET", "/api/v1/auth/session"),
  signup: (email: string, password: string) => request<SessionInfo>("POST", "/api/v1/auth/signup", { email, password }),
  login: (email: string, password: string) => request<SessionInfo>("POST", "/api/v1/auth/login", { email, password }),
  logout: () => request<void>("POST", "/api/v1/auth/logout"),
  account: () => request<AccountSummary>("GET", "/api/v1/account"),
  executions: () => request<ExecutionListItem[]>("GET", "/api/v1/executions"),
  execution: (id: string) => request<ExecutionView>("GET", `/api/v1/executions/${encodeURIComponent(id)}`),
  plan: (goal: string) => request<ExecutionView>("POST", "/api/v1/executions", { goal }),
  approve: (id: string, planHash: string) => request<ExecutionView>("POST", `/api/v1/executions/${encodeURIComponent(id)}/approve`, { planHash }),
  cancel: (id: string) => request<ExecutionView>("POST", `/api/v1/executions/${encodeURIComponent(id)}/cancel`),
  artifact: (id: string) =>
    request<{ id: string; name: string; mediaType: string; content: string; sha256: string; sizeBytes: number; sourceUrl: string | null }>(
      "GET",
      `/api/v1/artifacts/${encodeURIComponent(id)}`,
    ),
  /** Returns the exact stored bytes so the digest can be checked locally. */
  receipt: async (id: string): Promise<{ receipt: OutcomeReceipt; raw: string; digest: string }> => {
    const res = await fetch(`/api/v1/executions/${encodeURIComponent(id)}/receipt`, { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, "receipt_unavailable", "The receipt is not available yet.");
    const raw = await res.text();
    return { receipt: JSON.parse(raw) as OutcomeReceipt, raw, digest: res.headers.get("x-receipt-sha256") ?? "" };
  },
};

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
