import { randomBytes } from "node:crypto";
import { readStoredContext, readStoredContextFile } from "@/lib/context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChangeEvent = { peakAt?: number; peakScore?: number; bbox?: number[] };

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

function fileUrl(token: string, filePath: string) {
  return `/context/${token}/files/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const stored = await readStoredContext(token);
  if (!stored) return new Response(notFoundPage(), { status: 404, headers: pageHeaders() });
  const contextFile = await readStoredContextFile(token, "context.md");
  const eventsFile = await readStoredContextFile(token, "events.json");
  const contextText = contextFile ? contextFile.bytes.toString("utf8") : "화면 맥락 문서가 없습니다.";
  let events: ChangeEvent[] = [];
  if (eventsFile) {
    try { events = (JSON.parse(eventsFile.bytes.toString("utf8")) as { events?: ChangeEvent[] }).events ?? []; }
    catch { /* The raw file remains available below. */ }
  }
  const captures = stored.files.filter((file) => file.type.startsWith("image/") && file.path.startsWith("captures/") && !file.path.startsWith("captures/preview/"));
  const recordings = stored.files.filter((file) => file.type.startsWith("video/") && file.path.startsWith("recording/"));
  const shots = captures.map((file, index) => ({
    label: file.path.match(/(\d{4}-\d{2}-\d{2}T[^.]+).*\.jpg$/)?.[1]?.replaceAll("-", ":") ?? `대표 화면 ${index + 1}`,
    url: fileUrl(token, file.path),
  }));
  const captureCards = shots.map(({ label, url }, index) =>
    `<figure><a href="#shot-${index + 1}"><img src="${url}" loading="lazy" alt="${escapeHtml(`${label} 화면 캡처`)}"></a><figcaption><b>${escapeHtml(label)}</b><a href="${url}">원본 화면 열기</a></figcaption></figure>`).join("");
  // CSS-only lightbox: each capture opens its own :target overlay, so it works
  // without scripts; the script below only adds keyboard shortcuts.
  const lightboxes = shots.map(({ label, url }, index) => {
    const step = (target: number, name: string, symbol: string) => target >= 1 && target <= shots.length
      ? `<a class="step ${name}" href="#shot-${target}" aria-label="${name === "prev" ? "이전" : "다음"} 화면">${symbol}</a>` : "";
    return `<div class="lightbox" id="shot-${index + 1}" role="dialog" aria-label="${escapeHtml(label)} 크게 보기"><a class="backdrop" href="#timeline" aria-hidden="true" tabindex="-1"></a><img src="${url}" loading="lazy" alt="${escapeHtml(`${label} 화면 캡처`)}"><a class="close" href="#timeline" aria-label="닫기">×</a>${step(index, "prev", "‹")}${step(index + 2, "next", "›")}<p><b>${escapeHtml(label)}</b><span>${index + 1} / ${shots.length}</span><a href="${url}">원본 파일</a></p></div>`;
  }).join("");
  const nonce = randomBytes(16).toString("base64");
  const timeline = events.map((event) => `<li><time>${escapeHtml(event.peakAt ? new Date(event.peakAt).toISOString() : "시각 없음")}</time><span>화면 변화 · 강도 ${escapeHtml(typeof event.peakScore === "number" ? event.peakScore.toFixed(3) : "-")}${event.bbox ? ` · 영역 ${escapeHtml(event.bbox.map((value) => value.toFixed(2)).join(", "))}` : ""}</span></li>`).join("");
  const recordingLinks = recordings.map((file, index) => `<li><a href="${fileUrl(token, file.path)}">녹화 조각 ${index + 1} · ${escapeHtml(file.path.split("/").at(-1))}</a></li>`).join("");
  const expires = stored.expiresAt === null ? "삭제 전까지 유지" : new Date(stored.expiresAt).toISOString();
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>WhatWasThat Agent Context</title><style>${styles}</style></head><body><main><header><p>WHATWASTHAT · READ-ONLY CONTEXT</p><h1>최근 ${stored.seconds}초 화면 기록</h1><div><span>생성 ${escapeHtml(new Date(stored.createdAt).toISOString())}</span><span>만료 ${escapeHtml(expires)}</span></div></header><section><h2>현재 맥락</h2><pre>${escapeHtml(contextText)}</pre></section><section><h2>최근 화면 변화</h2>${timeline ? `<ol class="timeline">${timeline}</ol>` : "<p>기록된 화면 변화가 없습니다.</p>"}</section><section id="timeline"><h2>화면 타임라인 <small>${captures.length}장</small></h2><div class="captures">${captureCards}</div></section><section><h2>원본 자료</h2><ul class="raw"><li><a href="${fileUrl(token, "context.md")}">context.md</a></li>${eventsFile ? `<li><a href="${fileUrl(token, "events.json")}">events.json</a></li>` : ""}</ul></section>${recordings.length ? `<section><h2>녹화 <small>${recordings.length}개 조각</small></h2><ul class="raw">${recordingLinks}</ul></section>` : ""}<footer>${stored.expiresAt === null ? "이 읽기 전용 Context는 만든 사람이 삭제할 때까지 유지됩니다." : `이 읽기 전용 Context는 ${escapeHtml(expires)}에 만료됩니다.`}</footer></main>${lightboxes}<script nonce="${nonce}">${keyboardScript}</script></body></html>`;
  return new Response(html, { headers: pageHeaders(nonce) });
}

