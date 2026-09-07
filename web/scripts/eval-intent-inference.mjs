import { chromium } from "@playwright/test";
import OpenAI from "openai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = join(ROOT, ".data", "evals", "intent-inference");
const RUNS = Number(process.env.EVAL_RUNS || 1);
const REQUESTED_IDS = new Set((process.env.EVAL_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));

async function loadLocalEnv() {
  const text = await readFile(join(ROOT, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const scenarios = [
  {
    id: "typescript-build", app: "VS Code / Terminal", project: "checkout-web",
    task: "결제 폼 수정 후 프로덕션 빌드를 통과시키기",
    lastAttempt: "PaymentForm.tsx의 amount 처리를 수정한 뒤 npm run build 실행",
    blocker: "PaymentForm.tsx 84행에서 string을 number에 할당한 TS2322 오류",
    intent: "타입 오류의 원인을 찾아 코드를 수정하고 빌드를 통과시키기",
    frames: [
      ["PaymentForm.tsx", "const total: number = form.amount;", "Editing checkout amount handling"],
      ["Terminal", "$ npm run build\n> next build", "Creating an optimized production build"],
      ["Terminal — Build failed", "Type error: Type 'string' is not assignable to type 'number'.\nPaymentForm.tsx:84:9  TS2322", "Build failed"],
      ["PaymentForm.tsx", "84  const total: number = form.amount;", "Problems 1 · TS2322"],
    ],
  },
  {
    id: "spreadsheet-formula", app: "Spreadsheet", project: "September inventory",
    task: "9월 재고 집계표의 총액 계산을 완성하기",
    lastAttempt: "Total 열의 수식을 아래 행까지 채우기",
    blocker: "G28 수식이 삭제된 Products 시트를 참조해 #REF! 발생",
    intent: "깨진 참조를 올바른 단가 범위로 교체해 총액을 복구하기",
    frames: [
      ["Inventory.xlsx", "SKU-104  Qty 12  Unit price 8,900", "Editing September totals"],
      ["Formula bar", "=F28*Products!#REF!", "Filled formula into G28"],
      ["Inventory.xlsx", "G28   #REF!", "Error: Invalid cell reference"],
      ["Formula help", "A referenced range was deleted.", "Selected cell G28"],
    ],
  },
  {
    id: "payment-decline", app: "Merchant Admin", project: "Order #A-1842",
    task: "실패한 주문 결제를 재처리하기",
    lastAttempt: "주문 A-1842에서 결제 재시도 실행",
    blocker: "카드 발급사의 do_not_honor 거절로 재결제 실패",
    intent: "중복 청구 없이 고객에게 결제수단 변경을 요청하기",
    frames: [
      ["Order A-1842", "Payment failed · ₩128,000", "Awaiting operator action"],
      ["Retry payment", "Retrying payment intent pi_1842...", "Processing"],
      ["Payment declined", "Code: do_not_honor\nDeclined by issuer", "No charge was created"],
      ["Order A-1842", "Payment failed · Retry count 2", "Contact customer"],
    ],
  },
  {
    id: "meeting-share", app: "Meet", project: "Product review",
    task: "제품 리뷰 회의에서 화면을 계속 공유하기",
    lastAttempt: "디자인 시안을 전체 화면으로 공유",
    blocker: "공유한 창이 닫혀 화면 공유가 중단됨",
    intent: "올바른 창을 다시 선택해 화면 공유를 재개하기",
    frames: [
      ["Product review", "You are presenting Design-v4.fig", "12 participants"],
      ["Design preview", "Checkout redesign — final", "Presenting to meeting"],
      ["Product review", "Your screen share has stopped", "The shared window was closed"],
      ["Present now", "Choose a tab, window, or entire screen", "Not presenting"],
    ],
  },
  {
    id: "git-conflict", app: "VS Code / Git", project: "feature/cart",
    task: "main 브랜치를 feature/cart에 병합하기",
    lastAttempt: "git merge main 실행",
    blocker: "cart.ts의 calculateTotal 함수에서 병합 충돌 발생",
    intent: "cart.ts 충돌을 해결하고 병합을 완료하기",
    frames: [
      ["Terminal", "$ git status\nOn branch feature/cart", "Working tree clean"],
      ["Terminal", "$ git merge main", "Auto-merging src/cart.ts"],
      ["Merge conflict", "CONFLICT (content): Merge conflict in src/cart.ts", "Automatic merge failed"],
      ["cart.ts", "<<<<<<< HEAD\ncalculateTotal(items, coupon)\n=======\ncalculateTotal(items)\n>>>>>>> main", "Resolve in Merge Editor"],
    ],
  },
  {
    id: "docker-port", app: "Terminal / Docker", project: "local-api",
    task: "로컬 API 컨테이너를 실행하기",
    lastAttempt: "docker compose up api 실행",
    blocker: "호스트의 5432 포트를 다른 프로세스가 사용 중이라 컨테이너 시작 실패",
    intent: "포트 점유 프로세스를 종료하거나 compose 포트를 변경해 API를 실행하기",
    frames: [
      ["compose.yaml", "postgres ports: - 5432:5432", "Saved"],
      ["Terminal", "$ docker compose up api", "Starting local-api-db-1"],
      ["Docker error", "Bind for 0.0.0.0:5432 failed: port is already allocated", "Container failed to start"],
      ["Docker Desktop", "local-api-db-1 · Exited", "Port 5432 unavailable"],
    ],
  },
  {
    id: "upload-limit", app: "CMS", project: "Homepage hero",
    task: "홈페이지 히어로 영상을 업로드하기",
    lastAttempt: "hero-final.mp4 148MB 파일 업로드",
    blocker: "CMS의 파일 크기 제한 100MB를 초과",
    intent: "영상을 100MB 이하로 압축하거나 외부 영상 링크를 사용하기",
    frames: [
      ["Media library", "Upload new media", "Maximum file size: 100 MB"],
      ["Uploading", "hero-final.mp4 · 148 MB", "Uploading 92%"],
      ["Upload failed", "File exceeds the 100 MB limit", "hero-final.mp4 was not saved"],
      ["Media library", "No new media", "Try a smaller file"],
    ],
  },
  {
    id: "session-expired", app: "Analytics", project: "Weekly dashboard",
    task: "주간 매출 대시보드 필터를 저장하기",
    lastAttempt: "날짜·지역 필터를 설정한 뒤 Save view 클릭",
    blocker: "로그인 세션 만료로 저장 요청이 거부됨",
    intent: "다시 로그인한 뒤 필터를 잃지 않고 뷰를 저장하기",
    frames: [
      ["Revenue dashboard", "Sep 1–7 · Seoul · Enterprise", "Unsaved view"],
      ["Save view", "Saving Weekly Seoul Enterprise...", "Please wait"],
      ["Session expired", "Your session has expired. Sign in again.", "Changes were not saved"],
      ["Sign in", "Continue to Analytics", "Return URL includes current dashboard"],
    ],
  },
  {
    id: "migration-unique", app: "Terminal / Database", project: "users-service",
    task: "사용자 이메일 unique 인덱스 마이그레이션 적용하기",
    lastAttempt: "alembic upgrade head 실행",
    blocker: "기존 데이터에 중복 이메일이 있어 unique 인덱스 생성 실패",
    intent: "중복 이메일 데이터를 정리한 뒤 마이그레이션을 다시 실행하기",
    frames: [
      ["migration 0142", "create_unique_constraint('uq_users_email', 'users', ['email'])", "Ready"],
      ["Terminal", "$ alembic upgrade head", "Running upgrade 0141 -> 0142"],
      ["Database error", "UniqueViolation: Key (email)=(kim@example.com) is duplicated", "Migration rolled back"],
      ["Database console", "SELECT email, count(*) FROM users GROUP BY email HAVING count(*) > 1", "1 duplicate group"],
    ],
  },
  {
    id: "deploy-env", app: "Cloud Deploy", project: "production-web",
    task: "웹 앱을 프로덕션에 배포하기",
    lastAttempt: "main 커밋 8ad3f1c 배포 시작",
    blocker: "필수 환경변수 STRIPE_SECRET_KEY가 없어 빌드 실패",
    intent: "프로덕션 환경변수를 설정하고 동일 커밋을 재배포하기",
    frames: [
      ["Deployments", "8ad3f1c · Deploying to Production", "Build queued"],
      ["Build logs", "Installing dependencies...\nRunning npm run build", "Step 3/5"],
      ["Build failed", "Error: Missing required env STRIPE_SECRET_KEY", "Exit code 1"],
      ["Environment variables", "STRIPE_SECRET_KEY · Not configured in Production", "Deployment blocked"],
    ],
  },
  {
    id: "design-export", app: "Design Tool", project: "App icon",
    task: "스토어 등록용 1024px 앱 아이콘을 내보내기",
    lastAttempt: "512×512 프레임을 PNG 1x로 export",
    blocker: "출력 이미지가 요구 규격 1024×1024보다 작음",
    intent: "프레임 또는 export 배율을 1024×1024로 맞춰 다시 내보내기",
    frames: [
      ["App Icon", "Frame 512 × 512", "Export settings: PNG 1x"],
      ["Export", "app-icon.png · 512 × 512", "Exported successfully"],
      ["Store upload", "Image dimensions are too small", "Required: 1024 × 1024"],
      ["Export settings", "PNG · 1x · 512 × 512", "Adjust scale"],
    ],
  },
  {
    id: "email-attachment", app: "Webmail", project: "Monthly report",
    task: "월간 보고서를 첨부해 팀에 이메일 보내기",
    lastAttempt: "보고서 전달 메일에서 Send 클릭",
    blocker: "본문에 첨부를 언급했지만 실제 파일이 없어 경고 발생",
    intent: "monthly-report.pdf를 첨부한 뒤 이메일을 보내기",
    frames: [
      ["New message", "To: team@example.com\nSubject: August report", "Body: 첨부한 월간 보고서를 확인해주세요."],
      ["New message", "Send", "No attachments"],
      ["Missing attachment?", "You wrote '첨부' but no files are attached.", "Send anyway · Go back"],
      ["New message", "Attachment area empty", "Draft not sent"],
    ],
  },
  {
    id: "address-validation", app: "Store Checkout", project: "Customer order",
    task: "온라인 주문의 배송지 입력을 완료하기",
    lastAttempt: "우편번호 없이 배송지 저장",
    blocker: "필수 우편번호가 비어 있어 주소 검증 실패",
    intent: "올바른 우편번호를 입력해 배송 단계로 진행하기",
    frames: [
      ["Shipping address", "Seoul, Gangnam-gu, Teheran-ro 123", "Postal code: empty"],
      ["Shipping address", "Continue to shipping", "Validating address"],
      ["Address incomplete", "Postal code is required", "Could not continue"],
      ["Shipping address", "Postal code · This field is required", "Focus on postal code"],
    ],
  },
  {
    id: "cuda-memory", app: "JupyterLab", project: "Model training",
    task: "이미지 분류 모델 학습을 실행하기",
    lastAttempt: "batch size 64로 학습 셀 실행",
    blocker: "GPU 메모리 부족으로 CUDA out of memory 발생",
    intent: "batch size를 줄이거나 메모리를 정리해 학습을 재개하기",
    frames: [
      ["train.ipynb", "BATCH_SIZE = 64\nmodel.fit(train_loader)", "Cell ready"],
      ["train.ipynb", "Epoch 1/20 · 31%", "GPU memory 7.8 / 8.0 GB"],
      ["Python error", "CUDA out of memory. Tried to allocate 512 MiB", "Cell execution stopped"],
      ["train.ipynb", "BATCH_SIZE = 64", "Kernel idle · GPU memory high"],
    ],
  },
  {
    id: "snapshot-test", app: "Terminal / Test Runner", project: "component-library",
    task: "Button 컴포넌트 테스트를 통과시키기",
    lastAttempt: "버튼 레이블 변경 후 npm test 실행",
    blocker: "렌더링 결과가 저장된 스냅샷과 달라 테스트 실패",
    intent: "변경이 의도된 것인지 확인하고 스냅샷 또는 구현을 수정하기",
    frames: [
      ["Button.tsx", "<button>{loading ? 'Saving…' : 'Save'}</button>", "Label changed"],
      ["Terminal", "$ npm test Button", "Running 8 tests"],
      ["Test failed", "Snapshot name: Button loading state 1\n- Loading...\n+ Saving…", "1 failed, 7 passed"],
      ["Button.test.tsx", "expect(tree).toMatchSnapshot()", "Snapshot mismatch"],
    ],
  },
  {
    id: "download-blocked", app: "Browser", project: "Vendor invoice",
    task: "거래처 인보이스 PDF를 다운로드하기",
    lastAttempt: "invoice-2026-08.pdf 다운로드 링크 클릭",
    blocker: "브라우저가 안전하지 않은 HTTP 혼합 콘텐츠 다운로드를 차단",
    intent: "HTTPS 다운로드 주소를 사용하거나 신뢰 가능한 경로로 파일을 받기",
    frames: [
      ["Vendor Portal", "Invoice 2026-08 · Download PDF", "Secure page"],
      ["Downloads", "Starting invoice-2026-08.pdf", "Source: http://files.vendor.test"],
      ["Download blocked", "Insecure download blocked", "This file can't be downloaded securely"],
      ["Vendor Portal", "Download did not start", "Contact vendor for a secure link"],
    ],
  },
  {
    id: "calendar-conflict", app: "Calendar", project: "Client kickoff",
    task: "고객 킥오프 회의를 예약하기",
    lastAttempt: "화요일 14시에 참석자 4명으로 일정 저장",
    blocker: "필수 참석자 Mina가 같은 시간에 다른 일정이 있음",
    intent: "모두 가능한 추천 시간으로 일정을 변경하기",
    frames: [
      ["New event", "Client kickoff · Tue 14:00–15:00", "Guests: Mina, Jun, Alex, me"],
      ["New event", "Save", "Checking guest availability"],
      ["Scheduling conflict", "Mina is busy at Tue 14:00", "Suggested: Tue 15:30"],
      ["Find a time", "Tue 15:30 · All guests available", "Event not saved"],
    ],
  },
  {
    id: "folder-permission", app: "Terminal", project: "Log export",
    task: "애플리케이션 로그를 reports 폴더로 내보내기",
    lastAttempt: "로그 생성 명령을 C:\\Program Files\\Reports 대상으로 실행",
    blocker: "현재 사용자에게 대상 폴더 쓰기 권한이 없어 Access denied",
    intent: "쓰기 가능한 폴더를 선택하거나 적절한 권한으로 다시 실행하기",
    frames: [
      ["Terminal", "> app.exe export-logs --out \"C:\\Program Files\\Reports\"", "Exporting logs"],
      ["Terminal", "Writing report-20260907.zip", "Target: C:\\Program Files\\Reports"],
      ["Access denied", "EACCES: permission denied, open 'C:\\Program Files\\Reports\\report.zip'", "Export failed"],
      ["File Explorer", "C:\\Program Files\\Reports", "You need administrator permission"],
    ],
  },
  {
    id: "offline-form", app: "CRM", project: "Customer note",
    task: "고객 상담 내용을 CRM에 저장하기",
    lastAttempt: "상담 메모 작성 후 Save note 클릭",
    blocker: "네트워크 연결이 끊겨 저장 요청이 전송되지 않음",
    intent: "작성 내용을 보존한 채 연결 복구 후 다시 저장하기",
    frames: [
      ["Customer · Park", "Note: 환불 대신 다음 달 이용권 연장을 요청함", "Unsaved changes"],
      ["Customer · Park", "Saving note...", "Network request pending"],
      ["You're offline", "Could not save note", "Your text is kept in this browser"],
      ["Customer · Park", "Unsaved changes · Retry", "Offline"],
    ],
  },
  {
    id: "csv-encoding", app: "Data Importer", project: "Korean customers",
    task: "한국 고객 CSV 파일을 정상적으로 가져오기",
    lastAttempt: "UTF-8로 해석해 customers.csv 미리보기",
    blocker: "실제 CP949 파일을 UTF-8로 읽어 한글이 깨짐",
    intent: "인코딩을 CP949/EUC-KR로 변경해 다시 가져오기",
    frames: [
      ["Import customers.csv", "Encoding: UTF-8", "Delimiter: comma"],
      ["Preview", "name,city\n������,����", "1,248 rows detected"],
      ["Encoding warning", "Invalid UTF-8 sequences found in 1,217 rows", "Import paused"],
      ["Import settings", "Detected encoding: CP949", "Select encoding and refresh preview"],
    ],
  },
  {
    id: "api-rate-limit", app: "API Console", project: "Catalog sync",
    task: "상품 카탈로그 전체 동기화를 완료하기",
    lastAttempt: "5,000개 상품을 병렬 요청 50개로 동기화",
    blocker: "요청 속도가 API 분당 제한을 초과해 HTTP 429 발생",
    intent: "동시성을 낮추고 Retry-After를 적용해 동기화를 재시도하기",
    frames: [
      ["Catalog Sync", "5,000 products · Concurrency 50", "Start sync"],
      ["Catalog Sync", "2,140 / 5,000 · 428 req/min", "Syncing"],
      ["API error", "429 Too Many Requests\nRetry-After: 60", "Sync paused at item 2141"],
      ["Sync settings", "Concurrency 50 · Rate limit 300/min", "2,860 items remaining"],
    ],
  },
];

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function renderFrames(browser, scenario) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  const result = [];
  for (let index = 0; index < scenario.frames.length; index += 1) {
    const [title, body, status] = scenario.frames[index];
    const danger = /failed|error|denied|blocked|expired|conflict|offline|#REF|warning|declined|stopped|too many/i.test(`${title} ${body} ${status}`);
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;background:#0c0f14;color:#e8edf5;font-family:Arial,"Malgun Gothic",sans-serif}
      .top{height:44px;background:#171b23;border-bottom:1px solid #303744;display:flex;align-items:center;padding:0 18px;gap:12px;color:#aeb8c8;font-size:14px}.dots{color:#7f8ba0}.app{font-weight:700;color:#f5f7fb}.project{margin-left:auto}
      main{height:556px;padding:38px 48px;background:linear-gradient(145deg,#10151d,#0b0e13)}.crumb{font-size:13px;color:#8290a5;text-transform:uppercase;letter-spacing:.08em;margin-bottom:18px}
      .panel{border:1px solid #303947;border-radius:14px;background:#151b24;box-shadow:0 18px 60px #0007;overflow:hidden}.title{padding:20px 24px;border-bottom:1px solid #2a3240;font-size:22px;font-weight:700}
      pre{margin:0;padding:30px 28px;min-height:260px;white-space:pre-wrap;font:18px/1.65 Consolas,"Malgun Gothic",monospace;color:#e9edf3;background:#10151d}
      .status{padding:17px 24px;font-size:15px;font-weight:700;color:${danger ? "#ff8e8e" : "#8fdaa6"};background:${danger ? "#321c22" : "#14271c"};border-top:1px solid ${danger ? "#68333e" : "#285036"}}
      .timeline{display:flex;gap:8px;margin-top:22px}.timeline span{height:5px;flex:1;border-radius:9px;background:#2d3440}.timeline span.on{background:#7aa2f7}
    </style></head><body><div class="top"><span class="dots">● ● ●</span><span class="app">${escapeHtml(scenario.app)}</span><span class="project">${escapeHtml(scenario.project)}</span></div><main><div class="crumb">RECENT WORK · FRAME ${index + 1} OF ${scenario.frames.length}</div><section class="panel"><div class="title">${escapeHtml(title)}</div><pre>${escapeHtml(body)}</pre><div class="status">${escapeHtml(status)}</div></section><div class="timeline">${scenario.frames.map((_, i) => `<span class="${i <= index ? "on" : ""}"></span>`).join("")}</div></main></body></html>`);
    const png = await page.screenshot({ type: "png" });
    result.push(`data:image/png;base64,${png.toString("base64")}`);
  }
  await page.close();
  return result;
}

const baselineSchema = {
  type: "object", properties: {
    answer: { type: "string" },
    evidence: { type: "array", items: { type: "integer", minimum: 1, maximum: 4 } },
  }, required: ["answer", "evidence"], additionalProperties: false,
};

const structuredSchema = {
  type: "object", properties: {
    context: { type: "object", properties: {
      current_task: { type: "string" }, subgoals: { type: "array", items: { type: "string" } },
      last_attempt: { type: "string" }, blocking_event: { type: "string" }, likely_intent: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }, evidence_frames: { type: "array", items: { type: "integer", minimum: 1, maximum: 4 } },
    }, required: ["current_task", "subgoals", "last_attempt", "blocking_event", "likely_intent", "confidence", "evidence_frames"], additionalProperties: false },
    answer: { type: "string" },
  }, required: ["context", "answer"], additionalProperties: false,
};

async function callModel(client, model, condition, frames) {
  const started = performance.now();
  const structured = condition === "structured";
  const response = await client.responses.create({
    model, store: false, max_output_tokens: 700,
    instructions: structured
      ? "당신은 화면 작업 문맥 컴파일러입니다. 화면을 독립 이미지로 요약하지 말고 시간순 행동을 하위 목표와 현재 작업으로 계층화하세요. 관찰과 추정을 구분하고, 근거가 부족하면 confidence를 낮추세요. 사용자가 상황을 설명하지 않아도 되도록 likely_intent를 만들고 그 의도에 직접 도움이 되는 한국어 답을 작성하세요. 불필요한 확인 질문은 하지 마세요."
      : "사용자가 질문을 제공하지 않았습니다. 첨부 화면의 핵심 변화에서 눈에 띄는 문제와 가능한 원인, 바로 할 다음 행동을 한국어로 간결하게 설명하세요. 화면에 근거가 없으면 추측하지 마세요.",
    text: { format: { type: "json_schema", name: structured ? "moment_context_answer" : "screen_analysis", strict: true, schema: structured ? structuredSchema : baselineSchema } },
    input: [{ role: "user", content: [
      { type: "input_text", text: structured
        ? "다음은 변화 감지 알고리즘이 시간순으로 고른 최근 15초 대표 화면입니다. current_task, subgoals, last_attempt, blocking_event, likely_intent를 먼저 구성한 뒤 답하세요."
        : "화면 변화 알고리즘이 고른 대표 프레임을 보고 최근 15초의 핵심 변화를 설명하세요." },
      ...frames.flatMap((url, index) => [{ type: "input_text", text: `대표 프레임 ${index + 1} · 시간순` }, { type: "input_image", image_url: url, detail: "high" }]),
    ] }],
  });
  return {
    output: JSON.parse(response.output_text), latencyMs: Math.round(performance.now() - started),
    inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0,
  };
}

const judgeSchema = {
  type: "object", properties: {
    A: scoreShape(), B: scoreShape(), preferred: { type: "string", enum: ["A", "B", "tie"] }, reason: { type: "string" },
  }, required: ["A", "B", "preferred", "reason"], additionalProperties: false,
};

function scoreShape() {
  return { type: "object", properties: {
    task: { type: "integer", minimum: 0, maximum: 2 }, causal_chain: { type: "integer", minimum: 0, maximum: 2 },
    blocker: { type: "integer", minimum: 0, maximum: 2 }, intent_action: { type: "integer", minimum: 0, maximum: 2 },
    groundedness: { type: "integer", minimum: 0, maximum: 2 },
  }, required: ["task", "causal_chain", "blocker", "intent_action", "groundedness"], additionalProperties: false };
}

async function judge(client, model, scenario, baseline, structured, flip) {
  const entries = flip ? { A: structured.output, B: baseline.output } : { A: baseline.output, B: structured.output };
  const response = await client.responses.create({
    model, store: false, max_output_tokens: 500,
    instructions: "당신은 블라인드 평가자입니다. 두 출력의 형식이나 길이가 아니라 정답과의 의미 일치만 평가하세요. 각 항목은 0=틀림/누락, 1=부분적으로 맞음, 2=정확함입니다. groundedness는 근거 없는 주장이나 불필요한 사용자 확인 요구가 없으면 2점입니다. 구조화 필드도 답변의 일부로 평가하되 특정 형식을 선호하지 마세요.",
    text: { format: { type: "json_schema", name: "blind_intent_eval", strict: true, schema: judgeSchema } },
    input: [{ role: "user", content: [{ type: "input_text", text: `정답:\n현재 작업: ${scenario.task}\n마지막 시도: ${scenario.lastAttempt}\n막힌 지점: ${scenario.blocker}\n추정 의도/다음 행동: ${scenario.intent}\n\n출력 A:\n${JSON.stringify(entries.A)}\n\n출력 B:\n${JSON.stringify(entries.B)}` }] }],
  });
  const raw = JSON.parse(response.output_text);
  return flip ? { baseline: raw.B, structured: raw.A, preferred: raw.preferred === "A" ? "structured" : raw.preferred === "B" ? "baseline" : "tie", reason: raw.reason, usage: response.usage } : { baseline: raw.A, structured: raw.B, preferred: raw.preferred === "A" ? "baseline" : raw.preferred === "B" ? "structured" : "tie", reason: raw.reason, usage: response.usage };
}

function total(score) { return score.task + score.causal_chain + score.blocker + score.intent_action + score.groundedness; }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }

async function main() {
  await loadLocalEnv();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const model = process.env.EVAL_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const selectedScenarios = REQUESTED_IDS.size ? scenarios.filter((scenario) => REQUESTED_IDS.has(scenario.id)) : scenarios;
  if (!selectedScenarios.length) throw new Error("EVAL_IDS did not match any scenarios");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Use the machine's installed Chrome so running the evaluation does not
  // require downloading Playwright's separate browser bundle.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const rows = [];
  try {
    for (let run = 1; run <= RUNS; run += 1) {
      for (let index = 0; index < selectedScenarios.length; index += 1) {
        const scenario = selectedScenarios[index];
        process.stdout.write(`[${rows.length + 1}/${selectedScenarios.length * RUNS}] ${scenario.id} ... `);
        const frames = await renderFrames(browser, scenario);
        const baseline = await callModel(client, model, "baseline", frames);
        const structured = await callModel(client, model, "structured", frames);
        const evaluation = await judge(client, model, scenario, baseline, structured, (index + run) % 2 === 0);
        rows.push({ run, id: scenario.id, gold: { task: scenario.task, lastAttempt: scenario.lastAttempt, blocker: scenario.blocker, intent: scenario.intent }, baseline, structured, evaluation });
        process.stdout.write(`baseline ${total(evaluation.baseline)}/10, structured ${total(evaluation.structured)}/10\n`);
      }
    }
  } finally {
    await browser.close();
  }
  const summary = {
    generatedAt: new Date().toISOString(), model, scenarios: selectedScenarios.length, runs: RUNS,
    baseline: {
      score: mean(rows.map((row) => total(row.evaluation.baseline))), latencyMs: mean(rows.map((row) => row.baseline.latencyMs)),
      inputTokens: mean(rows.map((row) => row.baseline.inputTokens)), outputTokens: mean(rows.map((row) => row.baseline.outputTokens)),
    },
    structured: {
      score: mean(rows.map((row) => total(row.evaluation.structured))), latencyMs: mean(rows.map((row) => row.structured.latencyMs)),
      inputTokens: mean(rows.map((row) => row.structured.inputTokens)), outputTokens: mean(rows.map((row) => row.structured.outputTokens)),
    },
    dimensions: Object.fromEntries(["task", "causal_chain", "blocker", "intent_action", "groundedness"].map((key) => [key, {
      baseline: mean(rows.map((row) => row.evaluation.baseline[key])), structured: mean(rows.map((row) => row.evaluation.structured[key])),
    }])),
    preference: { baseline: rows.filter((row) => row.evaluation.preferred === "baseline").length, structured: rows.filter((row) => row.evaluation.preferred === "structured").length, tie: rows.filter((row) => row.evaluation.preferred === "tie").length },
  };
  await writeFile(join(OUTPUT_DIR, "latest.json"), JSON.stringify({ summary, rows }, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
