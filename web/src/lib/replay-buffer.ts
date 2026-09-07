export type ReplaySegment = { blob: Blob; startedAt: number; durationMs: number };
export type OverviewFrame = { url: string; atSeconds: number; capturedAt?: number; sampleOffsetsSeconds?: number[] };
export type ReplayCapsule = {
  overviewFrames: OverviewFrame[];
  segments: ReplaySegment[];
  startedAt: number;
  triggeredAt: number;
};
type TimedFrame = { canvas: HTMLCanvasElement; capturedAt: number };
type PreviewFrame = { dataUrl: string; capturedAt: number };
// The single most notable detected change in a window, for the "방금 뭐가
// 바뀌었나" before/after UI -- bbox is normalized [0,1] (left, top, right,
// bottom), see the comment on ChangeTracker.observe's call site below.
export type ChangeHighlight = { beforeUrl: string; afterUrl: string; bbox: [number, number, number, number] };

const SEGMENT_MS = 1_000;
const PREVIEW_INTERVAL_MS = 250;
const MAX_BYTES = 250 * 1024 * 1024;

// Change detection: a JS/Canvas port of airpointer/screen_buffer.py's
// _ChangeTracker (see docs/replay-change-detection.md for the full design
// writeup) -- picks candidate frames by actual detected screen change
// instead of blind even spacing, same motivation as the native app: a
// brief, unattended change (an error toast) can fall entirely between two
// evenly-spaced samples and never get sent at all.
const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
const PIXEL_THRESHOLD = 25;
const TILE_COLS = 8;
const TILE_ROWS = 8;
const GLOBAL_MIN_SCORE = 0.02;
const TILE_MIN_SCORE = 0.15;
const QUIET_FRAMES_TO_CLOSE = 2;
const MAX_CHANGE_EVENTS = 512;
// How hard an overlapping-bbox event gets penalized in selectEventsDiverse
// (1.0 = a fully-overlapping repeat scores 0; 0.0 = pure top-score, no
// diversity) and the extent below which an event counts as "localized" (a
// toast/dialog, not a scroll) for that function's guaranteed-slot floor --
// see airpointer/screen_buffer.py's _REDUNDANCY_LAMBDA/_LOCALIZED_EXTENT_MAX.
const REDUNDANCY_LAMBDA = 0.7;
const LOCALIZED_EXTENT_MAX = 0.05;

type ChangeEvent = {
  startedAt: number; peakAt: number; endedAt: number; peakScore: number;
  bbox: [number, number, number, number]; // left, top, right, bottom in source pixel coords
  // Fraction of the WHOLE thumbnail that differed (mask mean), never clamped
  // up by the tile floor the way peakScore can be -- see scoreAndBbox. A
  // toast can score high via the tile threshold while its extent stays tiny
  // (a scroll's is the opposite: high on both). Used by selectEventsDiverse
  // to guarantee small/localized changes a slot even when broader changes
  // would otherwise out-rank them every time on peakScore alone.
  extent: number;
};

function grayscaleThumbnail(source: CanvasImageSource, sourceWidth: number, sourceHeight: number,
                             scratch: HTMLCanvasElement): Uint8Array {
  scratch.width = THUMB_WIDTH;
  scratch.height = THUMB_HEIGHT;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  const { data } = ctx.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  const gray = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT);
  for (let i = 0; i < gray.length; i += 1) {
    const o = i * 4;
    gray[i] = (data[o] + data[o + 1] + data[o + 2]) / 3;
  }
  return gray;
}

