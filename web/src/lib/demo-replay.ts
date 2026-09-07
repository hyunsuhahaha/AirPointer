import type { NormalizedBox, OverviewFrame } from "./replay-buffer";

export const DEMO_OVERVIEW_OFFSETS = [-60, -30, -12, -8, -4, -0.05];
export type DemoScenarioId = "runtime" | "payment" | "inventory" | "meeting";
export type DemoFrameState = "editing" | "building" | "error" | "failed";
export type DemoScenario = { id: DemoScenarioId; label: string; title: string; detail: string; question: string; accent: string; focusBox: NormalizedBox };

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  { id: "runtime", label: "개발 오류", title: "사라진 런타임 오류", detail: "빌드 중 0.5초간 나타난 오류의 원인과 수정법", question: "방금 잠깐 뜬 오류가 정확히 뭐였고 어떻게 고쳐?", accent: "#d97941", focusBox: [0.47, 0.25, 0.96, 0.58] },
  { id: "payment", label: "결제 운영", title: "실패한 주문 결제", detail: "잠깐 뜬 결제 실패 사유와 안전한 후속 조치", question: "방금 결제 실패 원인이 뭐였고 이 주문은 어떻게 처리해야 해?", accent: "#7aa2f7", focusBox: [0.47, 0.2, 0.95, 0.5] },
  { id: "inventory", label: "재고 시트", title: "깨진 집계 수식", detail: "사라진 경고에서 문제 셀과 수식 확인", question: "방금 시트에 뜬 경고가 뭐였고 어느 수식을 고쳐야 해?", accent: "#7fba73", focusBox: [0.43, 0.2, 0.94, 0.49] },
  { id: "meeting", label: "화상 회의", title: "중단된 화면 공유", detail: "순간 알림에서 공유 중단 원인과 복구 방법 확인", question: "방금 화면 공유가 왜 끊겼고 다시 공유하려면 뭘 해야 해?", accent: "#b58af0", focusBox: [0.45, 0.2, 0.94, 0.49] },
];

export function demoScenario(id: DemoScenarioId): DemoScenario {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? DEMO_SCENARIOS[0];
}

export function demoFrameState(offsetSeconds: number): DemoFrameState {
  if (offsetSeconds < -8) return "editing";
  if (offsetSeconds < -6.25) return "building";
  if (offsetSeconds <= -5.75) return "error";
  return "failed";
}

export function demoFramesAtOffsets(scenarioId: DemoScenarioId, offsets: number[], kind: OverviewFrame["kind"] = "queried-frame", triggeredAt = Date.now()): OverviewFrame[] {
  return offsets.map((offset) => demoFrameAtOffset(scenarioId, offset, kind, triggeredAt));
}

export function demoFrameAtOffset(scenarioId: DemoScenarioId, offsetSeconds: number, kind: OverviewFrame["kind"] = "queried-frame", triggeredAt = Date.now()): OverviewFrame {
  const offset = Math.max(-60, Math.min(-0.01, offsetSeconds));
  const state = demoFrameState(offset);
  const scenario = demoScenario(scenarioId);
  const canvas = document.createElement("canvas");
  canvas.width = 1440; canvas.height = 900;
  const draw = painter(canvas.getContext("2d")!);
  if (scenarioId === "runtime") runtimeScreen(draw, state, scenario);
  else if (scenarioId === "payment") paymentScreen(draw, state, scenario);
  else if (scenarioId === "inventory") inventoryScreen(draw, state, scenario);
  else meetingScreen(draw, state, scenario);
  draw.text(`${Math.abs(offset).toFixed(2)}s BEFORE TRIGGER`, 1164, 35, 12, "#a9c99a", 700);
  return {
    url: canvas.toDataURL("image/jpeg", 0.9), atSeconds: Math.abs(offset), capturedAt: triggeredAt + offset * 1_000,
    sampleOffsetsSeconds: [Math.abs(offset)], kind, focusBox: state === "error" ? scenario.focusBox : undefined,
    privacyHints: privacyHints(scenarioId),
  };
}

