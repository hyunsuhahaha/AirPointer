// 방금그거뭐였지 desktop app. It shows the web app and adds what a browser
// can't do: recording without the share dialog, a log of the window in front
// and of file saves, direct saving into a fixed folder, a global shortcut and
// a tray icon.
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, Menu, Tray, app, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, session, shell } from "electron";
import { ActivityLog, ignoredPath } from "./activity-log";
import { foregroundWindowReader } from "./foreground-window";
import { loadSettings, safeContextPath, saveSettings } from "./settings";
import type { Settings } from "./settings";

const APP_URL = process.env.WHATWAS_URL || "https://whatwas.vercel.app";
const APP_ORIGIN = new URL(APP_URL).origin;
const ICON = path.join(__dirname, "..", "assets", "icon.ico");
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let settings: Settings;
let watcher: fs.FSWatcher | null = null;
const activity = new ActivityLog();

// Tests run the app with a throwaway profile.
if (process.env.WHATWAS_USER_DATA) app.setPath("userData", process.env.WHATWAS_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showWindow());

app.whenReady().then(() => {
  settings = loadSettings(SETTINGS_FILE(), {
    exportDir: path.join(app.getPath("documents"), "방금그거뭐였지"),
    watchDir: null,
    shortcut: "CommandOrControl+Shift+E",
  });

  // getDisplayMedia() gets the primary screen straight away: no picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
    callback(screen ? { video: screen } : {});
  });

  createWindow();
  createTray();
  startWindowTracking();
  watchProjectFolder(settings.watchDir);
  registerShortcut();
  registerIpc();
});

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => globalShortcut.unregisterAll());
// Closing the window hides it; recording keeps going from the tray.
app.on("window-all-closed", () => { if (quitting) app.quit(); });

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640,
    title: "방금그거뭐였지", icon: ICON, backgroundColor: "#0d0d0c", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.on("close", (event) => { if (!quitting) { event.preventDefault(); window?.hide(); } });
  // Stay on the app; everything else opens in the real browser.
  window.webContents.on("will-navigate", (event, url) => { if (new URL(url).origin !== APP_ORIGIN) { event.preventDefault(); void shell.openExternal(url); } });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void window.loadURL(APP_URL);
}

function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip("방금그거뭐였지 · 기록 중");
  tray.on("click", showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "열기", click: showWindow },
    { label: `지금 내보내기 (${settings.shortcut.replace("CommandOrControl", "Ctrl")})`, click: triggerExport },
    { type: "separator" },
    { label: "내보내기 폴더 열기", click: () => { fs.mkdirSync(settings.exportDir, { recursive: true }); void shell.openPath(settings.exportDir); } },
    { label: "내보내기 폴더 바꾸기…", click: () => void chooseExportDir() },
    { label: settings.watchDir ? `작업 폴더: ${path.basename(settings.watchDir)}` : "작업 폴더 지정…", click: () => void chooseWatchDir() },
    { type: "separator" },
    { label: "종료", click: () => { quitting = true; app.quit(); } },
  ]));
}

function startWindowTracking() {
  const read = foregroundWindowReader();
  if (!read) return;
  setInterval(() => {
    try {
      const current = read();
      if (current && (current.app || current.title)) activity.recordWindow({ at: Date.now(), ...current });
    } catch { /* A window can vanish between calls. */ }
  }, 500).unref();
}

function watchProjectFolder(dir: string | null) {
  watcher?.close(); watcher = null;
  if (!dir || !fs.existsSync(dir)) return;
  watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
    if (!file || ignoredPath(file)) return;
    const full = path.join(dir, file);
    fs.stat(full, (error, stats) => { if (!error && stats.isFile()) activity.recordFileSave({ at: stats.mtimeMs, path: file.replaceAll("\\", "/") }); });
  });
  watcher.on("error", () => { watcher?.close(); watcher = null; });
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  globalShortcut.register(settings.shortcut, triggerExport);
}

// The page does the export; it copies the prompt when it's done.
function triggerExport() {
  window?.webContents.send("whatwas:export-shortcut");
}

async function chooseExportDir() {
  const result = await dialog.showOpenDialog(window!, { title: "내보내기 폴더", defaultPath: settings.exportDir, properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  settings = { ...settings, exportDir: result.filePaths[0] };
  saveSettings(SETTINGS_FILE(), settings); refreshTrayMenu();
  return settings.exportDir;
}

async function chooseWatchDir() {
  const result = await dialog.showOpenDialog(window!, { title: "파일 저장을 기록할 작업 폴더", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  settings = { ...settings, watchDir: result.filePaths[0] };
  saveSettings(SETTINGS_FILE(), settings); watchProjectFolder(settings.watchDir); refreshTrayMenu();
  return settings.watchDir;
}

function registerIpc() {
  // Only our own page may use the bridge.
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const url = event.senderFrame?.url;
    if (!url || new URL(url).origin !== APP_ORIGIN) throw new Error("허용되지 않은 요청입니다.");
  };
  // The page calls this once it can record. Start recording for it, with a
  // simulated user gesture because screen capture needs one.
  ipcMain.handle("whatwas:page-ready", (event) => {
    trusted(event);
    if (process.env.WHATWAS_NO_AUTOSTART) return;
    void event.sender.executeJavaScript("window.dispatchEvent(new Event('whatwas-native-ready'))", true);
  });
  ipcMain.handle("whatwas:settings", (event) => { trusted(event); return { exportDir: settings.exportDir, watchDir: settings.watchDir, shortcut: settings.shortcut }; });
  ipcMain.handle("whatwas:choose-export-dir", (event) => { trusted(event); return chooseExportDir(); });
  ipcMain.handle("whatwas:choose-watch-dir", (event) => { trusted(event); return chooseWatchDir(); });
  ipcMain.handle("whatwas:activity", (event, since: number, until: number) => { trusted(event); return activity.slice(Number(since), Number(until)); });
  ipcMain.handle("whatwas:write-context", async (event, name: string, files: { path: string; data: Uint8Array }[]) => {
    trusted(event);
    let folder = "";
    for (const file of files) {
      const target = safeContextPath(settings.exportDir, name, file.path);
      folder = target.folder;
      await fs.promises.mkdir(path.dirname(target.target), { recursive: true });
      await fs.promises.writeFile(target.target, file.data);
    }
    return folder;
  });
  ipcMain.handle("whatwas:reveal", (event, target: string) => {
    trusted(event);
    if (path.resolve(target).startsWith(path.resolve(settings.exportDir))) shell.showItemInFolder(target);
  });
}
