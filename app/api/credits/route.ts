import { getSettings } from "@/lib/autotopup";
import { errorResponse, requireUserId } from "@/lib/auth";
import { getBalance } from "@/lib/credits";
import { creditPacks } from "@/lib/plans";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId(request);
    const [balance, autoTopUp] = await Promise.all([getBalance(userId), getSettings(userId)]);
    const packs = Object.entries(creditPacks()).map(([planId, creditUsd]) => ({ planId, creditUsd }));
    return Response.json({ balance, autoTopUp, packs });
  } catch (err) {
    return errorResponse(err);
  }
}
