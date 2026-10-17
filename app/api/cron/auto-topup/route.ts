import { runAutoTopUps } from "@/lib/autotopup";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

// Scheduled in vercel.json. Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await runAutoTopUps());
}
