"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { InteractiveReplay } from "@/lib/interactive-replay";
import type { RecordedScene } from "@/lib/interactive-replay";
import type { NormalizedBox } from "@/lib/replay-buffer";
import styles from "./interactive-case.module.css";

type Method = "card" | "wallet" | "bank";
type Phase = "idle" | "processing" | "alert" | "settled";
type Order = { id: string; name: string; item: string; price: number; initials: string };
const orders: Order[] = [
  { id: "10428", name: "김민아", item: "Trail Runner / Sand", price: 148000, initials: "MA" },
  { id: "10429", name: "이준호", item: "Daypack / Graphite", price: 89000, initials: "JH" },
  { id: "10430", name: "박서연", item: "Shell Jacket / Moss", price: 219000, initials: "SY" },
];
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const outcomes = {
  card: { code: "AUTH_TIMEOUT", title: "카드 본인 인증 시간이 초과됐습니다", detail: "승인 금액 0원 · 고객의 인증 상태를 먼저 확인하세요." },
  wallet: { code: "WALLET_LIMIT", title: "간편결제의 1회 결제 한도를 초과했습니다", detail: "승인 금액 0원 · 결제 한도 또는 다른 수단을 확인하세요." },
  bank: { code: "PAYMENT_APPROVED", title: "계좌 결제가 정상 승인됐습니다", detail: "주문 결제가 완료됐습니다. 추가 결제를 요청하지 마세요." },
};
type Hit = { key: string; label: string; x: number; y: number; w: number; h: number; disabled?: boolean; pressed?: boolean; action: () => void };