type Draw = ReturnType<typeof painter>;
function painter(ctx: CanvasRenderingContext2D) {
  return {
    rect(x: number, y: number, width: number, height: number, color: string) { ctx.fillStyle = color; ctx.fillRect(x, y, width, height); },
    stroke(x: number, y: number, width: number, height: number, color: string, lineWidth = 1) { ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.strokeRect(x, y, width, height); },
    text(value: string, x: number, y: number, size: number, color: string, weight = 500, family = "ui-monospace, SFMono-Regular, Consolas, monospace") { ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${family}`; ctx.fillText(value, x, y); },
    line(x1: number, y1: number, x2: number, y2: number, color: string) { ctx.beginPath(); ctx.strokeStyle = color; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); },
    circle(x: number, y: number, radius: number, color: string) { ctx.beginPath(); ctx.fillStyle = color; ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); },
  };
}

function shell(draw: Draw, app: string, section: string, accent: string) {
  draw.rect(0, 0, 1440, 900, "#111311"); draw.rect(0, 0, 1440, 54, "#1c1f1c"); draw.circle(25, 27, 6, accent);
  draw.text(app, 40, 35, 16, "#e8e7df", 700); draw.text(section.toUpperCase(), 350, 91, 13, accent, 700);
}

function alert(draw: Draw, scenario: DemoScenario, eyebrow: string, title: string, detail: string, foot: string) {
  const [left, top, right, bottom] = scenario.focusBox; const x = left * 1440; const y = top * 900; const width = (right - left) * 1440; const height = (bottom - top) * 900;
  draw.rect(x, y, width, height, "#281714"); draw.stroke(x, y, width, height, "#ff7058", 3);
  draw.text(eyebrow, x + 38, y + 52, 18, "#ff9a87", 700); draw.text(title, x + 38, y + 105, 24, "#fff2ee", 700);
  draw.text(detail, x + 38, y + 148, 19, "#fff2ee", 700); draw.text(foot, x + 38, y + 205, 16, "#ffb29f");
}

function runtimeScreen(draw: Draw, state: DemoFrameState, scenario: DemoScenario) {
  shell(draw, "Replay Lab", "ResultsPanel.tsx", scenario.accent); draw.rect(0, 54, 70, 846, "#181b18"); draw.rect(70, 54, 255, 846, "#151815"); draw.rect(325, 54, 1115, 582, "#101210"); draw.rect(325, 636, 1115, 264, "#0c0e0c");
  draw.text("EXPLORER", 92, 88, 12, "#8b9188", 700); ["src", "  components", "    ReplayPanel.tsx", "    ResultsPanel.tsx", "  lib", "    replay-buffer.ts", "package.json"].forEach((line, index) => draw.text(line, 92, 126 + index * 32, 14, line.includes("Results") ? "#f1efe7" : "#9ca198"));
  ["export function ResultsPanel({ items }: Props) {", "  const visible = items?.filter(Boolean);", "", "  return (", "    <section className=\"results\">", "      {visible.map((item) => (", "        <ResultRow key={item.id} item={item} />", "      ))}", "    </section>", "  );", "}"].forEach((line, index) => { draw.text(String(78 + index), 350, 140 + index * 38, 13, "#555b55"); draw.text(line, 394, 140 + index * 38, 17, line.includes("map") ? "#f0c674" : "#d8d6cf"); });
  draw.text("TERMINAL", 350, 674, 12, scenario.accent, 700); draw.text("PS C:\\demo\\replay-lab> npm run build", 350, 716, 15, "#d7d6cf");
  draw.text(state === "editing" ? "Ready. 12 files saved." : state === "building" ? "Creating an optimized production build ..." : "Build failed with 1 runtime error.", 350, 756, 15, state === "failed" ? "#ff8f7c" : "#8e958b", state === "failed" ? 700 : 500); draw.text("OPENAI_API_KEY=DEMO_SECRET_4F9K2X8M7Q", 350, 842, 14, "#9ca198");
  if (state === "error") alert(draw, scenario, "UNHANDLED RUNTIME ERROR", "TypeError: Cannot read properties of undefined", "(reading 'map')", "ResultsPanel.tsx:84:22 · visible.map((item) => ...)");
}

function paymentScreen(draw: Draw, state: DemoFrameState, scenario: DemoScenario) {
  shell(draw, "Northstar Commerce", "Orders / #10428", scenario.accent); draw.rect(0, 54, 250, 846, "#171a1e"); draw.rect(250, 54, 1190, 846, "#f2f1ec");
  ["Overview", "Orders", "Payments", "Customers", "Inventory", "Settings"].forEach((item, index) => draw.text(item, 42, 125 + index * 58, 17, item === "Orders" ? "#ffffff" : "#969ba5", item === "Orders" ? 700 : 500, "Arial, sans-serif"));
  draw.text("Order #10428", 310, 130, 30, "#171a1e", 700, "Arial, sans-serif"); draw.text("mina.cho@example.com", 310, 169, 16, "#696b70", 500, "Arial, sans-serif"); draw.rect(310, 205, 1070, 96, "#ffffff");
  draw.text("PAYMENT", 344, 240, 12, "#777b82", 700); draw.text(state === "editing" ? "Ready to charge" : state === "building" ? "Processing payment..." : "Payment pending", 344, 278, 21, state === "failed" ? "#b65342" : "#22252a", 700, "Arial, sans-serif"); draw.text("TOTAL", 1130, 240, 12, "#777b82", 700); draw.text("$428.00", 1130, 278, 24, "#22252a", 700, "Arial, sans-serif");
  ["Trail running shoes", "Performance socks", "Express shipping"].forEach((item, index) => { draw.line(310, 355 + index * 92, 1380, 355 + index * 92, "#d9d8d2"); draw.text(item, 344, 408 + index * 92, 18, "#303238", 600, "Arial, sans-serif"); }); draw.text("CARD ···· 4242", 980, 408, 15, "#666970", 600); draw.text("PaymentIntent pi_3Q8Z8YF2B", 980, 500, 14, "#777b82");
  if (state === "error") alert(draw, scenario, "PAYMENT FAILED", "3-D Secure authentication timed out", "Order #10428 was not charged", "Do not retry automatically · review customer authentication");
}

function inventoryScreen(draw: Draw, state: DemoFrameState, scenario: DemoScenario) {
  shell(draw, "Warehouse Forecast", "September inventory", scenario.accent); draw.rect(0, 54, 1440, 72, "#f4f6f3"); draw.rect(0, 126, 1440, 774, "#ffffff");
  [70, 330, 550, 760, 970, 1160, 1350].forEach((x) => draw.line(x, 126, x, 900, "#d9ded8")); for (let y = 126; y < 900; y += 58) draw.line(0, y, 1440, y, "#d9ded8");
  ["SKU", "PRODUCT", "ON HAND", "RESERVED", "AVAILABLE", "REORDER"].forEach((value, index) => draw.text(value, [90, 350, 570, 780, 990, 1180][index], 164, 13, "#526158", 700, "Arial, sans-serif"));
  const products = [["A-104", "Travel mug", "122", "18", "104", "80"], ["B-208", "Canvas tote", "64", "12", "52", "60"], ["C-311", "Desk lamp", "41", "9", state === "failed" ? "#REF!" : "32", "35"], ["D-420", "Notebook set", "208", "31", "177", "120"], ["E-512", "USB hub", "73", "24", "49", "55"]];
  products.forEach((row, r) => row.forEach((value, c) => draw.text(value, [90, 350, 590, 800, 1010, 1200][c], 222 + r * 58, 16, value === "#REF!" ? "#c84b3b" : "#2f3430", value === "#REF!" ? 700 : 500, "Arial, sans-serif"))); draw.rect(970, 300, 190, 58, "#e9f3e7"); draw.stroke(970, 300, 190, 58, scenario.accent, 2); draw.text(state === "building" ? "Calculating..." : state === "failed" ? "#REF!" : "32", 1010, 338, 17, state === "failed" ? "#c84b3b" : "#2f3430", 700, "Arial, sans-serif"); draw.text("H42", 20, 338, 13, "#657068", 600); draw.text("Finance access: ops-team@example.com", 90, 850, 14, "#69716b");
  if (state === "error") alert(draw, scenario, "FORMULA WARNING", "Circular dependency detected in H42", "Formula: =SUM(H12:H42)", "Change the range to end before the total row");
}

function meetingScreen(draw: Draw, state: DemoFrameState, scenario: DemoScenario) {
  shell(draw, "Meetroom", "Weekly product review", scenario.accent); draw.rect(0, 54, 1440, 846, "#14151a");
  const people = [[60, 100, "Mina"], [520, 100, "Alex"], [980, 100, "Jae"], [60, 470, "Product deck"], [520, 470, "Sora"], [980, 470, "Notes"]] as const;
  people.forEach(([x, y, name], index) => { draw.rect(x, y, 400, 310, index === 3 ? "#e7e7e0" : "#252832"); draw.circle(x + 200, y + 132, 54, ["#9db8e3", "#d9a58f", "#9bc6ae", "#777", "#c2a0d6", "#a7a9b4"][index]); draw.text(name, x + 20, y + 286, 16, index === 3 ? "#24262b" : "#f1f0ec", 700, "Arial, sans-serif"); }); draw.rect(500, 838, 440, 48, "#24262d"); draw.text(state === "editing" ? "You are presenting" : state === "building" ? "Sharing Product-Roadmap.pdf..." : "Screen sharing stopped", 590, 869, 17, state === "failed" ? "#ff907d" : "#dfe2dc", 700, "Arial, sans-serif"); draw.text("Room: product-review · host mina.cho@example.com", 68, 82, 14, "#a4a8b2");
  if (state === "error") alert(draw, scenario, "SCREEN SHARE STOPPED", "Permission revoked by operating system", "Meetroom can no longer capture this window", "Open browser permissions, then choose Share screen again");
}

function privacyHints(id: DemoScenarioId): OverviewFrame["privacyHints"] {
  if (id === "runtime") return [{ box: [0.235, 0.9, 0.66, 0.955], category: "API 키" }];
  if (id === "payment") return [{ box: [0.21, 0.15, 0.43, 0.2], category: "이메일" }, { box: [0.67, 0.42, 0.91, 0.48], category: "결제 정보" }];
  if (id === "inventory") return [{ box: [0.06, 0.91, 0.36, 0.96], category: "이메일" }];
  return [{ box: [0.05, 0.06, 0.36, 0.1], category: "이메일" }];
}
