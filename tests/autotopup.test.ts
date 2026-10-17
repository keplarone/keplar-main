import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const whopMock = {
  payments: { create: vi.fn() },
  checkoutConfigurations: { create: vi.fn() },
};
vi.mock("@/lib/whop", () => ({ whop: () => whopMock }));

import {
  getSettings,
  handleSetupIntentSucceeded,
  handleTopUpFailed,
  maybeTopUp,
  runAutoTopUps,
  updateSettings,
  validateSettings,
} from "@/lib/autotopup";
import { grantForPayment } from "@/lib/credits";
import { db } from "@/lib/db";
import { closeDb, fakeOpenRouter, payment, resetDb } from "./helpers";

const setupIntent = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "seti_1",
    user: { id: "user_1" },
    member_id: "mber_1",
    payment_method_id: "payt_1",
    metadata: { purpose: "auto_topup_setup", whop_user_id: "user_1" },
    ...overrides,
  }) as never;

describe("auto top-up", () => {
  let or: ReturnType<typeof fakeOpenRouter>;
  let paymentCounter = 0;

  beforeEach(async () => {
    await resetDb();
    or = fakeOpenRouter();
    whopMock.payments.create.mockReset().mockImplementation(async () => ({ id: `pay_auto_${++paymentCounter}` }));
    whopMock.checkoutConfigurations.create.mockReset().mockResolvedValue({ purchase_url: "https://whop.com/checkout/setup" });
    await grantForPayment(payment()); // Lite: $4.80
  });

  async function enable() {
    const settings = validateSettings({ enabled: true, thresholdUsd: 1, packPlanId: "plan_pack5" });
    expect(await updateSettings("user_1", settings)).toEqual({ setupUrl: "https://whop.com/checkout/setup" });
    expect((await getSettings("user_1")).enabled).toBe(false);
    expect(await handleSetupIntentSucceeded(setupIntent())).toBe("saved");
  }

  it("validates settings", () => {
    expect(() => validateSettings({ enabled: true, thresholdUsd: 1, packPlanId: "plan_lite_m" })).toThrow("Unknown credit pack");
    expect(() => validateSettings({ enabled: true, thresholdUsd: 0, packPlanId: "plan_pack5" })).toThrow();
    expect(() => validateSettings({ enabled: "yes", thresholdUsd: 1, packPlanId: "plan_pack5" })).toThrow();
  });

  it("asks for a card first, then enables once the setup intent succeeds", async () => {
    await enable();
    expect(whopMock.checkoutConfigurations.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "setup", metadata: { purpose: "auto_topup_setup", whop_user_id: "user_1" } }),
    );
    expect(await getSettings("user_1")).toMatchObject({ enabled: true, hasPaymentMethod: true, packPlanId: "plan_pack5" });
  });

  it("ignores setup intents for another user or purpose", async () => {
    expect(await handleSetupIntentSucceeded(setupIntent({ user: { id: "user_2" } }))).toBe("ignored");
    expect(await handleSetupIntentSucceeded(setupIntent({ metadata: {} }))).toBe("ignored");
  });

  it("does nothing above the threshold or when disabled", async () => {
    expect(await maybeTopUp("user_1")).toBe("not_enabled");
    await enable();
    or.only().usage = 3; // $1.80 left
    expect(await maybeTopUp("user_1")).toBe("not_needed");
    expect(whopMock.payments.create).not.toHaveBeenCalled();
  });

  it("charges the saved card once when below the threshold, then grants on payment.succeeded", async () => {
    await enable();
    or.only().usage = 4.5; // $0.30 left

    expect(await maybeTopUp("user_1")).toBe("charged");
    expect(await maybeTopUp("user_1")).toBe("pending");
    expect(whopMock.payments.create).toHaveBeenCalledTimes(1);
    expect(whopMock.payments.create.mock.calls[0][0]).toEqual({
      account_id: "biz_test",
      plan_id: "plan_pack5",
      member_id: "mber_1",
      payment_method_id: "payt_1",
      off_session: true,
      metadata: { purpose: "auto_topup", whop_user_id: "user_1" },
    });

    const paymentId = whopMock.payments.create.mock.results[0].value;
    const { id } = await paymentId;
    await grantForPayment(
      payment({ id, plan_id: "plan_pack5", total: { amount: "5.50" }, metadata: { purpose: "auto_topup" } }),
    );
    expect(or.only().limit).toBeCloseTo(9.8);
    const [c] = await db()`select autotopup_pending_payment_id from customers`;
    expect(c.autotopup_pending_payment_id).toBeNull();
    const [row] = await db()`select kind from credit_ledger where source_id = ${id}`;
    expect(row.kind).toBe("auto_topup");
  });

  it("only charges once when checked concurrently", async () => {
    await enable();
    or.only().usage = 4.8;
    const results = await Promise.all([maybeTopUp("user_1"), maybeTopUp("user_1"), maybeTopUp("user_1")]);
    expect(results.filter((r) => r === "charged")).toHaveLength(1);
    expect(whopMock.payments.create).toHaveBeenCalledTimes(1);
  });

  it("stops at the daily cap", async () => {
    process.env.AUTOTOPUP_MAX_PER_DAY = "2";
    await enable();
    for (const id of ["pay_a1", "pay_a2"]) {
      await grantForPayment(payment({ id, plan_id: "plan_pack5", metadata: { purpose: "auto_topup" } }));
    }
    or.only().usage = or.only().limit;
    expect(await maybeTopUp("user_1")).toBe("daily_cap");
    delete process.env.AUTOTOPUP_MAX_PER_DAY;
  });

  it("disables itself and records why when the charge fails", async () => {
    await enable();
    or.only().usage = 4.8;
    await maybeTopUp("user_1");
    expect(
      await handleTopUpFailed(
        payment({ id: "pay_auto_x", status: "open", failure_message: "Card declined", metadata: { purpose: "auto_topup" } }),
      ),
    ).toBe("disabled");
    expect(await getSettings("user_1")).toMatchObject({ enabled: false, lastError: "Card declined" });
    expect(await maybeTopUp("user_1")).toBe("not_enabled");
  });

  it("backs off after an API error instead of retrying every request", async () => {
    await enable();
    or.only().usage = 4.8;
    whopMock.payments.create.mockRejectedValueOnce(new Error("Whop is down"));
    expect(await maybeTopUp("user_1")).toBe("error");
    expect(await maybeTopUp("user_1")).toBe("pending");
    expect((await getSettings("user_1")).lastError).toBe("Whop is down");
  });

  it("cron checks every enabled user", async () => {
    await enable();
    or.only().usage = 4.8;
    expect(await runAutoTopUps()).toMatchObject({ charged: 1 });
  });
});

afterAll(closeDb);
