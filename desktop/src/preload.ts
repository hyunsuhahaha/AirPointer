// The small API the web app sees as window.whatwasNative. Keep it in sync
// with web/src/lib/native-bridge.ts.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("whatwasNative", {
  version: 1,
  pageReady: () => ipcRenderer.invoke("whatwas:page-ready"),
  settings: () => ipcRenderer.invoke("whatwas:settings"),
  chooseExportDir: () => ipcRenderer.invoke("whatwas:choose-export-dir"),
  chooseWatchDir: () => ipcRenderer.invoke("whatwas:choose-watch-dir"),
  activity: (since: number, until: number) => ipcRenderer.invoke("whatwas:activity", since, until),
  writeContext: (name: string, files: { path: string; data: Uint8Array }[]) => ipcRenderer.invoke("whatwas:write-context", name, files),
  reveal: (target: string) => ipcRenderer.invoke("whatwas:reveal", target),
  onExportShortcut: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("whatwas:export-shortcut", handler);
    return () => { ipcRenderer.removeListener("whatwas:export-shortcut", handler); };
  },
});
