import { errorResponse, requireUserId } from "@/lib/auth";
import { env } from "@/lib/env";
import { creditPacks } from "@/lib/plans";
import { whop } from "@/lib/whop";

export const runtime = "nodejs";

// "Buy more credits": returns a Whop checkout URL for a credit pack. Credit is
// granted by the payment.succeeded webhook, never by the redirect.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId(request);
    const { packPlanId } = (await request.json().catch(() => ({}))) as { packPlanId?: unknown };
    if (typeof packPlanId !== "string" || !(packPlanId in creditPacks())) {
      return Response.json({ error: "Unknown credit pack" }, { status: 400 });
    }
    const checkout = await whop().checkoutConfigurations.create({
      account_id: env("WHOP_COMPANY_ID"),
      plan_id: packPlanId,
      redirect_url: `${env("APP_URL")}/credits?purchase=complete`,
      metadata: { purpose: "credit_pack", whop_user_id: userId },
    });
    return Response.json({ url: checkout.purchase_url });
  } catch (err) {
    return errorResponse(err);
  }
}
