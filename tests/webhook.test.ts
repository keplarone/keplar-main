import { Webhook } from "standardwebhooks";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whop", () => ({ whop: () => ({}) }));

import { POST } from "@/app/api/webhooks/whop/route";
import { closeDb, ENV, fakeOpenRouter, payment, resetDb } from "./helpers";

function signedRequest(event: unknown, secret = ENV.WHOP_WEBHOOK_SECRET) {
  const body = JSON.stringify(event);
  const id = "msg_" + Math.random().toString(36).slice(2);
  const timestamp = new Date();
  // Whop uses the whole `ws_...` string, as UTF-8 bytes, as the HMAC key.
  const signature = new Webhook(Buffer.from(secret).toString("base64")).sign(id, timestamp, body);
  return new Request("https://app.example.com/api/webhooks/whop", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    },
    body,
  });
}

describe("Whop webhook route", () => {
  let or: ReturnType<typeof fakeOpenRouter>;
  beforeEach(async () => {
    await resetDb();
    or = fakeOpenRouter();
  });

  it("grants credit for a signed payment.succeeded", async () => {
    const res = await POST(signedRequest({ type: "payment.succeeded", data: payment({ plan_id: "plan_plus" }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "granted" });
    expect(or.only().limit).toBe(12);
  });

  it("rejects a bad signature", async () => {
    const forged = signedRequest(
      { type: "payment.succeeded", data: payment() },
      "ws_" + Buffer.from("some-other-secret-some-other-sec").toString("base64"),
    );
    expect((await POST(forged)).status).toBe(401);
    expect(or.keys.size).toBe(0);
  });

  it("returns 500 so Whop retries when OpenRouter is down", async () => {
    or.fetchMock.mockImplementationOnce(async () => new Response("boom", { status: 503 }));
    const res = await POST(signedRequest({ type: "payment.succeeded", data: payment() }));
    expect(res.status).toBe(500);
    // The retry succeeds and does not double-grant.
    expect((await POST(signedRequest({ type: "payment.succeeded", data: payment() }))).status).toBe(200);
    expect(or.only().limit).toBe(4.8);
  });

  it("acknowledges events it does not handle", async () => {
    const res = await POST(signedRequest({ type: "membership.activated", data: {} }));
    expect(await res.json()).toMatchObject({ result: "ignored" });
  });
});

afterAll(closeDb);
