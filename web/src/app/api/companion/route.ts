import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ error: "Invalid companion token." }, { status: 400 });
  }
  try {
    const response = await fetch(`http://127.0.0.1:47822/status?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const body = await response.text();
    return new NextResponse(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "Companion unavailable." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ error: "Invalid companion token." }, { status: 400 });
  }
  try {
    const payload: unknown = await request.json();
    const response = await fetch(`http://127.0.0.1:47822/config?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return new NextResponse(null, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Companion unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const host = new URL(request.url).hostname;
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(host)) {
    return NextResponse.json({ error: "Local companion launch is unavailable." }, { status: 403 });
  }

  let payload: { command?: unknown; token?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!["start", "quit"].includes(String(payload.command)) ||
      typeof payload.token !== "string" || !TOKEN_PATTERN.test(payload.token)) {
    return NextResponse.json({ error: "Invalid companion command." }, { status: 400 });
  }

  if (payload.command === "quit") {
    const stopped = await sendControlCommand("quit", payload.token);
    return NextResponse.json({ stopped });
  }

  // The Python side is also supposed to defer to an already-running instance
  // instead of opening a second window, but that has proven unreliable in
  // practice (multiple overlapping AirPointer windows/overlays). Check here
  // first, authoritatively, so this route never spawns a second process
  // while one is already listening -- only fall through to spawning a fresh
  // one when nothing answers the control port at all.
  if (await sendControlCommand("start", payload.token)) {
    return NextResponse.json({ launched: true }, { status: 202 });
  }

  const repoRoot = resolve(process.cwd(), "..");
  const protocolArg = `airpointer://${payload.command}?token=${encodeURIComponent(payload.token)}`;
  try {
    // Dev convenience: prefer running the live Python source over the
    // portable build when it's present in the repo, so "AirPointer 켜기"
    // always reflects whatever's actually in airpointer/ right now instead
    // of whatever was last packaged into portable/AirPointer.exe (which
    // silently goes stale the moment the source changes).
    const sourceLauncher = resolve(repoRoot, "airpointer_launcher.py");
    if (existsSync(sourceLauncher)) {
      const child = spawn(process.env.PYTHON_EXECUTABLE || "python", [sourceLauncher, protocolArg], {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return NextResponse.json({ launched: true }, { status: 202 });
    }

    const executable = resolve(repoRoot, "portable", "AirPointer.exe");
    await access(executable);
    const child = spawn(executable, [protocolArg], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return NextResponse.json({ launched: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not launch AirPointer." }, { status: 503 });
  }
}

function sendControlCommand(command: "start" | "quit", token: string): Promise<boolean> {
  return new Promise((resolveCommand) => {
    const socket = createConnection({ host: "127.0.0.1", port: 47821 });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveCommand(value);
    };
    socket.setTimeout(1_500, () => finish(false));
    socket.once("connect", () => socket.write(`${command} ${token}\n`));
    socket.once("data", (data) => finish(data.toString("ascii").trim() === "OK"));
    socket.once("error", () => finish(false));
  });
}
