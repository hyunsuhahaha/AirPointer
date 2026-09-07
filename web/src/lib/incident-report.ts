export type Incident = { title: string; facts: string[]; possibleCause: string; nextChecks: string[] };
export type ReportEvidence = { claim: string; image: string; seconds: number };
export type IncidentReport = { answer: string; incident?: Incident; evidence: ReportEvidence[]; context: string; sample: boolean };

export function parseIncident(value: unknown): Incident | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (typeof item.title !== "string" || typeof item.possibleCause !== "string" || !Array.isArray(item.facts) || !Array.isArray(item.nextChecks)) return;
  const strings = (values: unknown[]) => values.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).slice(0, 3).map(v => v.slice(0, 500));
  return { title: item.title.slice(0, 160), facts: strings(item.facts), possibleCause: item.possibleCause.slice(0, 800), nextChecks: strings(item.nextChecks) };
}

export function reportText(report: IncidentReport): string {
  const incident = report.incident;
  return ["방금그거뭐였지 · 사건 기록", report.sample ? "샘플 시나리오 · 실제 AI 분석" : "사용자가 공유한 화면 분석", incident?.title, report.answer,
    incident && `확인된 사실\n${incident.facts.join("\n")}`,
    incident && `가능한 원인 · 추정\n${incident.possibleCause}`,
    incident && `다음 확인\n${incident.nextChecks.join("\n")}`,
    `선택한 화면 근거\n${report.evidence.map(e => `-${e.seconds.toFixed(2)}초: ${e.claim}`).join("\n") || "없음"}`,
    report.context].filter(Boolean).join("\n\n");
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function reportHtml(report: IncidentReport): string {
  // Reports are standalone and passive. Never embed model HTML or remote image URLs.
  const pictures = report.evidence.filter(e => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(e.image));
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>방금그거뭐였지 · 사건 기록</title><style>body{max-width:900px;margin:48px auto;padding:0 24px;font:16px/1.8 system-ui;color:#252520;background:#f7f5ef}h1{font-size:28px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}figure{margin:32px 0;border-top:1px solid #bbb;padding-top:20px}img{max-width:100%;height:auto}figcaption{margin-top:12px}</style><h1>${escape(report.incident?.title || "사건 기록")}</h1><pre>${escape(reportText(report))}</pre>${pictures.map(e => `<figure><img src="${e.image}" alt="선택한 화면 근거"><figcaption>-${e.seconds.toFixed(2)}초 · ${escape(e.claim)}</figcaption></figure>`).join("")}</html>`;
}
