import { getSettings, updateSettings, validateSettings } from "@/lib/autotopup";
import { errorResponse, requireUserId } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return Response.json(await getSettings(await requireUserId(request)));
  } catch (err) {
    return errorResponse(err);
  }
}

// Body: { enabled: boolean, thresholdUsd: number, packPlanId: string }
// Returns { setupUrl } when the user still needs to save a card on Whop.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId(request);
    let settings;
    try {
      settings = validateSettings(await request.json());
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "Invalid body" }, { status: 400 });
    }
    const { setupUrl } = await updateSettings(userId, settings);
    return Response.json({ ...(await getSettings(userId)), setupUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
