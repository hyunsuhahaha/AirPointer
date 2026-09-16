"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ArrowClockwise, CaretUp, Check, CircleNotch, Copy, DownloadSimple, FolderOpen, LinkSimple, MagnifyingGlassPlus, PaperPlaneTilt, Trash, X } from "@phosphor-icons/react";
import { createAgentLink, deleteAgentLink } from "@/lib/agent-link";
import type { AgentLink } from "@/lib/agent-link";
import { exportAgentContext, exportDemoAgentContext } from "@/lib/browser-agent-export";
import { chooseExportDirectory, localExportPath, localFolderPrompt, savedExportDirectory, writeExportFolder } from "@/lib/export-directory";
import type { WritableDirectory } from "@/lib/export-directory";
import { buildManualTimeline, manualFrameFile } from "@/lib/manual-frame-picker";
import type { ManualFrame, ManualTimeline } from "@/lib/manual-frame-picker";
import type { AgentExportBundle } from "@/lib/browser-agent-export";
import type { BrowserReplayBuffer, ReplayCapsule } from "@/lib/replay-buffer";
import type { InteractiveReplay } from "@/lib/interactive-replay";
import type { DemoScenario } from "@/lib/demo-replay";
import styles from "./agent-export-panel.module.css";

type DeliveryMode = "link" | "folder" | "manual";
type ExportResult = AgentExportBundle & { delivery: DeliveryMode; share?: AgentLink };

