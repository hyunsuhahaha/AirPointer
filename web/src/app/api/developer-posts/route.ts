export function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  return Response.json(status === "draft" ? {} : { items: ["리플레이 UI 개선", "API 응답 타입 정리"] }, { headers: { "Cache-Control": "no-store" } });
}