export function InteractiveCase({ onFreeze, onExit }: { onFreeze: (replay: InteractiveReplay, question: string) => void; onExit: () => void }) {
  const [orderIndex, setOrderIndex] = useState(0);
  const [method, setMethod] = useState<Method>("card");
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [compact, setCompact] = useState(false);
  const [question, setQuestion] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [focus, setFocus] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const history = useRef<RecordedScene[]>([]);
  const started = useRef(0);
  const frozen = useRef(false);
  const recordedSize = useRef("");
  const width = compact ? 640 : 1200;
  const height = compact ? 900 : 760;
  const order = orders[orderIndex];
  const busy = phase === "processing" || phase === "alert";
  const locked = phase !== "idle";
  const selectedX = compact ? 26 : 380;
  const selectedW = compact ? 588 : 790;
  const detailY = compact ? 355 : 135;
  const paymentY = compact ? 655 : 445;
  const alertBox: NormalizedBox = compact ? [0.04, 0.70, 0.96, 0.95] : [0.36, 0.50, 0.95, 0.77];

  useEffect(() => {
    const observer = new ResizeObserver(entries => setCompact(entries[0].contentRect.width < 650));
    if (viewport.current) observer.observe(viewport.current);
    started.current = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (phase !== "processing" && phase !== "alert") return;
    // These are payment response/notification timers, not a pre-rendered movie.
    const timer = window.setTimeout(() => setPhase(phase === "processing" ? "alert" : "settled"), phase === "processing" ? 1400 : 650);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const hits: Hit[] = [
    ...orders.map((item, index) => ({ key: `order-${index}`, label: `주문 ${item.id} ${item.name} 선택`, x: 26, y: (compact ? 115 : 145) + index * (compact ? 65 : 110), w: compact ? 588 : 310, h: compact ? 56 : 94, disabled: locked, pressed: orderIndex === index, action: () => setOrderIndex(index) })),
    { key: "minus", label: "수량 줄이기", x: selectedX + selectedW - 184, y: detailY + 185, w: 44, h: 42, disabled: locked || quantity === 1, action: () => setQuantity(q => q - 1) },
    { key: "plus", label: "수량 늘리기", x: selectedX + selectedW - 76, y: detailY + 185, w: 44, h: 42, disabled: locked || quantity === 3, action: () => setQuantity(q => q + 1) },
    ...(["card", "wallet", "bank"] as Method[]).map((value, index) => ({ key: value, label: { card: "카드 결제", wallet: "간편결제", bank: "계좌 결제" }[value], x: selectedX + index * (selectedW / 3), y: paymentY, w: selectedW / 3 - 8, h: 58, disabled: locked, pressed: method === value, action: () => setMethod(value) })),
    { key: "pay", label: "결제 요청", x: selectedX, y: paymentY + 95, w: selectedW, h: 64, disabled: locked, action: () => setPhase("processing") },
  ];

  useLayoutEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !canvas.current) return;
    const rect = (x: number, y: number, w: number, h: number, fill: string, border?: string) => {
      context.fillStyle = fill; context.fillRect(x, y, w, h);
      if (border) { context.strokeStyle = border; context.lineWidth = 1; context.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    };
    const text = (value: string, x: number, y: number, size = 16, color = "#283b38", weight = 400) => {
      context.fillStyle = color; context.font = `${weight} ${size}px "Noto Sans KR", sans-serif`; context.fillText(value, x, y);
    };
    rect(0, 0, width, height, "#f1f0e9");
    rect(0, 0, width, 76, "#183f38");
    text("N /", 26, 48, 28, "#d6edb0", 700); text("NORTHSTAR", 83, 46, 21, "#f4f3e9", 700);
    text("주문 운영", compact ? 425 : 1060, 45, 16, "#c4d7ce");
    text("결제 대기 주문", 26, compact ? 102 : 119, 17, "#60716a", 600);
    orders.forEach((item, i) => {
      const y = (compact ? 115 : 145) + i * (compact ? 65 : 110);
      rect(26, y, compact ? 588 : 310, compact ? 56 : 94, orderIndex === i ? "#e1e8da" : "#f8f7f1", orderIndex === i ? "#42634d" : "#d7dad0");
      text(`#${item.id}`, 44, y + 30, 17, "#243c32", 700);
      text(item.name, compact ? 185 : 235, y + 30, 15);
      if (!compact) text(item.item, 44, y + 66, 14, "#6b766e");
      else text(money(item.price), 435, y + 32, 16, "#5b6d62");
    });
    rect(selectedX, detailY, selectedW, 270, "#fffef9", "#d7dad0");
    text(`ORDER / ${order.id}`, selectedX + 26, detailY + 40, 14, "#738173", 600);
    text(`${order.name}님의 주문`, selectedX + 26, detailY + 82, 28, "#213b31", 700);
    text(phase === "settled" && method === "bank" ? "결제 완료" : phase === "processing" ? "승인 요청 중" : "결제 대기", selectedX + selectedW - 128, detailY + 40, 15, "#537152", 600);
    rect(selectedX + 26, detailY + 113, selectedW - 52, 1, "#e2e4d9");
    text(order.item, selectedX + 26, detailY + 150, compact ? 20 : 23, "#263c32", 600);
    text(money(order.price * quantity), selectedX + 26, detailY + 214, 28, "#213b31", 700);
    rect(selectedX + selectedW - 184, detailY + 185, 152, 42, "#f4f5ed", "#d2d9cd");
    text("−", selectedX + selectedW - 170, detailY + 213, 23);
    text(String(quantity), selectedX + selectedW - 119, detailY + 213, 21);
    text("+", selectedX + selectedW - 64, detailY + 213, 23);
    text("결제 수단", selectedX, paymentY - 17, 15, "#647361", 600);
    (["card", "wallet", "bank"] as Method[]).forEach((value, i) => {
      const x = selectedX + i * selectedW / 3;
      rect(x, paymentY, selectedW / 3 - 8, 58, method === value ? "#e1e8da" : "#fafaf3", method === value ? "#42634d" : "#d7dad0");
      text({ card: "카드", wallet: "간편결제", bank: "계좌" }[value], x + 24, paymentY + 37, 18, "#263c32", method === value ? 700 : 400);
      if (method === value) text("✓", x + selectedW / 3 - 42, paymentY + 37, 18, "#41623d", 700);
    });
    rect(selectedX, paymentY + 95, selectedW, 64, locked ? "#52685d" : "#183f38");
    text(phase === "processing" ? "승인 요청 중…" : phase === "settled" ? "요청 처리됨" : `${money(order.price * quantity)} 결제 요청 →`, selectedX + 24, paymentY + 136, 21, "#f4f3e9", 600);
    text("샘플 상점 · 실제 금액은 청구되지 않습니다", selectedX, paymentY + 192, 14, "#6f7d6f");
    if (phase === "alert") {
      const [l, t, r, b] = alertBox; const x = l * width, y = t * height;
      rect(x + 7, y + 9, (r - l) * width, (b - t) * height, "#b9bbad");
      rect(x, y, (r - l) * width, (b - t) * height, method === "bank" ? "#e9f1d8" : "#fff2df", method === "bank" ? "#739044" : "#b5663a");
      text(outcomes[method].code, x + 22, y + 37, 16, "#97623a", 700);
      text(outcomes[method].title, x + 22, y + 81, compact ? 22 : 23, "#382e25", 700);
      text(`주문 #${order.id} · 요청 ${money(order.price * quantity)}`, x + 22, y + 119, 18, "#665341");
      text(outcomes[method].detail, x + 22, y + 160, compact ? 15 : 17, "#665341");
    }
    // Capture the exact same canvas pixels the user saw, at each actual state transition.
    if (!frozen.current) {
      if (recordedSize.current !== `${width}x${height}`) { history.current = []; recordedSize.current = `${width}x${height}`; }
      const now = Date.now();
      const shot = { url: canvas.current.toDataURL("image/jpeg", .88), at: now, focusBox: phase === "alert" ? alertBox : undefined };
      const records = history.current;
      records.push(shot);
      // Keep a bounded 60-second history and the last state before the boundary.
      while (records.length > 1 && (records[1].at < now - 60_000 || records.length > 180)) records.shift();
    }
    // The capture depends on actual visual state, never the UI elapsed counter/focus ring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, orderIndex, method, quantity, phase]);

  const freeze = () => {
    if (!history.current.length || busy) return;
    frozen.current = true;
    const replay = new InteractiveReplay(history.current, Date.now(), width, height);
    onFreeze(replay, question.trim() || "방금 잠깐 나타난 결제 알림을 찾아줘. 어떤 주문에서 무슨 일이 있었고 다음에 뭘 확인해야 해?");
  };

  return <section className={styles.case} aria-label="직접 조작하는 결제 운영 체험">
    <header className={styles.top}><div><span>CASE 01 / COMMERCE</span><h2>오늘의 주문, 직접 처리해 보세요.</h2><p>주문과 결제 수단을 고르고 결제를 요청하세요. 잠깐 나타나는 알림을 놓쳐도 괜찮아요.</p></div><button onClick={onExit}>체험 나가기 ↗</button></header>
    <div className={styles.layout}>
      <div className={styles.screenArea}>
        <div className={styles.browserBar}><span><i /><i /><i /></span><b>northstar.demo / orders</b><small>INTERACTIVE SANDBOX</small></div>
        <div ref={viewport} className={styles.canvasWrap}>
          <canvas ref={canvas} width={width} height={height} aria-label={`주문 ${order.id}, ${order.name}, ${quantity}개, ${money(order.price * quantity)}, ${phase === "settled" ? "처리 완료" : "결제 대기"}`} />
          {hits.map(hit => <button key={hit.key} className={styles.hit} aria-label={hit.label} aria-pressed={hit.pressed} disabled={hit.disabled} onClick={hit.action} onFocus={() => setFocus(hit.key)} onBlur={() => setFocus("")} data-focused={focus === hit.key} style={{ left: `${hit.x / width * 100}%`, top: `${hit.y / height * 100}%`, width: `${hit.w / width * 100}%`, height: `${hit.h / height * 100}%` }} />)}
        </div>
        <div className={styles.recording}><span><i /> LOCAL REPLAY</span><b>{Math.min(60, elapsed).toFixed(1)}s</b><small>조작한 화면이 이 탭에만 쌓이고 있어요</small></div>
      </div>
      <aside className={styles.guide}>
        <span className={styles.eyebrow}>YOUR MISSION</span><h3>놓친 순간까지<br />기억할 필요 없어요.</h3>
        <ol><li data-active={phase === "idle"}><b>01</b><div>주문을 골라보세요<small>수량과 결제 수단도 바꿀 수 있어요.</small></div></li><li data-active={busy}><b>02</b><div>결제를 요청하세요<small>응답 알림은 잠깐 나타났다 사라져요.</small></div></li><li data-active={phase === "settled"}><b>03</b><div>AI와 다시 찾아보세요<small>실제로 조작한 화면에서 단서를 찾습니다.</small></div></li></ol>
        <div className={styles.receipt} aria-live="polite"><small>현재 선택</small><strong>#{order.id} · {order.name}</strong><span>{quantity}개 · {money(order.price * quantity)}</span><b>{phase === "processing" ? "결제 응답을 기다리는 중" : phase === "alert" ? "알림 도착" : phase === "settled" ? "알림이 사라졌어요. 무슨 내용이었을까요?" : "결제를 요청하면 체험이 이어집니다."}</b></div>
        <label className={styles.question}>AI에게 물어보기<textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="방금 알림이 뭐였고, 어떻게 처리해야 해?" maxLength={500} /></label>
        <button className={styles.find} disabled={phase !== "settled"} onClick={freeze}>방금 알림 찾아줘 <span>↶</span></button>
        <p className={styles.footnote}>샘플 상점의 실제 조작 기록을 분석합니다.<br />외부 결제·계정 연결은 없습니다.</p>
      </aside>
    </div>
  </section>;
}
