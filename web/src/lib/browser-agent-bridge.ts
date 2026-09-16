export type BrowserAgentBridge = {
  list(token: string): { name: string; type: string; size: number }[];
  read(token: string, name: string): File;
  url(token: string, name: string): string;
};

declare global {
  interface Window { whatwasContext?: BrowserAgentBridge }
}

export function publishBrowserAgentContext(files: File[], pageUrl: string, seconds: number) {
  const token = crypto.randomUUID();
  const entries = new Map(files.map((file) => [file.name, file]));
  const urls = new Map<string, string>();
  const check = (given: string) => {
    if (given !== token || window.whatwasContext !== bridge) throw new Error("브라우저 화면 기록 접근이 종료되었습니다.");
  };
  const bridge: BrowserAgentBridge = {
    list(given) { check(given); return files.map(({ name, type, size }) => ({ name, type, size })); },
    read(given, name) { check(given); const file = entries.get(name); if (!file) throw new Error("화면 기록 파일이 없습니다."); return file; },
    url(given, name) {
      const file = bridge.read(given, name);
      if (!urls.has(name)) urls.set(name, URL.createObjectURL(file));
      return urls.get(name)!;
    },
  };
  window.whatwasContext = bridge;
  return {
    prompt: `현재 열린 브라우저 탭 ${pageUrl}의 최근 ${seconds}초 화면 기록을 직접 살펴봐 주세요. 탭에서 JavaScript를 실행해 const ctx = window.whatwasContext; const key = ${JSON.stringify(token)}; ctx.list(key)로 자료 목록을 확인하고, await ctx.read(key, "context.md").text()와 await ctx.read(key, "events.json").text()를 먼저 읽으세요. captures/의 이미지는 ctx.url(key, 파일명)으로 얻은 주소를 새 탭에서 열어 살펴보고, 필요하면 recording/의 영상도 같은 방식으로 보세요. 원래 기록 탭은 열어 두세요.`,
    close() {
      if (window.whatwasContext === bridge) delete window.whatwasContext;
      for (const url of urls.values()) URL.revokeObjectURL(url);
    },
  };
}
