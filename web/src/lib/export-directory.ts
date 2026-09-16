const DB = "whatwas-export";
const STORE = "settings";
const KEY = "directory";

export type WritableDirectory = FileSystemDirectoryHandle & {
  queryPermission(options?: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options?: { mode: "readwrite" }): Promise<PermissionState>;
};

export function localExportPath(parentName: string, contextName: string) {
  return `${parentName}/${contextName}`;
}

export function localFolderPrompt(parentName: string, contextName: string) {
  const path = localExportPath(parentName, contextName);
  return `로컬 파일시스템에서 저장 경로가 "${path}"로 끝나는 폴더를 찾아 주세요. context.md와 events.json을 읽은 뒤 captures/preview 폴더의 화면을 시간순으로 확인해서 제가 무엇을 하고 있었는지 파악해 주세요.`;
}

export function savedExportDirectory(): Promise<WritableDirectory | null> {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const request = open.result.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as WritableDirectory | undefined) ?? null);
      request.onerror = () => resolve(null);
    };
  });
}

function rememberDirectory(handle: WritableDirectory) {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      try {
        const request = open.result.transaction(STORE, "readwrite").objectStore(STORE).put(handle, KEY);
        request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      } catch (error) { reject(error); }
    };
  });
}

export async function chooseExportDirectory(saved: WritableDirectory | null) {
  let handle = saved;
  if (handle && await handle.requestPermission({ mode: "readwrite" }) === "granted") return handle;
  const pickerWindow = window.documentPictureInPicture?.window ?? window;
  if (!("showDirectoryPicker" in pickerWindow)) throw new Error("이 브라우저는 로컬 폴더 저장을 지원하지 않습니다.");
  const picker = pickerWindow.showDirectoryPicker as (options: { mode: "readwrite"; startIn: string }) => Promise<FileSystemDirectoryHandle>;
  try { handle = await picker.call(pickerWindow, { mode: "readwrite", startIn: "downloads" }) as WritableDirectory; }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("폴더 선택이 취소되었습니다.");
    throw error;
  }
  await rememberDirectory(handle).catch(() => undefined);
  return handle;
}

// Creates (or reuses) a subfolder of `parent` and makes it the saved export location.
export async function createExportDirectory(parent: FileSystemDirectoryHandle, name: string) {
  if (/[\/:*?"<>|]/.test(name) || name === "." || name === "..") throw new Error("폴더 이름에 쓸 수 없는 문자가 있습니다.");
  const handle = await parent.getDirectoryHandle(name, { create: true }) as WritableDirectory;
  await rememberDirectory(handle).catch(() => undefined);
  return handle;
}

export async function writeExportFolder(parent: FileSystemDirectoryHandle, name: string, files: File[]) {
  const folder = await parent.getDirectoryHandle(name, { create: true });
  await Promise.all(files.map(async (file) => {
    const parts = file.name.replace(`${name}-`, "").split("/");
    const fileName = parts.pop()!;
    let directory = folder;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file); await writable.close();
  }));
  return folder;
}
