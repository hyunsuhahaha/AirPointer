import type { NormalizedBox, OverviewFrame } from "./replay-buffer";

export const DEMO_OVERVIEW_OFFSETS = [-60, -30, -12, -8, -4, -0.05];
export const DEMO_INCIDENT_CUE_SECONDS = 3;
export type DemoScenarioId = "worktree" | "migration" | "test";
export type DemoFrameState = "editing" | "building" | "error" | "failed";
export type DemoScenario = { id: DemoScenarioId; label: string; title: string; detail: string; question: string; accent: string; focusBox: NormalizedBox; video: string; proof: string };

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  { id: "worktree", label: "Worktree 혼선", title: "고쳤는데 미리보기는 그대로", detail: "편집 중인 체크아웃과 서버 실행 경로가 다른 상황", question: "코드를 고쳤는데 왜 미리보기에는 반영되지 않았어? 화면에 나온 경로를 근거로 알려줘.", accent: "#d97941", focusBox: [0.22, 0.65, 0.99, 0.98], video: "/demo-recordings/worktree-mismatch.webm", proof: "실제 Node 서버 실행 · 두 작업 폴더" },
  { id: "migration", label: "DB 마이그레이션", title: "코드는 새 컬럼을 찾는데 DB에는 없다", detail: "SQLite 스키마와 적용되지 않은 마이그레이션의 불일치", question: "방금 실행이 왜 실패했어? 보이는 코드와 오류를 연결해서 다음 조치를 알려줘.", accent: "#8fb36b", focusBox: [0.22, 0.64, 0.99, 0.98], video: "/demo-recordings/missing-migration.webm", proof: "실제 Python · SQLite 실행" },
  { id: "test", label: "테스트 회귀", title: "소수점이 사라진 가격", detail: "실제 Node 테스트가 구현 변경 때문에 실패하는 상황", question: "테스트가 왜 12와 12.99로 어긋났어? 원인이 되는 구현을 찾아줘.", accent: "#7aa2f7", focusBox: [0.22, 0.64, 0.99, 0.98], video: "/demo-recordings/test-regression.webm", proof: "실제 node:test 실행" },
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
  if (scenarioId === "worktree" || scenarioId === "test") runtimeScreen(draw, state, scenario);
  else inventoryScreen(draw, state, scenario);
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

function inventoryScreen(draw: Draw, state: DemoFrameState, scenario: DemoScenario) {
  shell(draw, "Warehouse Forecast", "September inventory", scenario.accent); draw.rect(0, 54, 1440, 72, "#f4f6f3"); draw.rect(0, 126, 1440, 774, "#ffffff");
  [70, 330, 550, 760, 970, 1160, 1350].forEach((x) => draw.line(x, 126, x, 900, "#d9ded8")); for (let y = 126; y < 900; y += 58) draw.line(0, y, 1440, y, "#d9ded8");
  ["SKU", "PRODUCT", "ON HAND", "RESERVED", "AVAILABLE", "REORDER"].forEach((value, index) => draw.text(value, [90, 350, 570, 780, 990, 1180][index], 164, 13, "#526158", 700, "Arial, sans-serif"));
  const products = [["A-104", "Travel mug", "122", "18", "104", "80"], ["B-208", "Canvas tote", "64", "12", "52", "60"], ["C-311", "Desk lamp", "41", "9", state === "failed" ? "#REF!" : "32", "35"], ["D-420", "Notebook set", "208", "31", "177", "120"], ["E-512", "USB hub", "73", "24", "49", "55"]];
  products.forEach((row, r) => row.forEach((value, c) => draw.text(value, [90, 350, 590, 800, 1010, 1200][c], 222 + r * 58, 16, value === "#REF!" ? "#c84b3b" : "#2f3430", value === "#REF!" ? 700 : 500, "Arial, sans-serif"))); draw.rect(970, 300, 190, 58, "#e9f3e7"); draw.stroke(970, 300, 190, 58, scenario.accent, 2); draw.text(state === "building" ? "Calculating..." : state === "failed" ? "#REF!" : "32", 1010, 338, 17, state === "failed" ? "#c84b3b" : "#2f3430", 700, "Arial, sans-serif"); draw.text("H42", 20, 338, 13, "#657068", 600); draw.text("Finance access: ops-team@example.com", 90, 850, 14, "#69716b");
  if (state === "error") alert(draw, scenario, "FORMULA WARNING", "Circular dependency detected in H42", "Formula: =SUM(H12:H42)", "Change the range to end before the total row");
}

function privacyHints(id: DemoScenarioId): OverviewFrame["privacyHints"] {
  void id;
  return [];
}
