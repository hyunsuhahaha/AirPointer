export type ReplayExplorationRequest =
  | { type: "frames"; offsetsSeconds: number[] }
  | { type: "crop"; frameIndex: number; bbox: [number, number, number, number] };

export function formatReplayRange(offsets: number[]): string {
  if (!offsets.length) return "시간 구간";
  const ordered = [...offsets].sort((a, b) => a - b);
  const format = (value: number) => `${Number(value.toFixed(2))}`;
  return ordered.length === 1 ? `${format(ordered[0])}초` : `${format(ordered[0])}~${format(ordered.at(-1)!)}초`;
}

export function replayExplorationRequestsFrom(output: unknown[], seconds: number, frameCount: number, limit: number): ReplayExplorationRequest[] {
  const requests: ReplayExplorationRequest[] = [];
  const offsets: number[] = [];
  let used = 0;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const call = item as { type?: unknown; name?: unknown; arguments?: unknown };
    if (call.type !== "function_call" || typeof call.arguments !== "string" || used >= limit) continue;
    try {
      const args = JSON.parse(call.arguments) as Record<string, unknown>;
      if (call.name === "request_replay_frames" && Array.isArray(args.offsets_seconds)) {
        for (const value of args.offsets_seconds) {
          if (used >= limit) break;
          if (typeof value !== "number" || !Number.isFinite(value) || value >= 0 || value < -seconds || offsets.includes(value)) continue;
          offsets.push(value); used += 1;
        }
      } else if (call.name === "request_replay_crop") {
        const frameIndex = typeof args.frame_number === "number" && Number.isInteger(args.frame_number) ? args.frame_number - 1 : -1;
        const bbox = [args.left, args.top, args.right, args.bottom];
        if (frameIndex < 0 || frameIndex >= frameCount || !bbox.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) continue;
        const normalized = bbox as [number, number, number, number];
        if (normalized[2] - normalized[0] < 0.02 || normalized[3] - normalized[1] < 0.02) continue;
        requests.push({ type: "crop", frameIndex, bbox: normalized }); used += 1;
      }
    } catch { /* Ignore malformed model tool arguments. */ }
  }
  if (offsets.length) requests.unshift({ type: "frames", offsetsSeconds: offsets });
  return requests;
}
