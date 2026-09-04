import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

// Proxies to AirPointer's own companion server (127.0.0.1:47822/send, see
// airpointer/companion_bridge.py), which runs the browser's screen-share
// capture through the native app's existing Codex/Claude Desktop UI
// automation (airpointer/desktop_paste.py) instead of this reimplementing
// that automation in Node -- see codex-desktop-bridge.ts for why Codex's
// own path can't just be reused for Claude (it depends on Codex-only App
// Tools pipe env vars that have no Claude Code equivalent).
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ error: "Invalid companion token." }, { status: 400 });
  }
  try {
    const payload: unknown = await request.json();
    const response = await fetch(`http://127.0.0.1:47822/send?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    return new NextResponse(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "AirPointer가 실행 중이 아닙니다." }, { status: 503 });
  }
}
