import { deleteStoredContext } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const deleted = await deleteStoredContext(token);
  return new Response(null, { status: deleted ? 204 : 404, headers: { "Cache-Control": "no-store" } });
}