export function AgentExportPanel({ bufferRef, demo, active, seconds, bufferMinutes, onBufferMinutesChange, onSecondsChange, surface }: {
  bufferRef: RefObject<BrowserReplayBuffer>; demo?: { replay: InteractiveReplay; scenario: DemoScenario };
  active: boolean; seconds: number; bufferMinutes: number; surface: string;
  onBufferMinutesChange: (minutes: number) => void; onSecondsChange: (seconds: number) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const activeNow = useRef(active);
  const shareToken = useRef("");
  const manualCapsule = useRef<ReplayCapsule | null>(null);
  const manualFrameLoads = useRef<Map<string, Promise<void>>>(new Map());
  const manualHighResCache = useRef<Map<string, string>>(new Map());
  const manualDecodeQueue = useRef<Promise<void>>(Promise.resolve());
  const manualGeneration = useRef(0);
  const [mode, setMode] = useState<DeliveryMode>("link");
  const [exportDirectory, setExportDirectory] = useState<WritableDirectory | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [manualTimeline, setManualTimeline] = useState<ManualTimeline | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(new Set());
  const [loadingGaps, setLoadingGaps] = useState<Set<string>>(new Set());
  const [selectedFrames, setSelectedFrames] = useState<Map<string, ManualFrame>>(new Map());
  const [previewFrame, setPreviewFrame] = useState<ManualFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const demoReplay = demo?.replay;

  useEffect(() => { activeNow.current = active; }, [active]);
  useEffect(() => { void savedExportDirectory().then(setExportDirectory); }, []);
  useEffect(() => {
    if (mode !== "manual" || !active) return;
    const generation = ++manualGeneration.current;
    manualFrameLoads.current.clear(); manualHighResCache.current.clear(); manualDecodeQueue.current = Promise.resolve();
    let cancelled = false;
    void (async () => {
      setManualLoading(true); setManualTimeline(null); setExpandedGaps(new Set()); setLoadingGaps(new Set()); setSelectedFrames(new Map()); setPreviewFrame(null); setError("");
      try {
        const next = await readManualTimeline(bufferRef.current, demoReplay, seconds);
        if (!cancelled && generation === manualGeneration.current) { manualCapsule.current = next.capsule; setManualTimeline(next.timeline); }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "화면 목록을 불러오지 못했습니다.");
      } finally { if (!cancelled) setManualLoading(false); }
    })();
    return () => { cancelled = true; manualGeneration.current += 1; };
  }, [active, bufferRef, demoReplay, mode, seconds]);

  const discardShare = () => {
    if (shareToken.current) void deleteAgentLink(shareToken.current);
    shareToken.current = "";
  };
  const resetResult = () => { discardShare(); setResult(null); setCopied(false); setError(""); };
  const selectMode = (next: DeliveryMode) => {
    resetResult(); setMode(next);
    if (next === "manual") try { panel.current?.ownerDocument.defaultView?.resizeTo(520, 560); } catch { /* Browser owns PiP sizing. */ }
  };

  const doExport = async () => {
    if (!active || busy || mode === "manual") return;
    setError(""); setCopied(false); setBusy(true);
    try {
      const directory = mode === "folder" ? await chooseExportDirectory(exportDirectory) : null;
      if (directory) setExportDirectory(directory);
      const next = demo ? await exportDemoAgentContext(demo.replay, demo.scenario, "complete", seconds)
        : await exportAgentContext(bufferRef.current, "complete", seconds, surface);
      if (!activeNow.current) throw new Error("화면 공유가 끝나 Context를 만들지 않았습니다.");
      discardShare();
      let share: AgentLink | undefined;
      if (mode === "link") {
        share = await createAgentLink(next.files, seconds);
        shareToken.current = share.token;
        next.fileName = "Agent Link";
        next.prompt = `최근 ${seconds}초 화면 기록을 확인해서 제가 무엇을 하고 있었는지 파악해 주세요.\n\n${share.url}`;
      } else {
        await writeExportFolder(directory!, next.fileName, next.files);
        next.prompt = localFolderPrompt(directory!.name, next.fileName);
        next.fileName = localExportPath(directory!.name, next.fileName);
      }
      setResult({ ...next, delivery: mode, share });
      try { panel.current?.ownerDocument.defaultView?.resizeTo(390, 470); } catch { /* Browser owns PiP sizing. */ }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "내보내기에 실패했습니다.");
    } finally { setBusy(false); }
  };

  const prompt = result?.prompt ?? "";
  const copyPrompt = async () => {
    try { await copyText(prompt, panel.current?.ownerDocument ?? document); setCopied(true); setError(""); }
    catch { setError("프롬프트를 복사하지 못했습니다. 아래 내용을 직접 선택해 복사해 주세요."); }
  };
  const removeLink = async () => {
    if (!result?.share) return;
    try { await deleteAgentLink(result.share.token); shareToken.current = ""; setResult(null); setCopied(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Agent Link를 삭제하지 못했습니다."); }
  };
  const changeBuffer = (minutes: number) => { resetResult(); onBufferMinutesChange(minutes); };
  const changeWindow = (nextSeconds: number) => { resetResult(); onSecondsChange(nextSeconds); };
  const prepareManualFrame = useCallback((frame: ManualFrame) => {
    const capsule = manualCapsule.current;
    if (frame.highResolution || !capsule) return Promise.resolve();
    const existing = manualFrameLoads.current.get(frame.id);
    if (existing) return existing;
    const generation = manualGeneration.current;
    const decode = manualDecodeQueue.current.catch(() => undefined).then(async () => {
      const [decoded] = await bufferRef.current.framesAtOffsets(capsule, [(frame.capturedAt - capsule.triggeredAt) / 1_000]);
      if (!decoded || generation !== manualGeneration.current || manualCapsule.current !== capsule) return;
      const upgraded = { ...frame, url: decoded.url, highResolution: true };
      manualHighResCache.current.delete(frame.id);
      manualHighResCache.current.set(frame.id, decoded.url);
      const evictedId = manualHighResCache.current.size > 24 ? manualHighResCache.current.keys().next().value as string | undefined : undefined;
      if (evictedId) manualHighResCache.current.delete(evictedId);
      const updateFrame = (current: ManualFrame) => {
        if (current.id === frame.id) return upgraded;
        if (current.id === evictedId) return { ...current, url: current.previewUrl, highResolution: false };
        return current;
      };
      setManualTimeline((current) => current ? { ...current, gaps: current.gaps.map((gap) => ({ ...gap, frames: gap.frames.map(updateFrame) })) } : current);
      setSelectedFrames((current) => {
        if (!current.has(frame.id) && (!evictedId || !current.has(evictedId))) return current;
        const next = new Map(current);
        if (next.has(frame.id)) next.set(frame.id, upgraded);
        if (evictedId && next.has(evictedId)) {
          const evicted = next.get(evictedId)!;
          next.set(evictedId, { ...evicted, url: evicted.previewUrl, highResolution: false });
        }
        return next;
      });
      setPreviewFrame((current) => current?.id === frame.id ? upgraded
        : evictedId && current?.id === evictedId ? { ...current, url: current.previewUrl, highResolution: false } : current);
    });
    manualDecodeQueue.current = decode.catch(() => undefined);
    const completed = decode.catch(() => undefined).then(() => undefined);
    manualFrameLoads.current.set(frame.id, completed);
    void completed.finally(() => {
      if (generation === manualGeneration.current && manualFrameLoads.current.get(frame.id) === completed) manualFrameLoads.current.delete(frame.id);
    });
    return completed;
  }, [bufferRef]);
  const toggleGap = (id: string, firstFrame?: ManualFrame) => {
    const opening = !expandedGaps.has(id);
    setExpandedGaps((current) => {
      const next = new Set(current);
      if (opening) next.add(id); else next.delete(id);
      return next;
    });
    if (!opening) {
      setLoadingGaps((current) => { const next = new Set(current); next.delete(id); return next; });
      return;
    }
    if (!firstFrame || firstFrame.highResolution) return;
    setLoadingGaps((current) => new Set(current).add(id));
    void prepareManualFrame(firstFrame).finally(() => {
      setLoadingGaps((current) => { const next = new Set(current); next.delete(id); return next; });
    });
  };
  const toggleFrame = (frame: ManualFrame) => setSelectedFrames((current) => {
    const next = new Map(current); if (next.has(frame.id)) next.delete(frame.id); else next.set(frame.id, frame); return next;
  });
  const refreshManual = async () => {
    if (manualLoading) return;
    const generation = ++manualGeneration.current;
    manualFrameLoads.current.clear(); manualHighResCache.current.clear(); manualDecodeQueue.current = Promise.resolve();
    setManualLoading(true); setError("");
    try {
      const next = await readManualTimeline(bufferRef.current, demoReplay, seconds);
      if (generation === manualGeneration.current) {
        manualCapsule.current = next.capsule; setManualTimeline(next.timeline); setExpandedGaps(new Set()); setLoadingGaps(new Set()); setSelectedFrames(new Map()); setPreviewFrame(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "화면 목록을 불러오지 못했습니다.");
    } finally { setManualLoading(false); }
  };
  const downloadSelected = () => {
    for (const frame of [...selectedFrames.values()].sort((left, right) => left.capturedAt - right.capturedAt)) {
      const file = manualFrameFile(frame); download(file, file.name);
    }
  };
  const windows = [...new Set([5, 15, 30, 60, 180, 300, seconds])].filter((value) => value <= bufferMinutes * 60 && (!demo || value <= Math.ceil(demo.replay.seconds))).sort((left, right) => left - right);
  const ExportIcon = mode === "link" ? LinkSimple : FolderOpen;

  return <main ref={panel} className={styles.panel} aria-label="AI 맥락 내보내기">
    <header>
      <div className={styles.headerControls}>
        <label>버퍼 길이<select aria-label="버퍼 길이" value={bufferMinutes} disabled={busy || Boolean(demo)} onChange={(event) => changeBuffer(Number(event.target.value))}><option value={1}>1분</option><option value={3}>3분</option><option value={5}>5분</option></select></label>
        <label>전송 구간<select aria-label="전송 구간" value={seconds} disabled={busy} onChange={(event) => changeWindow(Number(event.target.value))}>{windows.map((value) => <option key={value} value={value}>{value < 60 ? `${value}초` : `${value / 60}분`}</option>)}</select></label>
      </div>
      <div className={styles.recordingStatus}><span className={styles.dot} data-active={active} /><strong>{active ? "화면 기록 중" : "화면 공유 대기"}</strong></div>
    </header>
    <div className={styles.body}>
      <div className={styles.modeOptions} role="group" aria-label="AI 내보내기 방식">
        <button type="button" aria-pressed={mode === "manual"} disabled={busy} onClick={() => selectMode("manual")}><b>Manual</b><small>화면 직접 선택</small></button>
        <button type="button" aria-pressed={mode === "link"} disabled={busy} onClick={() => selectMode("link")}><b>Agent Link</b><small>URL 하나 전달</small></button>
        <button type="button" aria-pressed={mode === "folder"} disabled={busy} onClick={() => selectMode("folder")}><b>Local Folder</b><small>로컬 Agent가 검색</small></button>
      </div>
      {mode === "folder" && <div className={styles.modeNoteRow}>
        <p className={styles.modeNote}>{exportDirectory ? `저장 위치: …/${exportDirectory.name}` : "저장 위치를 선택해 주세요."}</p>
        <button type="button" className={styles.directoryButton} disabled={busy} onClick={() => void (async () => {
          setBusy(true); setError("");
          try { setExportDirectory(await chooseExportDirectory(null)); setResult(null); setCopied(false); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "폴더를 선택하지 못했습니다."); }
          finally { setBusy(false); }
        })()}><FolderOpen size={12} />폴더 선택</button>
      </div>}
      {mode !== "manual" && <button type="button" className={styles.exportButton} disabled={!active || busy} onClick={() => void doExport()}>{busy ? <CircleNotch className={styles.spin} size={16} /> : <ExportIcon size={17} />}AI Context 생성</button>}
      {mode === "manual" && <ManualPicker timeline={manualTimeline} loading={manualLoading} expandedGaps={expandedGaps} loadingGaps={loadingGaps} selectedFrames={selectedFrames}
        onToggleGap={toggleGap} onToggleFrame={toggleFrame} onPreview={setPreviewFrame} onPrepareFrame={prepareManualFrame} onDownload={downloadSelected} onRefresh={refreshManual} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {result && mode !== "manual" && <section className={styles.result} aria-live="polite">
        <p className={styles.success}><Check size={15} weight="bold" />{result.delivery === "link" ? `링크 준비됨 · ${new Date(result.share!.expiresAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 만료` : result.fileName}</p>
        <p className={styles.steps}>{result.delivery === "link" ? "이 프롬프트만 AI에 붙여넣으세요." : "로컬 파일 접근이 가능한 Agent에 프롬프트를 붙여넣으세요."}</p>
        <label className={styles.prompt}>에이전트에 붙여넣을 프롬프트<textarea readOnly value={prompt} onFocus={(event) => event.currentTarget.select()} /></label>
        <button type="button" className={styles.copyButton} onClick={() => void copyPrompt()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "복사되었습니다" : "프롬프트 복사"}<PaperPlaneTilt size={14} /></button>
        {result.delivery === "link" && <button type="button" className={styles.deleteButton} onClick={() => void removeLink()}><Trash size={13} />링크 삭제</button>}
      </section>}
    </div>
    {previewFrame && <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label="화면 크게 보기" onClick={() => setPreviewFrame(null)}>
      <button type="button" aria-label="크게 보기 닫기" onClick={() => setPreviewFrame(null)}><X size={18} /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={previewFrame.url} alt={`${frameTime(previewFrame)} 화면`} onClick={(event) => event.stopPropagation()} />
      <time>{frameTime(previewFrame)}</time>
    </div>}
  </main>;
}

function ManualPicker({ timeline, loading, expandedGaps, loadingGaps, selectedFrames, onToggleGap, onToggleFrame, onPreview, onPrepareFrame, onDownload, onRefresh }: {
  timeline: ManualTimeline | null; loading: boolean; expandedGaps: Set<string>; loadingGaps: Set<string>; selectedFrames: Map<string, ManualFrame>;
  onToggleGap: (id: string, firstFrame?: ManualFrame) => void; onToggleFrame: (frame: ManualFrame) => void; onPreview: (frame: ManualFrame) => void;
  onPrepareFrame: (frame: ManualFrame) => Promise<void>;
  onDownload: () => void; onRefresh: () => Promise<void>;
}) {
  return <section className={styles.manual} aria-label="로컬 버퍼 화면 선택">
    <div className={styles.manualHeader}><strong>화면 선택</strong><span>선택 {selectedFrames.size}장 <button type="button" aria-label="현재 화면으로 갱신" title="현재 화면으로 갱신" disabled={loading} onClick={() => void onRefresh()}><ArrowClockwise className={loading ? styles.spin : undefined} size={13} /></button></span></div>
    {loading && !timeline && <p className={styles.manualEmpty}><CircleNotch className={styles.spin} size={14} /> 화면을 불러오는 중</p>}
    {timeline && <div className={styles.timeline} aria-label="대표 화면 타임라인">
      {timeline.representatives.map((frame, index) => <div className={styles.timelinePart} key={frame.id}>
        <FrameCard frame={frame} selected={selectedFrames.has(frame.id)} onToggle={onToggleFrame} onPreview={onPreview} onPrepare={onPrepareFrame} />
        {timeline.gaps[index] && <>
          <button type="button" className={styles.gapButton} aria-expanded={expandedGaps.has(timeline.gaps[index].id)} aria-busy={loadingGaps.has(timeline.gaps[index].id)}
            aria-label={expandedGaps.has(timeline.gaps[index].id) ? `${formatGap(timeline.gaps[index].frames)} 사이 화면 접기` : `${formatGap(timeline.gaps[index].frames)} 사이 화면 펼치기`}
            title={expandedGaps.has(timeline.gaps[index].id) ? "사이 화면 접기" : "사이 화면 펼치기"}
            onClick={() => { const gap = timeline.gaps[index]; onToggleGap(gap.id, gap.frames[0]); }}>
            {loadingGaps.has(timeline.gaps[index].id) ? <CircleNotch className={styles.spin} size={14} />
              : expandedGaps.has(timeline.gaps[index].id) ? <CaretUp size={14} weight="bold" /> : <span aria-hidden="true">…</span>}
          </button>
          {expandedGaps.has(timeline.gaps[index].id) && timeline.gaps[index].frames.map((middle) => <FrameCard key={middle.id} frame={middle} selected={selectedFrames.has(middle.id)} onToggle={onToggleFrame} onPreview={onPreview} onPrepare={onPrepareFrame} />)}
        </>}
      </div>)}
    </div>}
    {!loading && timeline && !timeline.representatives.length && <p className={styles.manualEmpty}>표시할 화면이 없습니다.</p>}
    <button type="button" className={styles.downloadSelected} disabled={!selectedFrames.size} onClick={onDownload}><DownloadSimple size={15} />선택한 {selectedFrames.size}장 다운로드</button>
    <small className={styles.dragHint}>화면을 AI 앱이나 브라우저 대화창으로 직접 드래그할 수 있습니다.</small>
  </section>;
}

function FrameCard({ frame, selected, onToggle, onPreview, onPrepare }: {
  frame: ManualFrame; selected: boolean; onToggle: (frame: ManualFrame) => void; onPreview: (frame: ManualFrame) => void; onPrepare: (frame: ManualFrame) => void;
}) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (frame.highResolution || !card.current) return;
    if (!("IntersectionObserver" in window)) { onPrepare(frame); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { onPrepare(frame); observer.disconnect(); }
    }, { rootMargin: "120px" });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [frame, onPrepare]);
  return <article ref={card} className={styles.frameCard} data-representative={frame.representative} data-selected={selected} onPointerEnter={() => onPrepare(frame)} onFocusCapture={() => onPrepare(frame)}>
    <button type="button" className={styles.framePreview} onClick={() => { onPrepare(frame); onPreview(frame); }} aria-label={`${frameTime(frame)} 화면 크게 보기`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frame.url} alt="" /><MagnifyingGlassPlus size={14} />
    </button>
    <button type="button" className={styles.frameSelect} aria-pressed={selected} onClick={() => onToggle(frame)}>{selected ? <Check size={11} weight="bold" /> : null}<span className={styles.srOnly}>{selected ? "선택 해제" : "선택"}</span></button>
    <time>{frameTime(frame)}</time>{frame.representative && <b>대표</b>}
  </article>;
}

