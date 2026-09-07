import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9-]{1,128}$/;
const ENDPOINTS = new Set(["frames", "frame", "delete", "report"]);

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const endpoint = url.searchParams.get("endpoint") || "frames";
  if (!TOKEN_PATTERN.test(token) || !ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: "Invalid memory bridge request." }, { status: 400 });
  }
  try {
    const payload: unknown = await request.json();
    const response = await fetch(`http://127.0.0.1:47822/memory/${endpoint}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "AirPointer가 실행 중이 아닙니다." }, { status: 503 });
  }
}
