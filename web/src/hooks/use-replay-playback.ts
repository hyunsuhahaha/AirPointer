"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { BrowserReplayBuffer, ReplaySegment } from "@/lib/replay-buffer";

// Scrubbing back through the local rolling buffer like a video player.
// `at` is the wall-clock moment on screen (null = live). While dragging only
// the stored thumbnail nearest to `at` is shown; on release the one-second
// segment holding `at` is loaded into its own <video>, and while playing each
// following segment is chained in until playback catches up with live.
export function useReplayPlayback(buffer: RefObject<BrowserReplayBuffer>, enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const segmentRef = useRef<ReplaySegment | null>(null);
  const urlRef = useRef("");
  const loadToken = useRef(0);
  const playingRef = useRef(false);
  const [at, setAt] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [playing, setPlaying] = useState(false);

  const releaseSegment = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    segmentRef.current = null;
  }, []);

  const setPlayingState = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  }, []);

  const goLive = useCallback(() => {
    loadToken.current += 1;
    const video = videoRef.current;
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    releaseSegment();
    setPlayingState(false);
    setAt(null);
    setPreviewUrl("");
  }, [releaseSegment, setPlayingState]);

  const load = useCallback((target: number, autoplay: boolean) => {
    const video = videoRef.current;
    const segment = buffer.current.segmentAt(target);
    if (!video || !segment) { goLive(); return; }
    const token = ++loadToken.current;
    const offsetRatio = Math.min(1, Math.max(0, (target - segment.startedAt) / segment.durationMs));
    const start = () => {
      if (token !== loadToken.current) return;
      // MediaRecorder segments usually report an infinite duration; the
      // recorded wall-clock length is the fallback, as in framesFromBlob.
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : segment.durationMs / 1_000;
      video.currentTime = Math.min(duration * offsetRatio, Math.max(0, duration - 0.02));
      if (autoplay) void video.play().catch(() => undefined);
      else video.pause();
    };
    if (segmentRef.current === segment && video.readyState >= 1) { start(); return; }
    releaseSegment();
    segmentRef.current = segment;
    // Swapping src blanks the element until the new segment decodes; the
    // stored thumbnail for that moment covers the gap instead of black.
    video.poster = buffer.current.previewAt(target) ?? "";
    urlRef.current = URL.createObjectURL(segment.blob);
    video.addEventListener("loadedmetadata", start, { once: true });
    video.src = urlRef.current;
  }, [buffer, goLive, releaseSegment]);

  // Dragging: cheap thumbnail only, the segment loads on release.
  const scrub = useCallback((target: number) => {
    videoRef.current?.pause();
    setAt(target);
    setPreviewUrl(buffer.current.previewAt(target) ?? "");
  }, [buffer]);

  const seek = useCallback((target: number, fromLive = false) => {
    if (fromLive) setPlayingState(true);
    setAt(target);
    setPreviewUrl("");
    load(target, playingRef.current);
  }, [load, setPlayingState]);

  const play = useCallback(() => {
    setPlayingState(true);
    const video = videoRef.current;
    if (video && segmentRef.current) void video.play().catch(() => undefined);
    else if (at !== null) load(at, true);
  }, [at, load, setPlayingState]);

  const pause = useCallback(() => {
    setPlayingState(false);
    videoRef.current?.pause();
  }, [setPlayingState]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const segment = segmentRef.current;
      if (segment) setAt(segment.startedAt + Math.min(video.currentTime * 1_000, segment.durationMs));
    };
    const onEnded = () => {
      const segment = segmentRef.current;
      const next = segment ? buffer.current.segmentAfter(segment) : null;
      if (!next) { goLive(); return; }
      setAt(next.startedAt);
      load(next.startedAt, playingRef.current);
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnded);
    return () => { video.removeEventListener("timeupdate", onTime); video.removeEventListener("ended", onEnded); };
  }, [buffer, goLive, load]);

  useEffect(() => {
    if (enabled) return;
    const timer = window.setTimeout(goLive, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, goLive]);
  useEffect(() => releaseSegment, [releaseSegment]);

  return { videoRef, at, previewUrl, playing, scrub, seek, play, pause, goLive };
}
