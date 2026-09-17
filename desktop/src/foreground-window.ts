// Reads the foreground window's title and program on Windows through user32
// and kernel32. koffi ships prebuilt binaries, so nothing is compiled.
import path from "node:path";
import koffi from "koffi";

type Reader = () => { app: string; title: string } | null;

function windowsReader(): Reader {
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");
  const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* text, int max)");
  const GetWindowThreadProcessId = user32.func("uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32_t* pid)");
  const OpenProcess = kernel32.func("void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)");
  const QueryFullProcessImageNameW = kernel32.func("bool __stdcall QueryFullProcessImageNameW(void* process, uint32_t flags, _Out_ uint16_t* name, _Inout_ uint32_t* size)");
  const CloseHandle = kernel32.func("bool __stdcall CloseHandle(void* handle)");
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

  const text = (buffer: Buffer, length: number) => buffer.toString("utf16le", 0, length * 2);

  return () => {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    const titleBuffer = Buffer.alloc(512 * 2);
    const title = text(titleBuffer, GetWindowTextW(hwnd, titleBuffer, 512));
    const pid = [0];
    GetWindowThreadProcessId(hwnd, pid);
    let app = "";
    const process = pid[0] ? OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]) : null;
    if (process) {
      try {
        const nameBuffer = Buffer.alloc(1024 * 2);
        const size = [1024];
        if (QueryFullProcessImageNameW(process, 0, nameBuffer, size)) app = path.win32.basename(text(nameBuffer, size[0]), ".exe");
      } finally { CloseHandle(process); }
    }
    return { app, title };
  };
}

export function foregroundWindowReader(): Reader | null {
  if (process.platform !== "win32") return null;
  try { return windowsReader(); } catch { return null; }
}
