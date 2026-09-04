import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type CaptureKind = "screenshot" | "region" | "replay";

export type PromptTemplate = {
  wrapperOutro: string;
  defaultRequestByKind: Record<CaptureKind, string>;
  capsuleIntro: string;
  capsuleInstruction: string;
  windowHistoryLabel: string;
};

// The wording Codex actually sees for every capture except the user's own
// typed question -- shared by the browser and the AirPointer.exe companion,
// since both funnel through makePrompt() in the /api/agent route. Editable
// from the browser's prompt-settings dialog; this is just the fallback.
export const DEFAULT_PROMPT_TEMPLATE: PromptTemplate = {
  wrapperOutro: "첨부 화면을 확인하고 위 요청에 답하세요.",
  defaultRequestByKind: {
    screenshot: "화면에서 발생한 문제를 분석해 주세요.",
    region: "이 영역을 중심으로 문제를 분석해 주세요.",
    replay: "화면 변화를 분석해 원인과 해결 방법을 알려 주세요.",
  },
  capsuleIntro: "AirPointer가 사용자가 확정한 질문과, 제스처 시점을 기준으로 최근 {seconds}초 작업 맥락을 Replay Capsule로 보냈습니다.",
  capsuleInstruction: "먼저 첨부된 개요 타임시트를 시간순으로 확인하세요. 개요만 보고 장면이 없다고 결론 내리지 마세요. 필요한 순간이 없거나 더 자세히 봐야 하면 아래 원본 조회 명령으로 정확한 시점의 전체 해상도 프레임을 복원한 뒤 출력된 framePath를 view_image로 여세요.",
  windowHistoryLabel: "최근 활성 창:",
};

const CONFIG_PATH = join(process.cwd(), ".data", "prompt-template.json");

export async function loadPromptTemplate(): Promise<PromptTemplate> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return mergeTemplate(JSON.parse(raw) as Partial<PromptTemplate>);
  } catch {
    return DEFAULT_PROMPT_TEMPLATE;
  }
}

export async function savePromptTemplate(template: PromptTemplate): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(template, null, 2), "utf8");
}

function mergeTemplate(partial: Partial<PromptTemplate>): PromptTemplate {
  return {
    wrapperOutro: partial.wrapperOutro || DEFAULT_PROMPT_TEMPLATE.wrapperOutro,
    defaultRequestByKind: { ...DEFAULT_PROMPT_TEMPLATE.defaultRequestByKind, ...partial.defaultRequestByKind },
    capsuleIntro: partial.capsuleIntro || DEFAULT_PROMPT_TEMPLATE.capsuleIntro,
    capsuleInstruction: partial.capsuleInstruction || DEFAULT_PROMPT_TEMPLATE.capsuleInstruction,
    windowHistoryLabel: partial.windowHistoryLabel || DEFAULT_PROMPT_TEMPLATE.windowHistoryLabel,
  };
}
