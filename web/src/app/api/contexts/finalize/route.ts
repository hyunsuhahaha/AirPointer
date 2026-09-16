import { finalizeBlobStoredContext } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "같은 사이트에서만 Context를 만들 수 있습니다." }, { status: 403 });
    const context = await finalizeBlobStoredContext(await request.json());
    return Response.json({ token: context.token, expiresAt: context.expiresAt, agentPath: `/context/${context.token}/agent` }, {
      status: 201, headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Agent Link를 완성하지 못했습니다." }, { status: 400 });
  }
}
