"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";
import { Archive, BookmarkSimple, Brain, Bug, Check, ClockCounterClockwise, Copy, Database, DownloadSimple, FileText, MagnifyingGlass, Play, Plus, Tag, Trash, TrendUp } from "@phosphor-icons/react";
import { demoFrameAtOffset } from "@/lib/demo-replay";
import {
  buildDeveloperReport, deleteScreenMemoryFrame, listScreenMemoryFrames, listScreenMemoryReports,
  saveScreenMemoryFrame, saveScreenMemoryReport, screenMemorySummary, subscribeScreenMemory,
  updateScreenMemoryFrame,
} from "@/lib/screen-memory";
import type { ScreenMemoryFrame, ScreenMemoryReport, ScreenMemorySummary } from "@/lib/screen-memory";
import styles from "./screen-memory-workbench.module.css";

type View = "search" | "timeline" | "bookmarks" | "summary" | "reports" | "agent";
const FEATURES: Array<{ id: View; title: string; detail: string; Icon: typeof MagnifyingGlass }> = [
  { id: "search", title: "화면 검색", detail: "보였던 문구를 다시 찾기", Icon: MagnifyingGlass },
  { id: "timeline", title: "시간여행", detail: "기록을 DVR처럼 훑기", Icon: ClockCounterClockwise },
  { id: "bookmarks", title: "북마크·태그", detail: "중요 장면을 영구 보관", Icon: BookmarkSimple },
  { id: "summary", title: "활동 요약", detail: "작업 흐름과 오류 집계", Icon: TrendUp },
  { id: "reports", title: "개발 리포트", detail: "재현 기록을 Markdown으로", Icon: FileText },
  { id: "agent", title: "Agent API", detail: "Codex가 기록을 직접 검색", Icon: Database },
];

