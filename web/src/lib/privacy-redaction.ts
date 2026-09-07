import type { NormalizedBox, OverviewFrame } from "./replay-buffer";

export type SensitiveCategory = "API 키" | "인증 토큰" | "이메일" | "전화번호" | "카드번호" | "비밀번호" | "사용자 지정";
export type PrivacyReport = {
  enabled: boolean; scannedFrames: number; maskedFrames: number; maskedRegions: number;
  categories: string[]; preview?: { beforeUrl: string; afterUrl: string };
};

type OcrLine = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrBlock = { paragraphs?: { lines?: OcrLine[] }[] };
type OcrWorker = {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(image: string, options?: object, output?: { text?: boolean; blocks?: boolean }): Promise<{ data: { blocks: OcrBlock[] | null } }>;
  terminate(): Promise<unknown>;
};

const PATTERNS: Array<[SensitiveCategory, RegExp]> = [
  ["API 키", /\b(?:sk-(?:proj-)?[a-z0-9_-]{8,}|akia[a-z0-9]{12,}|(?:api[_ -]?key)\s*[:=]\s*["']?[a-z0-9_-]{8,})\b/i],
  ["인증 토큰", /\b(?:bearer\s+[a-z0-9._~+/=-]{8,}|gh[pousr]_[a-z0-9]{12,}|(?:access[_ -]?token|secret)\s*[:=]\s*["']?[a-z0-9._~+/=-]{8,})\b/i],
  ["이메일", /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/i],
  ["전화번호", /(?:^|\D)(?:(?:\+?82[- .]?)?10|01[016789])[- .]?\d{3,4}[- .]?\d{4}(?:\D|$)/],
  ["비밀번호", /(?:password|passwd|비밀번호|암호)\s*[:=]\s*(?!\*{3,}|•{3,})\S{4,}/i],
];

function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let index = digits.length - 1, alternate = false; index >= 0; index -= 1, alternate = !alternate) {
    let digit = Number(digits[index]);
    if (alternate) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function sensitiveCategory(text: string): SensitiveCategory | null {
  for (const [category, pattern] of PATTERNS) if (pattern.test(text)) return category;
  return passesLuhn(text) ? "카드번호" : null;
}

export function sensitiveLineRegions(lines: OcrLine[], width: number, height: number): { box: NormalizedBox; category: SensitiveCategory }[] {
  return lines.flatMap((line) => {
    const category = sensitiveCategory(line.text);
    if (!category) return [];
    const padding = 6;
    return [{ category, box: [
      Math.max(0, (line.bbox.x0 - padding) / width), Math.max(0, (line.bbox.y0 - padding) / height),
      Math.min(1, (line.bbox.x1 + padding) / width), Math.min(1, (line.bbox.y1 + padding) / height),
    ] as NormalizedBox }];
  });
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function createPrivacyRedactor(onProgress?: (message: string) => void) {
  let workerPromise: Promise<OcrWorker> | undefined;
  const getWorker = () => workerPromise ??= (async () => {
    onProgress?.("로컬 OCR 엔진을 준비하고 있습니다.");
    const tesseract = await import("tesseract.js");
    const worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
      logger: ({ status, progress }) => onProgress?.(`${status} ${Math.round(progress * 100)}%`),
    }) as unknown as OcrWorker;
    await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT });
    return worker;
  })();

  return {
    async redact(frame: OverviewFrame, manualBox?: NormalizedBox): Promise<{ url: string; regions: { box: NormalizedBox; category: string }[] }> {
      const image = await loadImage(frame.url);
      const hinted = frame.privacyHints ?? [];
      let automatic: { box: NormalizedBox; category: string }[] = [];
      if (!hinted.length) {
        onProgress?.("화면 안의 민감정보를 기기에서 찾고 있습니다.");
        const worker = await getWorker();
        const { data } = await worker.recognize(frame.url, {}, { text: true, blocks: true });
        const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []);
        automatic = sensitiveLineRegions(lines, image.naturalWidth, image.naturalHeight);
      }
      const regions = [...hinted, ...automatic, ...(manualBox ? [{ box: manualBox, category: "사용자 지정" }] : [])];
      if (!regions.length) return { url: frame.url, regions };
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      for (const { box } of regions) {
        const x = Math.floor(box[0] * canvas.width), y = Math.floor(box[1] * canvas.height);
        const width = Math.ceil((box[2] - box[0]) * canvas.width), height = Math.ceil((box[3] - box[1]) * canvas.height);
        context.fillStyle = "#111210"; context.fillRect(x, y, width, height);
        if (width > 54 && height > 14) {
          context.fillStyle = "#b1cd9a"; context.font = `600 ${Math.max(10, Math.min(16, height * 0.34))}px ui-sans-serif, sans-serif`;
          context.fillText("PRIVATE", x + 6, y + Math.min(height - 4, 17));
        }
      }
      return { url: canvas.toDataURL("image/jpeg", 0.82), regions };
    },
    async close() { if (workerPromise) await (await workerPromise).terminate(); },
  };
}
