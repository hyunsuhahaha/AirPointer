import { readStoredContextFile } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string; file: string[] }> }) {
  const { token, file } = await context.params;
  const stored = await readStoredContextFile(token, file.join("/"));
  if (!stored) return new Response("Not found", { status: 404, headers: privateHeaders() });
  return new Response(stored.bytes, {
    headers: {
      ...privateHeaders(),
      "Content-Type": stored.file.type,
      "Content-Length": String(stored.file.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(stored.file.path.split("/").at(-1) || "context-file")}`,
    },
  });
}

function privateHeaders() {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}