// None if nothing crossed either threshold. Tile hits take priority for the
// bbox -- a small, concentrated change (a toast in one corner) should report
// a tight box around just that corner, not the whole-mask bounding box,
// which balloons out to cover unrelated noise elsewhere on screen.
function scoreAndBbox(prev: Uint8Array, curr: Uint8Array, width: number, height: number
                       ): { score: number; bbox: [number, number, number, number]; extent: number } | null {
  const mask = new Uint8Array(prev.length);
  let changed = 0;
  for (let i = 0; i < prev.length; i += 1) {
    if (Math.abs(prev[i] - curr[i]) > PIXEL_THRESHOLD) { mask[i] = 1; changed += 1; }
  }
  const globalScore = changed / mask.length;
  const tileW = Math.floor(THUMB_WIDTH / TILE_COLS);
  const tileH = Math.floor(THUMB_HEIGHT / TILE_ROWS);
  const hotTiles: Array<[number, number]> = [];
  for (let row = 0; row < TILE_ROWS; row += 1) {
    for (let col = 0; col < TILE_COLS; col += 1) {
      let sum = 0;
      for (let y = row * tileH; y < (row + 1) * tileH; y += 1) {
        for (let x = col * tileW; x < (col + 1) * tileW; x += 1) sum += mask[y * THUMB_WIDTH + x];
      }
      if (sum / (tileW * tileH) >= TILE_MIN_SCORE) hotTiles.push([row, col]);
    }
  }
  if (!hotTiles.length && globalScore < GLOBAL_MIN_SCORE) return null;
  const scaleX = width / THUMB_WIDTH;
  const scaleY = height / THUMB_HEIGHT;
  if (hotTiles.length) {
    const rows = hotTiles.map((tile) => tile[0]);
    const cols = hotTiles.map((tile) => tile[1]);
    const bbox: [number, number, number, number] = [
      Math.round(Math.min(...cols) * tileW * scaleX), Math.round(Math.min(...rows) * tileH * scaleY),
      Math.round((Math.max(...cols) + 1) * tileW * scaleX), Math.round((Math.max(...rows) + 1) * tileH * scaleY),
    ];
    return { score: Math.max(globalScore, TILE_MIN_SCORE), bbox, extent: globalScore };
  }
  let minX = THUMB_WIDTH, minY = THUMB_HEIGHT, maxX = 0, maxY = 0;
  for (let y = 0; y < THUMB_HEIGHT; y += 1) {
    for (let x = 0; x < THUMB_WIDTH; x += 1) {
      if (!mask[y * THUMB_WIDTH + x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return {
    score: globalScore,
    bbox: [Math.round(minX * scaleX), Math.round(minY * scaleY), Math.round((maxX + 1) * scaleX), Math.round((maxY + 1) * scaleY)],
    extent: globalScore,
  };
}

// Merges consecutive above-threshold frames into one ChangeEvent (so a
// multi-frame scroll doesn't spam the picker with one event per frame) --
// see _ChangeTracker in screen_buffer.py for the same state machine.
class ChangeTracker {
  private prev: Uint8Array | null = null;
  private active = false;
  private quietRun = 0;
  private startedAt = 0;
  private peakAt = 0;
  private peakScore = 0;
  private peakBbox: [number, number, number, number] = [0, 0, 0, 0];
  private peakExtent = 0;
  // Lazy, not a field initializer: BrowserReplayBuffer (and so this class)
  // is constructed during Next.js's server-side render too, where
  // `document` doesn't exist -- observe() itself only ever actually runs
  // client-side (from the preview-capture interval), so deferring the
  // canvas creation to there avoids crashing the SSR pass.
  private scratch: HTMLCanvasElement | null = null;

  observe(source: CanvasImageSource, width: number, height: number, at: number): ChangeEvent | null {
    if (!this.scratch) this.scratch = document.createElement("canvas");
    const curr = grayscaleThumbnail(source, width, height, this.scratch);
    const prev = this.prev;
    this.prev = curr;
    if (!prev) return null;
    const result = scoreAndBbox(prev, curr, width, height);
    if (result) {
      if (!this.active) {
        this.active = true; this.startedAt = at; this.peakAt = at; this.peakScore = result.score; this.peakBbox = result.bbox; this.peakExtent = result.extent;
      } else if (result.score > this.peakScore) {
        this.peakAt = at; this.peakScore = result.score; this.peakBbox = result.bbox; this.peakExtent = result.extent;
      }
      this.quietRun = 0;
      return null;
    }
    if (this.active) {
      this.quietRun += 1;
      if (this.quietRun >= QUIET_FRAMES_TO_CLOSE) {
        const event: ChangeEvent = { startedAt: this.startedAt, peakAt: this.peakAt, endedAt: at, peakScore: this.peakScore, bbox: this.peakBbox, extent: this.peakExtent };
        this.active = false;
        return event;
      }
    }
    return null;
  }
}

// Intersection-over-union of two (left, top, right, bottom) boxes, 0 if they
// don't overlap at all -- a cheap, already-available proxy for "are these
// two events actually the same ongoing thing" used by selectEventsDiverse.
// Port of airpointer/screen_buffer.py's _bbox_iou.
function bboxIou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]);
  const bottom = Math.min(a[3], b[3]);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

// Greedy MMR (Maximal Marginal Relevance) selection: at each step, picks the
// event maximizing peakScore * (1 - REDUNDANCY_LAMBDA * overlap with
// whatever's already been picked). Plain top-K-by-score lets several
// near-duplicate large events (three segments of the same long scroll, say)
// dominate every slot just because each one individually outscores a
// smaller, differently-located event -- once the first is picked, later ones
// that overlap its bbox get penalized, leaving room for the rest.
//
// Then applies a floor: if nothing picked so far is "localized" (extent <
// LOCALIZED_EXTENT_MAX -- a toast/dialog, not a scroll/window-switch) but at
// least one such event exists among the candidates, the weakest current pick
// is swapped out for the best localized one (or just appended, if there's
// still room in the budget). Without this, a busy window full of several
// distinct broad changes could still MMR its way through the whole budget on
// score alone, with a low-scoring toast never winning a slot on its own
// merits. Port of airpointer/screen_buffer.py's _select_events_diverse; see
// docs/replay-change-detection.md for the full design writeup.
function selectEventsDiverse(events: ChangeEvent[], budget: number): ChangeEvent[] {
  const remaining = [...events];
  const picked: ChangeEvent[] = [];
  while (remaining.length && picked.length < budget) {
    const effective = (event: ChangeEvent) => {
      const redundancy = picked.reduce((max, other) => Math.max(max, bboxIou(event.bbox, other.bbox)), 0);
      return event.peakScore * (1 - REDUNDANCY_LAMBDA * redundancy);
    };
    let best = remaining[0];
    let bestScore = effective(best);
    for (const event of remaining.slice(1)) {
      const score = effective(event);
      if (score > bestScore) { best = event; bestScore = score; }
    }
    picked.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }

  if (budget > 0 && !picked.some((event) => event.extent < LOCALIZED_EXTENT_MAX)) {
    const localized = events.filter((event) => event.extent < LOCALIZED_EXTENT_MAX && !picked.includes(event));
    if (localized.length) {
      const bestLocalized = localized.reduce((best, event) => (event.peakScore > best.peakScore ? event : best));
      if (picked.length < budget) {
        picked.push(bestLocalized);
      } else {
        let weakestIndex = 0;
        for (let i = 1; i < picked.length; i += 1) if (picked[i].peakScore < picked[weakestIndex].peakScore) weakestIndex = i;
        picked[weakestIndex] = bestLocalized;
      }
    }
  }

  return picked;
}

// A JS port of screen_buffer.py's _select_notable_moments, generalized to
// any timed candidate list (250ms preview frames, or sampled points within
// recorded segments -- both call sites in recentCapsule below). Unlike the
// Python version there's no "segment" indirection: each candidate already
// is a specific instant, so picking one per notable event is enough (no
// need to allow the same bucket twice).
function selectNotable<T extends { capturedAt: number }>(candidates: T[], events: ChangeEvent[], count: number): T[] {
  if (candidates.length <= count) return [...candidates];
  const byTime = [...candidates].sort((a, b) => a.capturedAt - b.capturedAt);
  const nearest = (at: number): T | null => {
    let best: T | null = null;
    let bestDelta = Infinity;
    for (const item of byTime) {
      const delta = Math.abs(item.capturedAt - at);
      if (delta < bestDelta) { bestDelta = delta; best = item; }
    }
    return best;
  };
  // Same-instant dedup ahead of MMR: multiple change events can round-trip
  // to the same nearest candidate frame (coarse preview sampling), so keep
  // only the highest-scoring event per candidate -- mirrors the Python
  // side's dedup-by-segment step ahead of _select_events_diverse.
  const eventByCandidate = new Map<T, ChangeEvent>();
  for (const event of events) {
    const candidate = nearest(event.peakAt);
    if (!candidate) continue;
    const existing = eventByCandidate.get(candidate);
    if (!existing || event.peakScore > existing.peakScore) eventByCandidate.set(candidate, event);
  }
  const candidateByEvent = new Map<ChangeEvent, T>();
  for (const [candidate, event] of eventByCandidate) candidateByEvent.set(event, candidate);

  const seen = new Set<T>();
  const picks: T[] = [];
  for (const event of selectEventsDiverse([...candidateByEvent.keys()], Math.max(1, count - 2))) {
    const candidate = candidateByEvent.get(event)!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    picks.push(candidate);
  }
  const result = [...picks];
  for (const boundary of [byTime[0], byTime[byTime.length - 1]]) {
    if (!seen.has(boundary)) { result.push(boundary); seen.add(boundary); }
  }
  if (result.length < count) {
    const remaining = byTime.filter((item) => !seen.has(item));
    for (const item of evenlySpaced(remaining, count - result.length)) { result.push(item); seen.add(item); }
  }
  return result.sort((a, b) => a.capturedAt - b.capturedAt).slice(0, count);
}

export class BrowserReplayBuffer {
  private segments: ReplaySegment[] = [];
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private previewVideo: HTMLVideoElement | null = null;
  private previewTimer: number | null = null;
  private previewFrames: PreviewFrame[] = [];
  private changeTracker = new ChangeTracker();
  private changeEvents: ChangeEvent[] = [];
  private active = false;
  private generation = 0;
  private retentionMs: number;

  constructor(retentionMs: number) { this.retentionMs = retentionMs; }

  setRetention(minutes: number) {
    this.retentionMs = minutes * 60_000;
    this.prune(Date.now());
  }

  start(stream: MediaStream) {
    this.stop();
    this.stream = stream;
    this.active = true;
    const generation = this.generation;
    this.startPreviewCapture(stream, generation);
    this.recordNext(generation);
  }

  stop() {
    this.active = false;
    this.generation += 1;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.recorder = null;
    if (this.previewTimer !== null) window.clearInterval(this.previewTimer);
    this.previewTimer = null;
    if (this.previewVideo) {
      this.previewVideo.pause();
      this.previewVideo.srcObject = null;
    }
    this.previewVideo = null;
    this.previewFrames = [];
    // Fresh tracker per stop()/start() cycle: its previous-frame thumbnail
    // and any in-progress event belong to whatever was on screen before
    // this session ended -- comparing against that stale frame on the very
    // first new frame would manufacture a bogus "everything changed" event.
    this.changeTracker = new ChangeTracker();
    this.changeEvents = [];
    this.stream = null;
    this.segments = [];
  }

  status() {
    const bytes = this.segments.reduce((total, segment) => total + segment.blob.size, 0);
    const durationMs = this.segments.reduce((total, segment) => total + segment.durationMs, 0);
    return { bytes, durationMs, segmentCount: this.segments.length };
  }

  async recentFrames(seconds: number, count = 6): Promise<string[]> {
    return (await this.recentCapsule(seconds, count)).overviewFrames.map((frame) => frame.url);
  }

  async recentCapsule(seconds: number, count = 6): Promise<ReplayCapsule> {
    await this.flushCurrentSegment();
    const now = Date.now();
    const cutoff = now - seconds * 1_000;
    const recent = this.segments.filter((segment) => segment.startedAt + segment.durationMs >= cutoff);
    if (!recent.length) return { overviewFrames: [], segments: [], startedAt: cutoff, triggeredAt: now };
    const windowEvents = this.changeEvents.filter((event) => event.peakAt >= cutoff && event.peakAt <= now);
    const previewCandidates = this.previewFrames.filter((frame) => frame.capturedAt >= cutoff && frame.capturedAt <= now);
    let frames = await framesFromPreviews(selectNotable(previewCandidates, windowEvents, Math.min(60, previewCandidates.length)));
    if (!frames.length) {
      const sampleIntervalMs = Math.max(250, Math.ceil((seconds * 1_000) / 60 / 50) * 50);
      const candidates = sampleSegmentPoints(recent, cutoff, now, sampleIntervalMs);
      const chosen = selectNotable(candidates, windowEvents, Math.min(60, candidates.length));
      const bySegment = new Map<number, Array<{ ratio: number; capturedAt: number }>>();
      for (const point of chosen) {
        const points = bySegment.get(point.segmentIndex) || [];
        points.push({ ratio: point.ratio, capturedAt: point.capturedAt });
        bySegment.set(point.segmentIndex, points);
      }
      const groups = await Promise.all([...bySegment].map(async ([segmentIndex, points]) => {
        try { return await framesFromBlob(recent[segmentIndex].blob, points); }
        catch { return []; }
      }));
      frames = groups.flat().sort((a, b) => a.capturedAt - b.capturedAt);
    }
    return { overviewFrames: makeContactSheets(frames, now, count), segments: [...recent], startedAt: cutoff, triggeredAt: now };
  }

  // The single highest-scoring detected change in the window, as a
  // before/after pair of already-captured preview thumbnails (250ms
  // cadence, so no extra decode work) plus its normalized bbox -- powers the
  // "방금 뭐가 바뀌었나" highlight card. Simplest-possible pick (max
  // peakScore, not the MMR diversity used for frame selection) since this is
  // a single headline pick, not a budget to fill.
  recentHighlight(seconds: number): ChangeHighlight | null {
    const now = Date.now();
    const cutoff = now - seconds * 1_000;
    const windowEvents = this.changeEvents.filter((event) => event.peakAt >= cutoff && event.peakAt <= now);
    if (!windowEvents.length || !this.previewFrames.length) return null;
    const top = windowEvents.reduce((best, event) => (event.peakScore > best.peakScore ? event : best));
    const byTime = [...this.previewFrames].sort((a, b) => a.capturedAt - b.capturedAt);
    const nearest = (at: number) => byTime.reduce((best, frame) =>
      Math.abs(frame.capturedAt - at) < Math.abs(best.capturedAt - at) ? frame : best);
    const before = byTime.filter((frame) => frame.capturedAt < top.startedAt).at(-1) ?? nearest(top.startedAt);
    return { beforeUrl: before.dataUrl, afterUrl: nearest(top.peakAt).dataUrl, bbox: top.bbox };
  }

  private startPreviewCapture(stream: MediaStream, generation: number) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.previewVideo = video;
    const capture = () => {
      if (!this.active || generation !== this.generation || video.readyState < 2 || !video.videoWidth) return;
      const canvas = thumbnailFromVideo(video);
      const capturedAt = Date.now();
      this.previewFrames.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.48), capturedAt });
      // Observe the entire source. Passing 1x1 here crops the input to its
      // top-left pixel; normalize only the resulting screen coordinates.
      const event = this.changeTracker.observe(video, video.videoWidth, video.videoHeight, capturedAt);
      if (event) {
        event.bbox = [event.bbox[0] / video.videoWidth, event.bbox[1] / video.videoHeight,
          event.bbox[2] / video.videoWidth, event.bbox[3] / video.videoHeight];
        this.changeEvents.push(event);
        if (this.changeEvents.length > MAX_CHANGE_EVENTS) this.changeEvents.shift();
      }
      this.prune(Date.now());
    };
    void video.play().then(capture).catch(() => undefined);
    this.previewTimer = window.setInterval(capture, PREVIEW_INTERVAL_MS);
  }

  private async flushCurrentSegment() {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording") return;
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
  }

  private recordNext(generation: number) {
    if (!this.active || !this.stream || generation !== this.generation) return;
    const mimeType = supportedMimeType();
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType, videoBitsPerSecond: 2_000_000 } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (!this.active || generation !== this.generation) return;
      if (chunks.length) {
        this.segments.push({ blob: new Blob(chunks, { type: recorder.mimeType }), startedAt, durationMs: Math.max(1, Date.now() - startedAt) });
        this.prune(Date.now());
      }
      this.recordNext(generation);
    };
    this.recorder = recorder;
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state === "recording" && this.active && generation === this.generation) recorder.stop();
    }, SEGMENT_MS);
  }

  private prune(now: number) {
    const cutoff = now - this.retentionMs;
    this.segments = this.segments.filter((segment) => segment.startedAt + segment.durationMs >= cutoff);
    this.previewFrames = this.previewFrames.filter((frame) => frame.capturedAt >= cutoff);
    this.changeEvents = this.changeEvents.filter((event) => event.peakAt >= cutoff);
    let bytes = this.segments.reduce((total, segment) => total + segment.blob.size, 0);
    while (bytes > MAX_BYTES && this.segments.length > 1) bytes -= this.segments.shift()!.blob.size;
  }
}

