import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

// Proxies to AirPointer's companion server (127.0.0.1:47822/sent-frames, see
// airpointer/companion_bridge.py) -- pulled by useCompanionGesture only when
// the status snapshot's `sentEvent` counter bumps, since these can be
// several full-size JPEGs and the status poll itself runs every 100ms.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ error: "Invalid companion token.", frames: [] }, { status: 400 });
  }
  try {
    const response = await fetch(
      `http://127.0.0.1:47822/sent-frames?token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    const body = await response.text();
    return new NextResponse(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "AirPointer가 실행 중이 아닙니다.", frames: [] }, { status: 503 });
  }
}
