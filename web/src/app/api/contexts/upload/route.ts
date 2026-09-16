import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { contextBlobPath, safeContentType, safeRelativePath } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as HandleUploadBody;
    if (body.type === "blob.generate-client-token") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "같은 사이트에서만 업로드할 수 있습니다." }, { status: 403 });
    }
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload || "{}") as { token?: string; path?: string; type?: string };
        const filePath = safeRelativePath(payload.path || "");
        const contentType = safeContentType(filePath, payload.type || "").split(";", 1)[0];
        if (pathname !== contextBlobPath(payload.token || "", filePath)) throw new Error("Context 업로드 경로가 올바르지 않습니다.");
        return {
          allowedContentTypes: [contentType], maximumSizeInBytes: 25 * 1024 * 1024,
          validUntil: Date.now() + 5 * 60 * 1_000, addRandomSuffix: false, allowOverwrite: false,
          tokenPayload: clientPayload,
        };
      },
    });
    return Response.json(response);
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Context 파일을 업로드하지 못했습니다." }, { status: 400 });
  }
}
