export type ReplaySegment = { blob: Blob; startedAt: number; durationMs: number };

const SEGMENT_MS = 1_000;
const MAX_BYTES = 250 * 1024 * 1024;

export class BrowserReplayBuffer {
  private segments: ReplaySegment[] = [];
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
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
    this.recordNext(generation);
  }

  stop() {
    this.active = false;
    this.generation += 1;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.recorder = null;
    this.stream = null;
    this.segments = [];
  }

  status() {
    const bytes = this.segments.reduce((total, segment) => total + segment.blob.size, 0);
    const durationMs = this.segments.reduce((total, segment) => total + segment.durationMs, 0);
    return { bytes, durationMs, segmentCount: this.segments.length };
  }

  async recentFrames(seconds: number, count = 6): Promise<string[]> {
    const cutoff = Date.now() - seconds * 1_000;
    const recent = this.segments.filter((segment) => segment.startedAt + segment.durationMs >= cutoff);
    if (!recent.length) return [];
    const chosen = evenlySpaced(recent, Math.min(count, recent.length));
    return Promise.all(chosen.map((segment) => frameFromBlob(segment.blob)));
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

async function frameFromBlob(blob: Blob): Promise<string> {
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
    if (video.duration && Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.04);
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); window.setTimeout(resolve, 180); });
    return frameFromVideo(video);
  } finally { URL.revokeObjectURL(url); }
}

function supportedMimeType() {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
