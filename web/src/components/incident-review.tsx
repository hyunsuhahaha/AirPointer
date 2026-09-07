"use client";
import { ReplayCinema } from "./replay-cinema";
import { useState } from "react";
import type { EvidenceItem, ExplorationProgress } from "./browser-capture-panel";
import type { OverviewFrame } from "@/lib/replay-buffer";
import { reportHtml, reportText } from "@/lib/incident-report";
import type { Incident } from "@/lib/incident-report";
import styles from "./incident-review.module.css";

export function IncidentReview({ frames, evidence, answer, incident, context, sample, exploration, onEvidence }: {
  frames: OverviewFrame[]; evidence: EvidenceItem[]; answer: string; incident?: Incident; context: string; sample: boolean; exploration?: ExplorationProgress; onEvidence: (index: number) => void;
}) {
  const [activeEvidence, setActiveEvidence] = useState<number | null>(null);
  const [sequence, setSequence] = useState(0);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const selectedEvidence = Math.max(0, Math.min(activeEvidence ?? Math.max(0, evidence.findIndex(item => item.focusBox || item.frame.focusBox)), evidence.length - 1));
  const report = { answer, incident, context, sample, evidence: evidence.filter((_, i) => !excluded.includes(i)).map(e => ({ claim: e.claim, image: e.frame.url, seconds: e.frame.atSeconds })) };
  return <section className={styles.review} aria-label="리플레이 사건 작업대">
    <ReplayCinema frames={frames} evidence={evidence} activeEvidence={selectedEvidence} sequence={sequence} exploration={exploration} onOpenEvidence={onEvidence} />
    <aside className={styles.card}>
      <div className={styles.heading}><span>INCIDENT RECORD</span><b>{sample ? "샘플" : "공유 화면"}</b></div>
      <h2>{incident?.title || (answer ? "방금 일어난 일" : "놓친 순간을 찾고 있습니다")}</h2>
      {answer ? <>
        <p className={styles.answer}>{answer}</p>
        {incident && <><h3>확인된 사실</h3><ul>{incident.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul><h3>가능한 원인 <span>추정</span></h3><p>{incident.possibleCause}</p><h3>다음 확인</h3><ol>{incident.nextChecks.map((check, i) => <li key={i}>{check}</li>)}</ol></>}
        <h3>화면 근거 <span>{evidence.length}개</span></h3>
        {!evidence.length && <p>확인된 화면 근거가 없습니다. 추가 화면을 분석해 주세요.</p>}
        {evidence.map((item, i) => <div className={styles.evidence} key={i}><label><input type="checkbox" checked={!excluded.includes(i)} onChange={() => setExcluded(old => old.includes(i) ? old.filter(n => n !== i) : [...old, i])} aria-label={`${i + 1}번째 근거 보고서에 포함`} /></label><button aria-pressed={selectedEvidence === i} onClick={() => { setActiveEvidence(i); setSequence(v => v + 1); }}><small>−{item.frame.atSeconds.toFixed(2)}초 · 이 순간으로 되감기 ↶</small>{item.claim}</button></div>)}
        <p className={styles.hint}>선택한 근거 이미지가 보고서에 포함됩니다. 저장 전에 내용을 확인하세요.</p>
        <div className={styles.actions}><button onClick={async () => { try { await navigator.clipboard.writeText(reportText(report)); setNotice("사건 기록을 복사했습니다."); } catch { setNotice("복사할 수 없습니다. 보고서 다운로드를 이용해 주세요."); } }}>텍스트 복사</button><button onClick={() => { const url = URL.createObjectURL(new Blob([reportHtml(report)], { type: "text/html;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "incident-report.html"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("선택한 근거를 포함한 보고서를 다운로드했습니다."); }}>보고서 다운로드 ↓</button></div>
        <p role="status" className={styles.hint}>{notice}</p>
        {context && <details><summary>분석 범위·전송 정보</summary><pre>{context}</pre></details>}
      </> : <p>AI가 실제로 조회한 장면과 근거를 차례로 표시합니다. 분석이 끝나면 사건 기록을 저장할 수 있습니다.</p>}
    </aside>
  </section>;
}
