export type ReplaySegment = { blob: Blob; startedAt: number; durationMs: number };
export type ReplayCapsule = {
  overviewFrames: string[];
  segments: ReplaySegment[];
  startedAt: number;
  triggeredAt: number;
};
type TimedFrame = { canvas: HTMLCanvasElement; capturedAt: number };
type PreviewFrame = { dataUrl: string; capturedAt: number };

const SEGMENT_MS = 1_000;
const PREVIEW_INTERVAL_MS = 250;
const MAX_BYTES = 250 * 1024 * 1024;

export class BrowserReplayBuffer {
  private segments: ReplaySegment[] = [];
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private previewVideo: HTMLVideoElement | null = null;
  private previewTimer: number | null = null;
  private previewFrames: PreviewFrame[] = [];
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
    this.stream = null;
    this.segments = [];
  }

  status() {
    const bytes = this.segments.reduce((total, segment) => total + segment.blob.size, 0);
    const durationMs = this.segments.reduce((total, segment) => total + segment.durationMs, 0);
    return { bytes, durationMs, segmentCount: this.segments.length };
  }

  async recentFrames(seconds: number, count = 6): Promise<string[]> {
    return (await this.recentCapsule(seconds, count)).overviewFrames;
  }

  async recentCapsule(seconds: number, count = 6): Promise<ReplayCapsule> {
    await this.flushCurrentSegment();
    const now = Date.now();
    const cutoff = now - seconds * 1_000;
    const recent = this.segments.filter((segment) => segment.startedAt + segment.durationMs >= cutoff);
    if (!recent.length) return { overviewFrames: [], segments: [], startedAt: cutoff, triggeredAt: now };
    const previewCandidates = this.previewFrames.filter((frame) => frame.capturedAt >= cutoff && frame.capturedAt <= now);
    let frames = await framesFromPreviews(evenlySpaced(previewCandidates, Math.min(60, previewCandidates.length)));
    if (!frames.length) {
      const sampleIntervalMs = Math.max(250, Math.ceil((seconds * 1_000) / 60 / 50) * 50);
      const candidates = sampleSegmentPoints(recent, cutoff, now, sampleIntervalMs);
      const chosen = evenlySpaced(candidates, Math.min(60, candidates.length));
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

  private startPreviewCapture(stream: MediaStream, generation: number) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.previewVideo = video;
    const capture = () => {
      if (!this.active || generation !== this.generation || video.readyState < 2 || !video.videoWidth) return;
      const canvas = thumbnailFromVideo(video);
      this.previewFrames.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.48), capturedAt: Date.now() });
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

function makeContactSheets(frames: TimedFrame[], now: number, maxSheets: number) {
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
    return sheet.toDataURL("image/jpeg", 0.68);
  });
}

function supportedMimeType() {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
