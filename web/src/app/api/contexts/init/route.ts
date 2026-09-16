import { blobContextStorageEnabled, newContextIdentity, validateContextFiles } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!blobContextStorageEnabled()) {
    if (process.env.VERCEL) return Response.json({ error: "Vercel Blob 저장소가 연결되지 않았습니다." }, { status: 503 });
    return Response.json({ storage: "local" });
  }
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "같은 사이트에서만 Context를 만들 수 있습니다." }, { status: 403 });
    const body = await request.json() as { seconds?: number; files?: { path: string; type: string; size: number }[] };
    const files = validateContextFiles(body.files ?? []);
    const context = newContextIdentity(Number(body.seconds));
    return Response.json({ storage: "blob", ...context, files }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Context를 준비하지 못했습니다." }, { status: 400 });
  }
}