export function evenlySpaced<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (count === 1) return [items[items.length - 1]];
  if (count >= items.length) return [...items];
  return Array.from({ length: count }, (_, index) => items[Math.round((index * (items.length - 1)) / (count - 1))]);
}

export function frameFromVideo(video: HTMLVideoElement, quality = 0.76): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, video.videoWidth);
  canvas.height = Math.max(1, video.videoHeight);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function framesFromPreviews(previews: PreviewFrame[]): Promise<TimedFrame[]> {
  return Promise.all(previews.map(async (preview) => {
    const image = new Image();
    image.src = preview.dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return { canvas, capturedAt: preview.capturedAt };
  }));
}

export function frameFromVideoRegion(video: HTMLVideoElement,
  region: { left: number; top: number; right: number; bottom: number }, quality = 0.82): string {
  const sourceWidth = Math.max(1, video.videoWidth);
  const sourceHeight = Math.max(1, video.videoHeight);
  const sx = Math.max(0, Math.min(sourceWidth - 1, Math.round(region.left * sourceWidth)));
  const sy = Math.max(0, Math.min(sourceHeight - 1, Math.round(region.top * sourceHeight)));
  const sw = Math.max(1, Math.min(sourceWidth - sx, Math.round((region.right - region.left) * sourceWidth)));
  const sh = Math.max(1, Math.min(sourceHeight - sy, Math.round((region.bottom - region.top) * sourceHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")!.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/jpeg", quality);
}

// Crops a normalized [0,1] bbox out of an already-captured image (a preview
// thumbnail, not a live video -- see ChangeHighlight), with a little padding
// so the zoom doesn't hug the edges of whatever actually changed. Used both
// for the highlight card's "확대" view and as an extra frame sent to the
// analyze API so small/cut-off text in the changed region reads clearly.
export async function cropRegion(dataUrl: string, bbox: [number, number, number, number], padding = 0.12): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const [left, top, right, bottom] = bbox;
  const padX = (right - left) * padding;
  const padY = (bottom - top) * padding;
  const sx = Math.max(0, Math.round((left - padX) * image.naturalWidth));
  const sy = Math.max(0, Math.round((top - padY) * image.naturalHeight));
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, Math.round((right - left + padX * 2) * image.naturalWidth)));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, Math.round((bottom - top + padY * 2) * image.naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")!.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function sampleSegmentPoints(segments: ReplaySegment[], cutoff: number, now: number, intervalMs: number) {
  return segments.flatMap((segment, segmentIndex) => {
    const start = Math.max(cutoff, segment.startedAt);
    const end = Math.min(now, segment.startedAt + segment.durationMs);
    if (end <= start) return [];
    const points: Array<{ segmentIndex: number; ratio: number; capturedAt: number }> = [];
    for (let capturedAt = start + intervalMs / 2; capturedAt < end; capturedAt += intervalMs) {
      points.push({ segmentIndex, ratio: (capturedAt - segment.startedAt) / segment.durationMs, capturedAt });
    }
    if (!points.length) {
      const capturedAt = start + (end - start) / 2;
      points.push({ segmentIndex, ratio: (capturedAt - segment.startedAt) / segment.durationMs, capturedAt });
    }
    return points;
  });
}

