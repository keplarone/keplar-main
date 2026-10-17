import type { Whop } from "@whop/sdk";
import { unwrapWebhook, WebhookVerificationError } from "@whop/sdk/helpers";
import { handleSetupIntentSucceeded, handleTopUpFailed } from "@/lib/autotopup";
import { grantForPayment, revokeForRefund } from "@/lib/credits";
import { env } from "@/lib/env";

export const runtime = "nodejs";

interface WhopEvent {
  id?: string;
  type?: string;
  action?: string;
  data: unknown;
}

export async function POST(request: Request) {
  const body = await request.text();
  let event: WhopEvent;
  try {
    event = unwrapWebhook<WhopEvent>(body, {
      headers: Object.fromEntries(request.headers),
      key: env("WHOP_WEBHOOK_SECRET"),
    });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response("Invalid signature", { status: 401 });
    throw err;
  }

  const type = event.type ?? event.action;
  try {
    let result: string;
    switch (type) {
      case "payment.succeeded":
        result = await grantForPayment(event.data as Whop.Payment);
        break;
      case "payment.failed":
      case "payment.requires_action":
        result = await handleTopUpFailed(event.data as Whop.Payment);
        break;
      case "refund.created":
      case "refund.updated":
        result = await revokeForRefund(event.data as Whop.Refund);
        break;
      case "setup_intent.succeeded":
        result = await handleSetupIntentSucceeded(event.data as Whop.SetupIntent);
        break;
      default:
        result = "ignored";
    }
    return Response.json({ ok: true, type, result });
  } catch (err) {
    // A 5xx makes Whop redeliver; every handler is idempotent.
    console.error("Whop webhook failed", type, event.id, err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
