"use client";

import { useState } from "react";
import { Play, Timer } from "@phosphor-icons/react";
import { DELIVERY_MODE_NAMES, examplesFor } from "./usage-examples/usage-examples";
import type { DeliveryMode } from "./usage-examples/usage-examples";
import { ModeQuickGuide } from "./mode-quick-guide";
import styles from "./mode-guide.module.css";

// Shown before screen sharing starts: one tab per delivery mode, each
// saying when to use it and how it works.

type Mode = { id: DeliveryMode; name: string; tagline: string; when: string[]; how: string[] };

const MODES: Mode[] = [
  {
    id: "manual",
    name: "Manual",
    tagline: "보낼 화면을 내가 직접 고릅니다",
    when: [
      "AI가 만든 결과를 검토할 때마다 캡처 도구를 꺼내 일일이 찍기 귀찮고, 막상 찍으려니 방금 본 화면이 다시 안 나와 답답할 때",
      "이미지 첨부가 되는 AI를 쓸 때",
      "개인정보가 섞여 있어 보낼 화면을 직접 골라야 할 때",
    ],
    how: [
      "화면 공유를 켜면 최근 화면이 이 기기 메모리에만 계속 쌓입니다. 오래된 화면은 자동으로 지워집니다.",
      "화면이 크게 바뀐 순간이 대표 화면으로 먼저 보이고, … 를 펼치면 그 사이 화면이 원본 해상도로 나옵니다.",
      "필요한 부분만 잘라 AI 입력창에 끌어다 놓으면 끝입니다. 서버에는 아무것도 올라가지 않습니다.",
    ],
  },
  {
    id: "link",
    name: "Agent Link",
    tagline: "URL 하나로 AI와 팀에게 전달합니다",
    when: [
      "여러 장면을 순서대로 봐야 이해되는 버그일 때",
      "링크를 열어 읽을 수 있는 AI 에이전트를 쓸 때",
      "팀원 여러 명에게 내가 본 화면을 그대로 보여주고 싶을 때",
    ],
    how: [
      "최근 구간의 대표 화면(원본 해상도), 화면 변화 기록, 상황 요약 문서를 비공개 저장소에 올립니다.",
      "정한 시간(5분~1시간, 기본 20분) 또는 삭제할 때까지 열리는 링크가 만들어지고, 링크를 연 사람과 AI는 같은 화면을 시간순으로 봅니다.",
      "시간이 지나면 자동으로 만료되고, 내 링크 목록에서 언제든 직접 삭제할 수 있습니다.",
    ],
  },
  {
    id: "folder",
    name: "Local Folder",
    tagline: "내 PC 폴더에 저장해 로컬 에이전트가 읽습니다",
    when: [
      "Claude Code·Codex·Cursor처럼 내 컴퓨터 파일을 읽는 에이전트를 쓸 때",
      "화면을 외부 서버에 올리고 싶지 않을 때",
      "기록을 남겨 두고 여러 번 다시 참고하고 싶을 때",
    ],
    how: [
      "처음 한 번 저장할 폴더를 허용하면, 그 안에 Context-날짜 폴더가 만들어집니다.",
      "상황 요약(context.md), 화면 변화 기록(events.json), 캡처 이미지, 녹화 조각이 함께 저장됩니다.",
      "실제 경로가 들어간 프롬프트를 복사해 에이전트에 붙여넣으면, 에이전트가 그 폴더를 찾아 읽습니다.",
    ],
  },
];

export function ModeGuide({ onShowExamples }: { onShowExamples: (mode: DeliveryMode) => void }) {
  const [active, setActive] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const mode = MODES[active];
  return <section className={styles.guide} aria-label="전달 방식 안내">
    <div className={styles.tabs} role="tablist" aria-label="전달 방식">
      {MODES.map((item, index) => <button key={item.id} type="button" role="tab" id={`mode-tab-${item.id}`}
        aria-selected={index === active} aria-controls={`mode-panel-${item.id}`} tabIndex={index === active ? 0 : -1}
        onClick={() => setActive(index)}
        onKeyDown={(event) => {
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          const next = (active + step + MODES.length) % MODES.length;
          setActive(next);
          document.getElementById(`mode-tab-${MODES[next].id}`)?.focus();
        }}>
        <b>{index + 1}</b>{item.name}
      </button>)}
    </div>
    <div key={mode.id} className={styles.panel} role="tabpanel" id={`mode-panel-${mode.id}`} aria-labelledby={`mode-tab-${mode.id}`}>
      <h2>{mode.tagline}</h2>
      <h3>이럴 때 쓰세요</h3>
      <ul className={styles.when}>{mode.when.map((line) => <li key={line}>{line}</li>)}</ul>
      <h3>작동 방식</h3>
      <ol>{mode.how.map((line, index) => <li key={line}><b>{String(index + 1).padStart(2, "0")}</b>{line}</li>)}</ol>
      <button type="button" className={styles.quickGuide} onClick={() => setQuickOpen(true)}>
        <Timer size={14} weight="bold" />
        <span><b>{mode.name} 10초 사용법</b><small>버튼을 어떤 순서로 누르는지 영상으로 보기</small></span>
      </button>
      <button type="button" className={styles.examples} onClick={() => onShowExamples(mode.id)}>
        <Play size={14} weight="fill" />
        <span><b>{DELIVERY_MODE_NAMES[mode.id]} 실제 활용 예시 보기</b><small>{examplesFor(mode.id).map((example) => example.role).join(" · ")}</small></span>
      </button>
    </div>
    {quickOpen && <ModeQuickGuide mode={mode.id} onClose={() => setQuickOpen(false)} />}
  </section>;
}
