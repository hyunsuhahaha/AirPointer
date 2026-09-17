import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""}`,
    // Next's dev overlay injects <style> tags without the nonce; a nonce would
    // also make browsers ignore 'unsafe-inline', so dev drops it.
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com https://vercel.com https://*.blob.vercel-storage.com",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Referrer-Policy", "no-referrer");
  // The desktop app captures the screen through Chromium's camera path, which
  // needs the page itself to be allowed; browsers keep camera fully off.
  const desktopApp = /Electron\//.test(request.headers.get("user-agent") ?? "");
  response.headers.set("Permissions-Policy", `camera=${desktopApp ? "(self)" : "()"}, microphone=(), geolocation=()`);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = { matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }] };
