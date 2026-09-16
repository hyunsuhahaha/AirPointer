import { createStoredContext } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== new URL(request.url).origin) || (fetchSite && fetchSite !== "same-origin")) {
      return Response.json({ error: "같은 사이트에서만 Context를 만들 수 있습니다." }, { status: 403 });
    }
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 250 * 1024 * 1024) return Response.json({ error: "Context 자료 크기가 너무 큽니다." }, { status: 413 });
    const form = await request.formData();
    const paths = JSON.parse(String(form.get("paths") || "[]")) as unknown;
    const uploads = form.getAll("files");
    const seconds = Number(form.get("seconds"));
    if (!Array.isArray(paths) || paths.some((value) => typeof value !== "string") || paths.length !== uploads.length) {
      return Response.json({ error: "Context 파일 목록이 올바르지 않습니다." }, { status: 400 });
    }
    const files = await Promise.all(uploads.map(async (upload, index) => {
      if (!(upload instanceof File)) throw new Error("Context 파일이 올바르지 않습니다.");
      return { path: paths[index] as string, type: upload.type, bytes: new Uint8Array(await upload.arrayBuffer()) };
    }));
    const context = await createStoredContext({ seconds, files });
    return Response.json({ token: context.token, expiresAt: context.expiresAt, agentPath: `/context/${context.token}/agent` }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Agent Link를 만들지 못했습니다." }, { status: 400 });
  }
}
