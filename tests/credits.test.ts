import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import { getBalance, getUserApiKey, grantForPayment, revokeForRefund } from "@/lib/credits";
import { db } from "@/lib/db";
import { grantForPlan } from "@/lib/plans";
import { closeDb, fakeOpenRouter, payment, resetDb } from "./helpers";

const refund = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "rfnd_1",
    payment_id: "pay_1",
    status: "succeeded",
    amount: { amount: "8.00", currency: "usd", decimals: 2, display_decimals: 2 },
    original_amount: { amount: "8.00", currency: "usd", decimals: 2, display_decimals: 2 },
    ...overrides,
  }) as never;

describe("plan mapping", () => {
  beforeEach(resetDb);

  it("maps each tier and pack to its credit", () => {
    expect(grantForPlan("plan_lite_m")).toEqual({ kind: "plan", tier: "lite", amountUsd: 4.8 });
    expect(grantForPlan("plan_lite_y")).toEqual({ kind: "plan", tier: "lite", amountUsd: 4.8 });
    expect(grantForPlan("plan_plus")).toEqual({ kind: "plan", tier: "plus", amountUsd: 12 });
    expect(grantForPlan("plan_pro")).toEqual({ kind: "plan", tier: "pro", amountUsd: 27 });
    expect(grantForPlan("plan_pack10")).toEqual({ kind: "pack", amountUsd: 10 });
    expect(grantForPlan("plan_other")).toBeUndefined();
  });
});

describe("crypto", () => {
  beforeEach(resetDb);

  it("round-trips and detects tampering", () => {
    const sealed = encrypt("sk-or-v1-secret");
    expect(decrypt(sealed)).toBe("sk-or-v1-secret");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

describe("granting credits from Whop payments", () => {
  let or: ReturnType<typeof fakeOpenRouter>;
  beforeEach(async () => {
    await resetDb();
    or = fakeOpenRouter();
  });

  it("creates a capped key on the first Lite payment", async () => {
    expect(await grantForPayment(payment())).toBe("granted");
    expect(or.only()).toMatchObject({ name: "keplar:user_1", limit: 4.8 });
    expect(await getUserApiKey("user_1")).toBe(or.only().key);
  });

  it("grants $12 for Plus and $27 for Pro", async () => {
    await grantForPayment(payment({ id: "pay_p", plan_id: "plan_plus", user: { id: "u_plus" } }));
    await grantForPayment(payment({ id: "pay_r", plan_id: "plan_pro", user: { id: "u_pro" } }));
    const limits = Object.fromEntries([...or.keys.values()].map((k) => [k.name, k.limit]));
    expect(limits).toEqual({ "keplar:u_plus": 12, "keplar:u_pro": 27 });
  });

  it("ignores duplicate deliveries of the same payment", async () => {
    await grantForPayment(payment());
    await grantForPayment(payment());
    await Promise.all([grantForPayment(payment()), grantForPayment(payment())]);
    expect(or.keys.size).toBe(1);
    expect(or.only().limit).toBe(4.8);
  });

  it("adds credit on each renewal and pack purchase", async () => {
    await grantForPayment(payment());
    await grantForPayment(payment({ id: "pay_2" }));
    await grantForPayment(payment({ id: "pay_3", plan_id: "plan_pack5", total: { amount: "5.50" } }));
    expect(or.only().limit).toBeCloseTo(14.6);
    const kinds = await db()`select kind from credit_ledger order by id`;
    expect(kinds.map((r) => r.kind)).toEqual(["plan", "plan", "pack"]);
  });

  it("sums cart line items with quantities", async () => {
    await grantForPayment(
      payment({ plan_id: null, line_items: [{ plan_id: "plan_pack5", quantity: 3 }, { plan_id: "plan_x", quantity: 1 }] }),
    );
    expect(or.only().limit).toBe(15);
  });

  it("ignores $0 payments, unknown plans and payments without a user", async () => {
    expect(await grantForPayment(payment({ total: { amount: "0.00" } }))).toBe("ignored");
    expect(await grantForPayment(payment({ plan_id: "plan_other" }))).toBe("ignored");
    expect(await grantForPayment(payment({ user: null }))).toBe("ignored");
    expect(or.keys.size).toBe(0);
  });

  it("reports the balance from OpenRouter", async () => {
    await grantForPayment(payment());
    or.only().usage = 1.3;
    expect(await getBalance("user_1")).toEqual({ limitUsd: 4.8, usageUsd: 1.3, remainingUsd: 3.5 });
    expect(await getBalance("nobody")).toEqual({ limitUsd: 0, usageUsd: 0, remainingUsd: 0 });
  });
});

describe("refunds", () => {
  let or: ReturnType<typeof fakeOpenRouter>;
  beforeEach(async () => {
    await resetDb();
    or = fakeOpenRouter();
    await grantForPayment(payment({ id: "pay_1", plan_id: "plan_pro", total: { amount: "40.00" } }));
    await grantForPayment(payment({ id: "pay_2", plan_id: "plan_pack10", total: { amount: "11.00" } }));
  });

  it("removes all credit for a full refund, once", async () => {
    const full = refund({ amount: { amount: "40.00" } });
    expect(await revokeForRefund(full)).toBe("revoked");
    await revokeForRefund(full);
    expect(or.only().limit).toBe(10);
  });

  it("removes a proportional share for partial refunds and never more than granted", async () => {
    await revokeForRefund(refund({ id: "r1", amount: { amount: "10.00" } })); // 25% of $27
    expect(or.only().limit).toBeCloseTo(37 - 6.75);
    await revokeForRefund(refund({ id: "r2", amount: { amount: "40.00" } }));
    expect(or.only().limit).toBeCloseTo(10);
  });

  it("ignores pending refunds and unknown payments", async () => {
    expect(await revokeForRefund(refund({ status: "pending" }))).toBe("ignored");
    expect(await revokeForRefund(refund({ payment_id: "pay_unknown" }))).toBe("ignored");
    expect(or.only().limit).toBe(37);
  });
});

afterAll(closeDb);
