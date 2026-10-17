import { after } from "next/server";
import { maybeTopUp } from "@/lib/autotopup";
import { errorResponse, requireUserId } from "@/lib/auth";
import { getUserApiKey } from "@/lib/credits";

export const runtime = "nodejs";

// Forwards an OpenAI-style chat completion to OpenRouter using the user's own
// capped key, so they can only spend the credit they have paid for.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId(request);
    const apiKey = await getUserApiKey(userId);
    if (!apiKey) return Response.json({ error: "No credits yet. Pick a plan or buy credits." }, { status: 402 });

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: await request.text(),
    });

    // Check the balance once the response is done and top up if needed.
    after(() => maybeTopUp(userId).catch((err) => console.error("auto top-up failed", userId, err)));

    if (upstream.status === 402) {
      return Response.json({ error: "Out of credits. Buy more or turn on auto top-up." }, { status: 402 });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