function frameTime(frame: ManualFrame) { return new Date(frame.capturedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function formatGap(frames: ManualFrame[]) { return frames.length ? `${frames.length}개` : "비어 있는"; }

async function readManualTimeline(buffer: BrowserReplayBuffer, demoReplay: InteractiveReplay | undefined, seconds: number) {
  if (demoReplay) {
    const cutoff = demoReplay.triggeredAt - Math.min(seconds, demoReplay.seconds) * 1_000;
    const previews = demoReplay.scenes.filter((scene) => scene.at >= cutoff).map((scene) => ({ dataUrl: scene.url, capturedAt: scene.at }));
    const overview = demoReplay.overview().filter((frame) => (frame.capturedAt ?? 0) >= cutoff);
    return { timeline: buildManualTimeline(previews, overview), capsule: null };
  }
  const capsule = await buffer.recentCapsule(seconds, 12);
  if (!capsule.segments.length) throw new Error("내보낼 화면 기록이 없습니다. 화면을 조금 더 기록해 주세요.");
  const { captures } = buffer.exportMetadata(capsule);
  return { timeline: buildManualTimeline(captures, capsule.overviewFrames), capsule };
}

async function copyText(value: string, owner: Document) {
  try { await owner.defaultView!.navigator.clipboard.writeText(value); return; }
  catch {
    const input = owner.createElement("textarea"); input.value = value; input.style.cssText = "position:fixed;opacity:0";
    owner.body.append(input); input.select(); const copied = owner.execCommand("copy"); input.remove();
    if (!copied) throw new Error("copy failed");
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