async function framesFromBlob(blob: Blob, points: Array<{ ratio: number; capturedAt: number }>): Promise<TimedFrame[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(blob);
  try {
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("버퍼 프레임을 읽지 못했습니다."));
    });
    const duration = video.duration && Number.isFinite(video.duration) ? video.duration : 1;
    const frames: TimedFrame[] = [];
    for (const point of points) {
      video.currentTime = Math.min(Math.max(0, duration * point.ratio), Math.max(0, duration - 0.025));
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        video.onseeked = done;
        window.setTimeout(done, 180);
      });
      frames.push({ canvas: thumbnailFromVideo(video), capturedAt: point.capturedAt });
    }
    return frames;
  } finally { URL.revokeObjectURL(url); }
}

function thumbnailFromVideo(video: HTMLVideoElement) {
  const width = 640;
  const height = Math.max(1, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
  return canvas;
}

function makeContactSheets(frames: TimedFrame[], now: number, maxSheets: number): OverviewFrame[] {
  const perSheet = 10;
  return Array.from({ length: Math.min(maxSheets, Math.ceil(frames.length / perSheet)) }, (_, sheetIndex) => {
    const page = frames.slice(sheetIndex * perSheet, (sheetIndex + 1) * perSheet);
    const cellWidth = 640;
    const cellHeight = Math.max(...page.map((frame) => frame.canvas.height));
    const columns = 2;
    const rows = Math.ceil(page.length / columns);
    const sheet = document.createElement("canvas");
    sheet.width = cellWidth * columns;
    sheet.height = cellHeight * rows;
    const context = sheet.getContext("2d")!;
    context.fillStyle = "#0c0c0b";
    context.fillRect(0, 0, sheet.width, sheet.height);
    page.forEach((frame, index) => {
      const x = (index % columns) * cellWidth;
      const y = Math.floor(index / columns) * cellHeight;
      context.drawImage(frame.canvas, x, y, cellWidth, frame.canvas.height);
      context.fillStyle = "rgba(0,0,0,.82)";
      context.fillRect(x + 8, y + 8, 90, 25);
      context.fillStyle = "#ff8a50";
      context.font = "600 15px monospace";
      context.fillText(`-${((now - frame.capturedAt) / 1_000).toFixed(2)}s`, x + 15, y + 26);
    });
    // Representative offset for this sheet's own outer caption (see
    // replay-workspace.tsx's frame grid) -- the middle sub-frame's real
    // capture time, now that selection is no longer uniform so an
    // index-based guess would be wrong.
    const representative = page[Math.floor(page.length / 2)] ?? page[0];
    return { capturedAt: now, sampleOffsetsSeconds: page.map(frame => Math.max(0, (now - frame.capturedAt) / 1000)), url: sheet.toDataURL("image/jpeg", 0.68), atSeconds: Math.max(0, (now - representative.capturedAt) / 1_000) };
  });
}

function supportedMimeType() {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
