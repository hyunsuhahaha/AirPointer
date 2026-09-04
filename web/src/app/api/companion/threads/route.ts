import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

// Proxies to AirPointer's companion server (127.0.0.1:47822/threads, see
// airpointer/companion_bridge.py) so the browser's own agent picker can
// list Claude Desktop's conversations the same way it already lists
// Codex's via /api/agent -- see /api/companion/send/route.ts for why this
// goes through the native app rather than a second Node-side bridge.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const target = url.searchParams.get("target") || "codex";
  if (!TOKEN_PATTERN.test(token) || !["codex", "claude"].includes(target)) {
    return NextResponse.json({ error: "Invalid request.", threads: [] }, { status: 400 });
  }
  try {
    const response = await fetch(
      `http://127.0.0.1:47822/threads?token=${encodeURIComponent(token)}&target=${target}`,
      { cache: "no-store" },
    );
    const body = await response.text();
    return new NextResponse(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "AirPointer가 실행 중이 아닙니다.", threads: [] }, { status: 503 });
  }
}
