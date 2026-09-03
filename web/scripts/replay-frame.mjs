import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const [manifestPath, ...rawOffsets] = process.argv.slice(2);
if (!manifestPath || !rawOffsets.length) {
  console.error("Usage: node replay-frame.mjs <manifest.json> <-0.5> [<-1> ...]");
  process.exit(2);
}
if (!ffmpegPath || !existsSync(ffmpegPath)) {
  console.error("Bundled ffmpeg executable was not found.");
  process.exit(3);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const queryDir = join(dirname(manifestPath), "queries");
mkdirSync(queryDir, { recursive: true });
const results = rawOffsets.map((rawOffset) => extractFrame(manifest, Number(rawOffset), queryDir));
console.log(JSON.stringify(results, null, 2));

function extractFrame(manifest, offsetSeconds, outputDir) {
  if (!Number.isFinite(offsetSeconds)) throw new Error(`Invalid offset: ${offsetSeconds}`);
  const targetAt = manifest.triggeredAt + offsetSeconds * 1_000;
  const segment = findSegment(manifest.segments, targetAt);
  if (!segment) throw new Error(`No recorded segment covers ${offsetSeconds}s.`);
  const seekSeconds = Math.max(0, Math.min(segment.durationMs - 1, targetAt - segment.startedAt)) / 1_000;
  const safeOffset = `${offsetSeconds >= 0 ? "plus" : "minus"}-${Math.abs(offsetSeconds).toFixed(3).replace(".", "_")}`;
  const outputPath = join(outputDir, `${safeOffset}-${basename(segment.path, ".webm")}.jpg`);
  const run = spawnSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", seekSeconds.toFixed(3), "-i", segment.path, "-frames:v", "1", "-q:v", "2", "-y", outputPath], { windowsHide: true, encoding: "utf8" });
  if (run.status !== 0 || !existsSync(outputPath)) throw new Error(run.stderr || `Could not extract ${offsetSeconds}s.`);
  return { requestedOffsetSeconds: offsetSeconds, actualOffsetSeconds: (segment.startedAt + seekSeconds * 1_000 - manifest.triggeredAt) / 1_000, framePath: outputPath };
}

function findSegment(segments, targetAt) {
  return segments.find((segment) => targetAt >= segment.startedAt && targetAt <= segment.startedAt + segment.durationMs) || [...segments].sort((a, b) => distanceToSegment(a, targetAt) - distanceToSegment(b, targetAt))[0];
}

function distanceToSegment(segment, targetAt) {
  if (targetAt < segment.startedAt) return segment.startedAt - targetAt;
  if (targetAt > segment.startedAt + segment.durationMs) return targetAt - segment.startedAt - segment.durationMs;
  return 0;
}
