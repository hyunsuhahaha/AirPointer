import { sweepExpiredContexts } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called once a day by Vercel Cron (see vercel.json), which sends CRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "권한이 없습니다." }, { status: 401 });
  }
  const result = await sweepExpiredContexts();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