function pageHeaders(nonce?: string) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Content-Security-Policy": `default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline';${nonce ? ` script-src 'nonce-${nonce}';` : ""} base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}

const keyboardScript = `addEventListener("keydown",function(e){var m=/^#shot-([0-9]+)$/.exec(location.hash);if(!m)return;var n=+m[1];var t=e.key==="Escape"?"timeline":e.key==="ArrowLeft"?"shot-"+(n-1):e.key==="ArrowRight"?"shot-"+(n+1):null;if(!t||!document.getElementById(t))return;e.preventDefault();location.replace("#"+t)})`;

function notFoundPage() {
  return "<!doctype html><html lang=ko><meta charset=utf-8><title>Context 없음</title><body><h1>이 Context는 없거나 만료되었습니다.</h1></body></html>";
}

const styles = `:root{color-scheme:dark;font-family:Arial,"Noto Sans KR",sans-serif;background:#10110f;color:#f1f1eb}*{box-sizing:border-box}body{margin:0}main{width:min(1100px,calc(100% - 32px));margin:auto;padding:42px 0 72px}header{border-bottom:1px solid #3b3d36;padding-bottom:24px}header p{color:#ff6b22;font:700 12px monospace;letter-spacing:.12em}h1{font-size:clamp(28px,5vw,54px);margin:10px 0 18px}header div{display:flex;gap:18px;flex-wrap:wrap;color:#a6a89f;font:12px monospace}section{padding:30px 0;border-bottom:1px solid #30322d}h2{font-size:18px;margin:0 0 18px}h2 small{color:#9b9d94;font-size:12px;margin-left:8px}pre{white-space:pre-wrap;line-height:1.7;background:#191a17;border:1px solid #34362f;padding:18px;border-radius:8px;color:#d8d9d1}.timeline{list-style:none;padding:0;margin:0;display:grid;gap:8px}.timeline li{display:grid;grid-template-columns:200px 1fr;gap:16px;padding:10px 0;border-bottom:1px solid #282a25}.timeline time{font:12px monospace;color:#ff9360}.captures{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}figure{margin:0;background:#191a17;border:1px solid #34362f;border-radius:8px;overflow:hidden}figure img{width:100%;aspect-ratio:16/9;display:block;object-fit:contain;background:#050505}figcaption{display:flex;justify-content:space-between;gap:12px;padding:11px;font-size:12px}a{color:#ff9360}.raw{line-height:1.9;margin:0;padding-left:18px}footer{padding-top:24px;color:#8d8f86;font-size:12px}.lightbox{display:none;position:fixed;inset:0;z-index:10;align-items:center;justify-content:center;padding:56px 64px 64px}.lightbox:target{display:flex}.lightbox .backdrop{position:absolute;inset:0;background:#050505f2}.lightbox img{position:relative;width:100%;height:100%;object-fit:contain}.lightbox .close,.lightbox .step{position:absolute;display:grid;place-items:center;border:1px solid #4a4c45;background:#1b1c19e6;color:#f1f1eb;text-decoration:none;border-radius:50%;line-height:1}.lightbox .close{top:12px;right:14px;width:38px;height:38px;font-size:26px}.lightbox .step{top:50%;width:44px;height:44px;margin-top:-22px;font-size:32px;padding-bottom:4px}.lightbox .prev{left:12px}.lightbox .next{right:12px}.lightbox .close:hover,.lightbox .step:hover{border-color:#ff6b22;color:#ff9360}.lightbox p{position:absolute;left:0;right:0;bottom:14px;margin:0;display:flex;justify-content:center;gap:16px;font-size:12px;color:#c9cac2}.lightbox p span{font-family:monospace}@media(max-width:600px){.lightbox{padding:56px 8px 56px}.lightbox .step{top:auto;bottom:40px}main{width:min(100% - 20px,1100px);padding-top:22px}.timeline li{grid-template-columns:1fr;gap:4px}}`;