async function syncCompanionMemory(token: string, endpoint: "frame" | "delete" | "report", payload: object) {
  if (!token) return;
  try {
    await fetch(`/api/companion/memory?token=${encodeURIComponent(token)}&endpoint=${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch {
    // Browser-only mode remains fully functional when the native bridge is off.
  }
}

export function ScreenMemoryWorkbench({ recording, companionConnected, companionToken, onAddToReplay }: {
  recording: boolean;
  companionConnected: boolean;
  companionToken: string;
  onAddToReplay: (frame: ScreenMemoryFrame) => void;
}) {
  const [view, setView] = useState<View>("search");
  const [frames, setFrames] = useState<ScreenMemoryFrame[]>([]);
  const [reports, setReports] = useState<ScreenMemoryReport[]>([]);
  const [summary, setSummary] = useState<ScreenMemorySummary | null>(null);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<"10m" | "1h" | "all">("1h");
  const [selectedId, setSelectedId] = useState("");
  const [copied, setCopied] = useState("");
  const [autoReport, setAutoReport] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("airpointer-auto-dev-report") === "true");
  const [message, setMessage] = useState("");

  const rangeStart = useCallback(() => range === "10m" ? Date.now() - 600_000 : range === "1h" ? Date.now() - 3_600_000 : 0, [range]);
  const refresh = useCallback(async () => {
    const from = rangeStart();
    const [nextFrames, nextReports, nextSummary] = await Promise.all([
      listScreenMemoryFrames({ query, from, limit: 180 }), listScreenMemoryReports(), screenMemorySummary(from),
    ]);
    setFrames(nextFrames); setReports(nextReports); setSummary(nextSummary);
    setSelectedId((current) => nextFrames.some((frame) => frame.id === current) ? current : nextFrames[0]?.id ?? "");
  }, [query, rangeStart]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeScreenMemory(() => void refresh());
    return () => { window.clearTimeout(initialRefresh); unsubscribe(); };
  }, [refresh]);
  useEffect(() => {
    if (!autoReport) return;
    const run = async () => {
      const last = Number(window.localStorage.getItem("airpointer-last-auto-report") || 0);
      if (Date.now() - last < 30 * 60_000) return;
      const reportFrames = await listScreenMemoryFrames({ from: Date.now() - 30 * 60_000, limit: 180 });
      if (!reportFrames.length) return;
      const to = Date.now(), start = to - 30 * 60_000;
      const saved = await saveScreenMemoryReport({ from: start, to, title: "자동 개발 리포트", markdown: buildDeveloperReport(reportFrames, start, to, "자동 개발 리포트"), automatic: true });
      await syncCompanionMemory(companionToken, "report", saved);
      window.localStorage.setItem("airpointer-last-auto-report", String(to));
    };
    void run();
    const timer = window.setInterval(() => void run(), 60_000);
    return () => window.clearInterval(timer);
  }, [autoReport, companionToken]);

  const selected = frames.find((frame) => frame.id === selectedId) ?? null;

  const seedDemo = async () => {
    setMessage("샘플 개발 기록을 준비하고 있습니다.");
    const now = Date.now();
    const samples = [
      { offset: -420, text: "localhost dashboard build started", note: "개발 서버 시작", tags: ["build"] },
      { offset: -330, text: "TypeError Cannot read properties of undefined at ResultsPanel.tsx:84", note: "순간 오류", tags: ["error", "frontend"] },
      { offset: -260, text: "payment request failed 500 checkout api", note: "API 실패 확인", tags: ["error", "api"] },
      { offset: -180, text: "inventory form validation quantity required", note: "검증 화면", tags: ["form"] },
      { offset: -90, text: "tests 24 passed build compiled successfully", note: "수정 후 검증", tags: ["test"] },
      { offset: -20, text: "deployment preview ready", note: "배포 준비", tags: ["deploy"] },
    ];
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const image = demoFrameAtOffset(index % 2 ? "worktree" : "migration", index % 2 ? -6 : -5.5, "queried-frame", now + sample.offset * 1_000);
      await saveScreenMemoryFrame({ capturedAt: now + sample.offset * 1_000, imageUrl: image.url, text: sample.text, source: "demo", surface: "browser", width: 1440, height: 900, bookmarked: index === 1 || index === 2, note: sample.note, tags: sample.tags });
    }
    setMessage("샘플 기록을 넣었습니다. 검색과 시간여행을 바로 눌러보세요.");
  };

  const makeReport = async () => {
    const from = rangeStart();
    const reportFrames = await listScreenMemoryFrames({ from, limit: 180 });
    if (!reportFrames.length) { setMessage("리포트로 만들 화면 기록이 없습니다."); return; }
    const to = Date.now();
    const saved = await saveScreenMemoryReport({ from, to, title: "개발 화면 리포트", markdown: buildDeveloperReport(reportFrames, from, to, "개발 화면 리포트"), automatic: false });
    await syncCompanionMemory(companionToken, "report", saved);
    setView("reports"); setMessage("Markdown 개발 리포트를 만들었습니다.");
  };

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(""), 1_500);
  };
  const download = (report: ScreenMemoryReport) => {
    const url = URL.createObjectURL(new Blob([report.markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `airpointer-report-${new Date(report.createdAt).toISOString().slice(0, 10)}.md`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <section className={styles.workbench} id="memory" aria-labelledby="memory-title">
    <header className={styles.heading}>
      <div><p>LOCAL SCREEN MEMORY</p><h2 id="memory-title">화면을 찾고, 되감고, 기록합니다.</h2><span>공유 화면은 브라우저 안에 저장되고 OCR 검색됩니다. AI 전송은 사용자가 요청할 때만 일어납니다.</span></div>
      <div className={styles.recordingState} data-active={recording}><i />{recording ? "실제 화면 기록 중" : "화면 공유 대기"}</div>
    </header>

    <nav className={styles.featureNav} aria-label="화면 기억 기능">
      {FEATURES.map(({ id, title, detail, Icon }) => <button key={id} type="button" data-active={view === id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><Icon size={19} weight={view === id ? "fill" : "regular"} /><span><b>{title}</b><small>{detail}</small></span></button>)}
    </nav>

    <div className={styles.toolbar}>
      <div className={styles.range} aria-label="기록 범위"><span>조회 범위</span>{(["10m", "1h", "all"] as const).map((value) => <button type="button" key={value} data-active={range === value} onClick={() => setRange(value)}>{value === "10m" ? "최근 10분" : value === "1h" ? "최근 1시간" : "전체"}</button>)}</div>
      <div className={styles.metrics}><span><b>{summary?.frameCount ?? 0}</b> 기록</span><span><b>{summary?.bookmarkCount ?? 0}</b> 북마크</span><span><b>{summary?.activeMinutes ?? 0}</b> 활동분</span></div>
    </div>

    {!frames.length && view !== "agent" && view !== "reports" ? <div className={styles.empty}>
      <Archive size={34} /><h3>{query && (summary?.frameCount ?? 0) > 0 ? `“${query}”와 일치하는 화면이 없습니다.` : "아직 저장된 화면 기록이 없습니다."}</h3><p>{query && (summary?.frameCount ?? 0) > 0 ? "다른 오류 문구나 파일명으로 검색하거나 조회 범위를 넓혀보세요." : "위에서 화면 공유를 시작하면 변화 장면이 자동으로 쌓입니다. 설치 없이 기능을 확인하려면 샘플 기록을 넣어보세요."}</p>{query && (summary?.frameCount ?? 0) > 0 ? <button type="button" onClick={() => setQuery("")}><MagnifyingGlass size={16} />전체 기록 보기</button> : <button type="button" onClick={() => void seedDemo()}><Play size={16} weight="fill" />샘플 개발 기록으로 체험</button>}
    </div> : null}

    {frames.length > 0 && view === "search" && <div className={styles.searchView}>
      <label className={styles.searchBox}><MagnifyingGlass size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="화면에서 봤던 오류, 파일명, 버튼 문구 검색" /><kbd>OCR</kbd></label>
      <p className={styles.resultCount}>{query ? `“${query}” 검색 결과 ${frames.length}개` : `최근 화면 기록 ${frames.length}개`}</p>
      <div className={styles.resultGrid}>{frames.map((frame) => <MemoryCard key={frame.id} frame={frame} selected={selectedId === frame.id} onSelect={() => setSelectedId(frame.id)} onBookmark={async () => { const bookmarked = !frame.bookmarked; await updateScreenMemoryFrame(frame.id, { bookmarked }); await syncCompanionMemory(companionToken, "frame", { id: frame.id, bookmarked }); }} />)}</div>
    </div>}

    {frames.length > 0 && view === "timeline" && <Timeline frames={frames} selectedId={selectedId} onSelect={setSelectedId} onBookmark={async (frame) => { await updateScreenMemoryFrame(frame.id, { bookmarked: true }); await syncCompanionMemory(companionToken, "frame", { id: frame.id, bookmarked: true }); onAddToReplay(frame); setMessage("이 시점을 영구 북마크하고 다음 리플레이에도 추가했습니다."); }} />}

    {frames.length > 0 && view === "bookmarks" && <div className={styles.bookmarkView}>
      <div className={styles.bookmarkList}>{frames.filter((frame) => frame.bookmarked).map((frame) => <button type="button" key={frame.id} data-active={selectedId === frame.id} onClick={() => setSelectedId(frame.id)}><img src={frame.imageUrl} alt="북마크 화면" /><span><b>{frame.note || "이름 없는 북마크"}</b><small>{new Date(frame.capturedAt).toLocaleString("ko-KR")}</small></span></button>)}</div>
      {selected?.bookmarked ? <BookmarkEditor key={selected.id} frame={selected} companionToken={companionToken} onAddToReplay={onAddToReplay} onMessage={setMessage} /> : <div className={styles.noBookmarks}><BookmarkSimple size={30} /><p>북마크가 없습니다. 검색이나 시간여행에서 중요한 화면을 북마크하세요.</p></div>}
    </div>}

    {view === "summary" && summary && <div className={styles.summaryView}>
      <div className={styles.summaryHero}><Brain size={28} weight="fill" /><span><small>선택 기간 활동</small><strong>{summary.activeMinutes}분</strong></span><p>{summary.frameCount}개 변화 화면 중 {summary.bookmarkCount}개를 중요 장면으로 표시했습니다.</p></div>
      <div className={styles.summaryBlocks}><section><h3>기록 구성</h3>{summary.sources.length ? summary.sources.map(({ source, count }) => <div key={source}><span>{source === "timeline" ? "자동 변화 기록" : source === "bookmark" ? "북마크" : source === "capture" ? "AI 전송 화면" : "시연 기록"}</span><b>{count}</b></div>) : <p>기록 없음</p>}</section><section><h3>자주 쓴 태그</h3><div className={styles.tagCloud}>{summary.topTags.length ? summary.topTags.map(({ tag, count }) => <span key={tag}><Tag size={11} />{tag}<b>{count}</b></span>) : <p>북마크에 태그를 추가하면 집계됩니다.</p>}</div></section><section><h3>다음 행동</h3><button type="button" onClick={() => void makeReport()}><Bug size={15} />이 활동으로 개발 리포트 만들기</button></section></div>
    </div>}

    {view === "reports" && <div className={styles.reportView}>
      <header><div><h3>재현 가능한 Markdown 리포트</h3><p>북마크, OCR 오류 후보, 시각과 태그를 한 파일로 정리합니다.</p></div><button type="button" className={styles.primary} onClick={() => void makeReport()}><FileText size={16} />지금 리포트 만들기</button></header>
      <label className={styles.autoToggle}><input type="checkbox" checked={autoReport} onChange={(event) => { setAutoReport(event.target.checked); window.localStorage.setItem("airpointer-auto-dev-report", String(event.target.checked)); }} /><span /><b>30분마다 자동 리포트</b><small>이 페이지가 열려 있는 동안 새 기록이 있으면 자동 생성</small></label>
      {reports.length ? <div className={styles.reportList}>{reports.map((report) => <article key={report.id}><div><span>{report.automatic ? "AUTO" : "MANUAL"}</span><h4>{report.title}</h4><small>{new Date(report.createdAt).toLocaleString("ko-KR")}</small></div><pre>{report.markdown}</pre><footer><button type="button" onClick={() => void copy(report.markdown, report.id)}>{copied === report.id ? <Check size={14} /> : <Copy size={14} />}{copied === report.id ? "복사됨" : "Markdown 복사"}</button><button type="button" onClick={() => download(report)}><DownloadSimple size={14} />파일 다운로드</button></footer></article>)}</div> : <div className={styles.noBookmarks}><FileText size={30} /><p>생성된 리포트가 없습니다. 현재 기록으로 첫 리포트를 만들어보세요.</p></div>}
    </div>}

    {view === "agent" && <div className={styles.agentView}>
      <section className={styles.agentStatus} data-connected={companionConnected}><Database size={28} weight="fill" /><div><small>FULL ACCESS MEMORY BRIDGE</small><h3>{companionConnected ? "로컬 API 연결됨" : "AirPointer를 켜면 Agent 검색이 활성화됩니다"}</h3><p>브라우저 기록은 IndexedDB에 남고, Full Access에서는 SQLite와 MCP를 통해 Codex가 직접 검색합니다.</p></div><span>{companionConnected ? "CONNECTED" : "OFFLINE"}</span></section>
      <div className={styles.agentCommands}><div><span>로컬 검색 API</span><code>http://127.0.0.1:47822/memory/search</code><button type="button" onClick={() => void copy("http://127.0.0.1:47822/memory/search", "api")}>{copied === "api" ? <Check /> : <Copy />}</button></div><div><span>Codex MCP 실행</span><code>python -m airpointer.mcp_server</code><button type="button" onClick={() => void copy("python -m airpointer.mcp_server", "mcp")}>{copied === "mcp" ? <Check /> : <Copy />}</button></div></div>
      <ol className={styles.agentSteps}><li><b>1</b><span><strong>AirPointer 실행</strong><small>Full Access에서 로컬 메모리 브리지를 켭니다.</small></span></li><li><b>2</b><span><strong>MCP 연결</strong><small>위 명령을 Codex MCP 서버로 등록합니다.</small></span></li><li><b>3</b><span><strong>자연어로 검색</strong><small>“지난 1시간 TypeError 화면 찾아줘”처럼 요청합니다.</small></span></li></ol>
    </div>}

    {message && <div className={styles.toast} role="status"><Check size={14} />{message}<button type="button" onClick={() => setMessage("")}>닫기</button></div>}
  </section>;
}

function MemoryCard({ frame, selected, onSelect, onBookmark }: { frame: ScreenMemoryFrame; selected: boolean; onSelect: () => void; onBookmark: () => void }) {
  return <article className={styles.memoryCard} data-selected={selected}><button type="button" className={styles.memoryPreview} onClick={onSelect}><img src={frame.imageUrl} alt={`${new Date(frame.capturedAt).toLocaleTimeString("ko-KR")} 화면 기록`} /><span>{frame.source === "demo" ? "SAMPLE" : frame.source.toUpperCase()}</span></button><div><time>{new Date(frame.capturedAt).toLocaleString("ko-KR")}</time><p>{frame.note || frame.text || "OCR 처리 대기 중"}</p><footer><div>{frame.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><button type="button" aria-label={frame.bookmarked ? "북마크 해제" : "북마크"} title={frame.bookmarked ? "북마크 해제" : "영구 북마크"} onClick={onBookmark}><BookmarkSimple size={16} weight={frame.bookmarked ? "fill" : "regular"} /></button></footer></div></article>;
}

function BookmarkEditor({ frame, companionToken, onAddToReplay, onMessage }: {
  frame: ScreenMemoryFrame;
  companionToken: string;
  onAddToReplay: (frame: ScreenMemoryFrame) => void;
  onMessage: (message: string) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(frame.note);
  const [tagDraft, setTagDraft] = useState(frame.tags.join(", "));

  const save = async () => {
    const tags = tagDraft.split(",").map((tag) => tag.trim()).filter(Boolean);
    await updateScreenMemoryFrame(frame.id, { note: noteDraft.trim(), tags });
    await syncCompanionMemory(companionToken, "frame", { id: frame.id, note: noteDraft.trim(), tags });
    onMessage("북마크 설명과 태그를 저장했습니다.");
  };

  return <div className={styles.bookmarkEditor}>
    <img src={frame.imageUrl} alt="선택한 북마크" />
    <label><span>북마크 이름</span><input value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="예: 결제 버튼 클릭 직후 오류" /></label>
    <label><span>태그 — 쉼표로 구분</span><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="error, checkout, frontend" /></label>
    <div>
      <button type="button" className={styles.primary} onClick={() => void save()}><Check size={15} />저장</button>
      <button type="button" onClick={() => onAddToReplay(frame)}><Plus size={15} />다음 리플레이에 추가</button>
      <button type="button" className={styles.danger} onClick={async () => { await deleteScreenMemoryFrame(frame.id); await syncCompanionMemory(companionToken, "delete", { id: frame.id }); }}><Trash size={15} />삭제</button>
    </div>
  </div>;
}

function Timeline({ frames, selectedId, onSelect, onBookmark }: { frames: ScreenMemoryFrame[]; selectedId: string; onSelect: (id: string) => void; onBookmark: (frame: ScreenMemoryFrame) => void }) {
  const ordered = [...frames].sort((a, b) => a.capturedAt - b.capturedAt);
  const selectedIndex = Math.max(0, ordered.findIndex((frame) => frame.id === selectedId));
  const frame = ordered[selectedIndex] ?? ordered.at(-1)!;
  return <div className={styles.timelineView}><div className={styles.timelineStage}><img src={frame.imageUrl} alt="시간여행에서 선택한 화면" /><div><span>{new Date(frame.capturedAt).toLocaleString("ko-KR")}</span><strong>{frame.note || frame.text || "화면 기록"}</strong><button type="button" onClick={() => onBookmark(frame)}><BookmarkSimple size={15} weight="fill" />이 시점을 북마크하고 다음 리플레이에 추가</button></div></div><div className={styles.scrubber}><input type="range" min={0} max={Math.max(0, ordered.length - 1)} value={selectedIndex} onChange={(event) => onSelect(ordered[Number(event.target.value)].id)} aria-label="화면 기록 시간 이동" /><div><span>{ordered[0] ? new Date(ordered[0].capturedAt).toLocaleTimeString("ko-KR") : ""}</span><b>{selectedIndex + 1} / {ordered.length}</b><span>{ordered.at(-1) ? new Date(ordered.at(-1)!.capturedAt).toLocaleTimeString("ko-KR") : ""}</span></div></div><div className={styles.filmstrip}>{ordered.map((item, index) => <button type="button" key={item.id} data-active={index === selectedIndex} onClick={() => onSelect(item.id)}><img src={item.imageUrl} alt="" /><span>{item.bookmarked && <BookmarkSimple size={10} weight="fill" />}{new Date(item.capturedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></button>)}</div></div>;
}
