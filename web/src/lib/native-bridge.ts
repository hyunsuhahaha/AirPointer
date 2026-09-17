// What the desktop app (desktop/src/preload.ts) exposes as window.whatwasNative.
// In a plain browser it is absent and every feature falls back to the web way.

export type NativeWindowEntry = { at: number; app: string; title: string };
export type NativeFileSave = { at: number; path: string };
export type NativeActivity = { windows: NativeWindowEntry[]; fileSaves: NativeFileSave[] };
export type NativeSettings = { exportDir: string; watchDir: string | null; shortcut: string };

export type WhatwasNative = {
  version: number;
  // Tells the app the page is listening; it answers with "whatwas-native-ready".
  pageReady(): Promise<void>;
  settings(): Promise<NativeSettings>;
  chooseExportDir(): Promise<string | null>;
  chooseWatchDir(): Promise<string | null>;
  activity(since: number, until: number): Promise<NativeActivity>;
  writeContext(name: string, files: { path: string; data: Uint8Array }[]): Promise<string>;
  reveal(target: string): Promise<void>;
  onExportShortcut(listener: () => void): () => void;
};

declare global {
  interface Window { whatwasNative?: WhatwasNative }
}

export const nativeApp = (): WhatwasNative | undefined => typeof window === "undefined" ? undefined : window.whatwasNative;

export const shortcutLabel = (accelerator: string) => accelerator.replace("CommandOrControl", "Ctrl").replaceAll("+", " + ");

export function nativeFolderPrompt(folderPath: string) {
  return `로컬 파일시스템의 "${folderPath}" 폴더를 열어 주세요. context.md와 events.json을 읽은 뒤 captures/preview 폴더의 화면을 시간순으로 확인해서 제가 무엇을 하고 있었는지 파악해 주세요. events.json의 activity에는 그때 앞에 있던 프로그램과 창 제목, 작업 폴더에서 저장된 파일이 시각과 함께 들어 있으니 화면 변화와 맞춰 봐 주세요.`;
}

// The context.md section for what the desktop app saw on this PC.
export function activityMarkdown(activity: NativeActivity, since: number) {
  const time = (at: number) => new Date(Math.max(at, since)).toISOString();
  const windows = activity.windows.map((entry) => `- ${time(entry.at)} · ${entry.app || "알 수 없는 프로그램"} — ${entry.title || "(제목 없음)"}`);
  const saves = activity.fileSaves.map((entry) => `- ${new Date(entry.at).toISOString()} · ${entry.path}`);
  return `## 작업 기록 (데스크톱 앱)\n\n### 앞에 있던 창\n\n${windows.join("\n") || "- 기록 없음"}\n\n### 저장된 파일\n\n${saves.join("\n") || "- 기록 없음 (작업 폴더를 지정하면 기록됩니다)"}\n`;
}
