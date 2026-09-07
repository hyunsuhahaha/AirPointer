type TextWorker = {
  recognize(image: string): Promise<{ data: { text?: string } }>;
  terminate(): Promise<unknown>;
};

let workerPromise: Promise<TextWorker> | undefined;
let queue = Promise.resolve();

async function worker(): Promise<TextWorker> {
  return workerPromise ??= (async () => {
    const tesseract = await import("tesseract.js");
    return await tesseract.createWorker("eng") as unknown as TextWorker;
  })();
}

export function recognizeScreenText(imageUrl: string): Promise<string> {
  let resolveResult!: (text: string) => void;
  const result = new Promise<string>((resolve) => { resolveResult = resolve; });
  queue = queue.then(async () => {
    try {
      const { data } = await (await worker()).recognize(imageUrl);
      resolveResult((data.text ?? "").replace(/\s+/g, " ").trim().slice(0, 12_000));
    } catch {
      resolveResult("");
    }
  });
  return result;
}

export async function closeScreenOcr(): Promise<void> {
  if (!workerPromise) return;
  await (await workerPromise).terminate();
  workerPromise = undefined;
}
