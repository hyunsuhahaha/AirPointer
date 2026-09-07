# 브라우저 전용 vs 네이티브 앱(AirPointer) 확장 기능

이 프로젝트는 "웹 데모"(`web/`, Next.js)와 "네이티브 컴패니언"(`airpointer/`, AirPointer.exe)
두 갈래로 나뉜다. 이 문서는 코드 기준으로 각 갈래에서 실제로 뭐가 되고 안 되는지, 그리고 왜
안 되는지를 남긴다. PRODUCT.md가 제품 원칙을 다룬다면, 이 문서는 "브라우저 탭만 열려 있을
때 vs AirPointer.exe까지 실행 중일 때" 동작 차이의 근거를 코드 위치와 함께 정리한 것이다.

## 왜 나뉘는가

브라우저 샌드박스가 원천적으로 막는 것 네 가지가 이 경계선을 만든다:

- 탭이 포커스/가시 상태가 아닐 때 키보드 입력을 받을 방법이 없음 (전역 단축키 불가)
- 다른 앱 위에 OS 전체를 덮는 영역 선택 오버레이를 띄울 수 없음. 단, 공유 화면을 웹 미리보기로 보여주고 그 위에서 드래그해 잘라내기는 가능하며 현재 구현되어 있음
- 클립보드를 상시 감시할 방법이 없음 (사용자가 붙여넣기 하는 순간만 접근 가능)
- UI Automation, OCR, 접근성 트리 같은 OS 레벨 API에 접근할 방법이 없음

네이티브 앱은 이 네 가지를 Windows API로 직접 건드리기 때문에 가능한 일이고, 웹 데모는
`getDisplayMedia` / `getUserMedia` / 일반 DOM 이벤트로 갈 수 있는 데까지만 간다.

## 확정된 브라우저 제품 구조: 교육 모드와 작업 모드

순수 브라우저 경험은 입력장치가 아니라 **사용 목적**을 기준으로 두 런타임 모드로 분리한다.

| 모드 | 주 화면 | 사용하는 브라우저 API/엔진 | 사용하지 않는 것 | 목적 |
|---|---|---|---|---|
| 교육 모드 | 카메라 미리보기와 손 인식 피드백 | `getUserMedia`, MediaPipe HandLandmarker | 화면 공유·리플레이·작업 PiP | 손짓을 배우고 직접 성공시켜 보는 교육·체험 |
| 작업 모드 | 공유 화면과 Document PiP | `getDisplayMedia`, 리플레이 버퍼, 자동으로 열리는 PiP와 그 버튼 | 카메라 권한·카메라 스트림·MediaPipe 손 인식·브라우저 단축키 | 개발·문서·운영 중 놓친 상황을 복원해 Agent에 전달 |

작업 모드에서 카메라는 숨겨진 채 유지되는 보조 입력이 아니다. 아예 요청하거나 실행하지 않는다.
교육 모드에서 작업 모드로 전환할 때는 카메라 트랙 종료, `video.srcObject` 해제, HandLandmarker와
관련 Worker/타이머 종료, 카메라 프레임용 Canvas·버퍼 해제까지 완료해야 한다. 이는 단순한 UI
전환이 아니라 메모리와 연산 자원을 분리하는 **서로 다른 런타임 프로필**이다.

작업 모드의 개발·문서·운영은 별도 최상위 모드가 아니라 같은 캡처/PiP 흐름 안의 작업 프로필로
취급한다. 설치 없는 작업 모드의 트리거는 화면 공유와 함께 자동으로 열리는 PiP 버튼이다. 순수
브라우저 단축키 모드는 제공하지 않으며 OS 전역 단축키는 AirPointer.exe가 있을 때만 제공한다.

> **구현 상태:** 위 분리는 확정된 제품 방향이며 아직 코드에 완전히 적용되지 않았다. 현재
> `use-browser-gesture.ts`의 브라우저 손바닥 트리거는 작업 화면과 연결되어 있다. 아래 표는
> 현재 코드의 실제 기능을 기록하므로, 모드 분리 구현 전까지 해당 행을 그대로 유지한다.

## 1. 순수 브라우저만으로 가능한 동작

다운로드나 로컬 프로세스 없이, `web/` 앱만 브라우저에서 열면 되는 것들.

| 동작 | 근거 코드 |
|---|---|
| 화면/창/탭 공유 시작·종료 (`getDisplayMedia`) | `replay-workspace.tsx`의 `startSharing`/`stopSharing` |
| 로컬 순환 버퍼 (1~5분 보관, 250MB 상한, 브라우저 메모리에만 존재, 트리거 전엔 서버로 아무것도 안 나감) | `replay-buffer.ts`의 `BrowserReplayBuffer` |
| 변화 감지 (픽셀 diff → 8×8 타일 스코어링 → MMR 다양성 선택으로 "의미 있는 프레임"만 추림, 네이티브 `screen_buffer.py`의 JS 포팅) | `replay-buffer.ts`의 `ChangeTracker`/`selectEventsDiverse` |
| "방금 뭐가 바뀌었나" 하이라이트 카드 (가장 두드러진 변화의 before/after + 확대 crop) | `replay-buffer.ts`의 `recentHighlight` |
| 현재 화면 즉시 캡처 / 최근 5·15·30·60초 리플레이 캡처 (콘택트시트 생성) | `replay-workspace.tsx`의 `captureFrames` |
| OpenAI Responses API로 화면 분석 (서버가 API 키 보관, `store:false`, 서버 인스턴스별 IP당 분당 20회 제한) | `web/src/app/api/analyze/route.ts` |
| 브라우저 내장 손 제스처: **손바닥 2초 유지 → 최근 구간 전송**만 지원 (MediaPipe WASM, CDN 로드, 웹캠). 현재 구현이며, 목표 구조에서는 교육 모드 전용으로 이동 | `use-browser-gesture.ts` |
| 프롬프트 템플릿 조회/저장/초기화 | `web/src/app/api/prompt-settings/route.ts` |
| 프리뷰 스테이지 드래그 이동/리사이즈, 버퍼 상태 HUD, 실시간 변화 스코어 차트 | `replay-workspace.tsx` UI 상태 (스테이지 박스, HUD 관련 부분) |
| **Document PiP 캡처·대화 창** — 화면 공유 성공 직후 자동으로 열림. 기록 상태와 변화 전후 이미지, 현재/리플레이/영역 분석, 접기·펼치기, 새 대화 | `replay-workspace.tsx`의 `startSharing` + portal + `browser-capture-panel.tsx` |
| 고정한 공유 화면에서 드래그 영역 선택, 방향키 이동·Shift 크기 조절, 취소·확정 후 잘라낸 이미지만 분석 | `RegionCapture`, `cropRegion(..., 0)` — 메인 화면과 PiP 양쪽 |
| 새 화면을 보내지 않는 텍스트 후속 질문 | `mode: text`, 빈 `frames`, 최근 대화 최대 8개 메시지/6,000자, 질문 500자 |
| 모든 브라우저 트리거의 중복 분석 방지 | `analysisInFlight` + PiP 입력/버튼 잠금 |
| Screen Memory 작업대: OCR 화면 검색, DVR 시간여행, 북마크·태그, 활동 요약, Markdown 리포트 | `screen-memory-workbench.tsx`, `screen-memory.ts`; IndexedDB에 자동 기록 최대 500개와 북마크 보관 |

## 2. 네이티브 앱(AirPointer.exe) 다운로드 시 추가되는 동작

`airpointer://` 프로토콜로 실행되는 로컬 프로세스가 있어야만 되는 것들.

| 동작 | 근거 |
|---|---|
| 전역 단축키 트리거 (`Ctrl+Alt+S/D/R`, 웹에서 설정한 값이 우선) | README "시작 모드: 제스처 / 단축키"; `use-companion-gesture.ts`가 설정을 컴패니언 서버로 push |
| 실제 마우스 클릭 드래그로 영역 지정·확정 (주먹→손바닥으로 진입, 오른쪽 클릭 취소) | README "현재 범위" |
| Claude Desktop으로 전송 (클립보드에 넣고 실제 Ctrl+V/Enter를 보내는 방식) | README "Agent Replay"; `replay-workspace.tsx`의 `postToCompanion` (companionToken 필요) |
| 캡처 순간 화면에 선택된 텍스트를 UI Automation TextPattern(또는 안전장치를 거친 Ctrl+C 폴백)으로 읽어 컨텍스트에 첨부 | README "선택 텍스트" |
| 최근 30초 복사 이력(A→B→C)을 컨텍스트에 첨부 (기본 꺼짐, `clipboard_history_enabled`) | README "복사 이력" |
| 최근 30초 창 전환·클릭 이력을 컨텍스트 한 줄로 첨부 | README "Agent Replay" 본문 |
| 리플레이 변화 지점의 실제 UI 요소 이름(UI Automation) 또는 온디바이스 OCR 텍스트를 위치 힌트로 첨부 | `docs/replay-change-detection.md`; README 본문 |
| Codex Desktop 대화 목록 조회/전환 후 전송 | README "웹 버전 실행 및 배포" |
| 브라우저 Screen Memory를 SQLite와 이미지 파일로 동기화하고 토큰 보호 HTTP API 제공 | `memory_store.py`, `companion_bridge.py`, `/api/companion/memory` |
| AirPointer 자체 화면 캡처를 화면 변화·15초 간격으로 자동 OCR해 같은 SQLite에 적재 (`source: native`) | `memory_ingest.py`, `ocr_fallback.recognize_frame_text` |
| Codex/Claude MCP 설정에 Screen Memory 서버를 자동 등록 (기존 등록·설정은 보존, `.bak` 백업) | `mcp_install.py` |

## Screen Memory API/MCP 지원 범위

| 데이터 경로 | Codex | Claude | 현재 상태 |
|---|---:|---:|---|
| 브라우저 IndexedDB만 사용 | MCP 검색 불가 | MCP 검색 불가 | 웹 작업대 안에서는 검색·시간여행·북마크·요약·리포트 모두 사용 가능 |
| 브라우저 + AirPointer Companion + SQLite | MCP 검색 가능 | MCP 검색 가능 | 완전 연결됨. Companion을 나중에 연결하면 최근 로컬 기록 최대 120개 재동기화 |
| 네이티브 AirPointer 자체 캡처 버퍼(AirPointer 실행 중) | 기존 화면 전송 + MCP 검색 가능 | 기존 화면 전송 + MCP 검색 가능 | 15초 간격 또는 화면 변화 시 자동으로 SQLite에 적재됨(`memory_ingest.py`). 웹 작업대에는 나타나지 않음 |
| 샘플 체험 기록 | MCP 검색 불가 | MCP 검색 불가 | 실제 기록과 섞이지 않도록 브라우저에만 저장 |

`python -m airpointer.mcp_server`는 특정 Agent 전용이 아닌 표준 stdio MCP 서버다. 따라서 Codex와 Claude 양쪽에 등록할 수 있지만, 각 클라이언트 설정에 명령을 별도로 추가해야 한다(`python -m airpointer.mcp_install`로 자동화 가능). 이 MCP는 `%LOCALAPPDATA%\AirPointer\screen-memory`의 SQLite를 직접 읽으며 HTTP 연결 토큰은 사용하지 않는다. 자세한 API와 도구 목록은 [screen-memory.md](screen-memory.md) 참고.

## 3. 코드는 있지만 연결되지 않은 것 (browser-only로 완성 가능)

새 브라우저 API가 필요한 게 아니라, 이미 짜여 있는 로직을 그냥 안 쓰고 있는 경우.

- **주먹→손바닥 "영역 선택" 커맨드**: `gesture.ts`의 `GestureCommandDetector`가 `start-region`을
  이미 emit하지만, `use-browser-gesture.ts`는 `send-replay`만 처리한다 (해당 파일 주석에
  기존 영역 선택 미연결 설명이 남아 있음. 현재 수동 미리보기 영역 선택은 별도 UI로 구현됨).
- **검지 드래그로 영역 지정 + 주먹으로 확정**: `gesture.ts`의 `RegionSelectionDetector` 클래스가
  이미 완성돼 있다 (마우스 없이 손끝 포인팅만으로 사각형을 그리는 로직). 지금은 브라우저 쪽
  어디에서도 인스턴스화되지 않는다.

## 4. 브라우저만으로 추가 확장 가능한 후보 (미구현, 제안)

현재 코드에는 없지만 브라우저 API만으로 원리상 가능한 트리거들. "탭이 안 보여도 동작하는가"
기준으로 정렬.

| 트리거 | 방식 | 탭이 안 보여도 동작? |
|---|---|---|
| 하드웨어 미디어 키 | `navigator.mediaSession.setActionHandler`, 무음 오디오/비디오 재생 필요 | 일부 OS/브라우저 조합에서만 |
| 게임패드 버튼 | Gamepad API | 탭이 보이는 상태 필요(브라우저가 백그라운드 탭 폴링을 스로틀) |
| 소리(박수 등) 감지 | Web Audio API로 마이크 볼륨 스파이크 감지 | 오디오 스트림 자체는 백그라운드 탭에서도 유지됨 |
| 음성 명령 | Web Speech API `SpeechRecognition` | 탭 필요, 게다가 Chrome 구현은 보통 음성을 구글 서버로 전송 (로컬 손 제스처 대비 프라이버시 트레이드오프) |
| 윙크/눈감았다뜨기, 시선 응시 | HandLandmarker와 같은 방식으로 MediaPipe FaceLandmarker 추가 | 탭 필요 — 현재 저장소에 윙크/시선 모듈은 없으므로 별도 구현 필요 |

> 탭 포커스 시 키보드 단축키와 Document Picture-in-Picture 캡처 버튼은 구현 완료 — 위
> "1. 순수 브라우저만으로 가능한 동작" 표 참고.

## 현재 PiP의 경계와 검증 범위

- PiP는 메인 페이지의 React 상태를 portal로 공유한다. 별도 설치나 로컬 서버가 방문자 PC에 필요하지 않다.
  배포 서버와 인터넷, 서버 측 OpenAI API 키는 필요하다.
- 작은 버튼 창에서 분석하면 대화를 펼치며, 버튼만 남기기로 다시 접을 수 있다. 브라우저가 창 크기를
  제한할 수 있으므로 요청한 크기가 항상 그대로 적용된다고 보장하지 않는다.
- 변화 전후 이미지는 펼침 항목에서 확인한다. 자동 변화 감지 표시를 끄면 PiP에서도 숨긴다.
- 영역 선택은 현재 공유 화면을 고정한 미리보기에서 수행한다. 다른 앱의 실제 창 위에서 드래그하거나
  제스처로 영역을 지정하는 기능은 아니다. 선택 결과는 주황색 테두리로 확인하고 명시적으로 전송한다.
- PiP 대화의 후속 요청에는 과거 이미지가 아닌 이전 대화 텍스트만 포함된다. 화면 캡처 버튼을 다시
  누르면 새 이미지를 함께 보낸다. 질문만 보내기는 이전 AI 답변과 비어 있지 않은 질문이 있어야 한다.
- 공유 중지·새 공유·PiP 닫기는 PiP 대화와 선택 상태를 초기화한다. 메인 페이지를 닫으면 PiP도 닫힌다.
- 메인 탭이 숨겨진 상태의 손 추적(`requestAnimationFrame`)과 샘플링 타이머는 브라우저 정책의
  영향을 받는다. PiP가 떠 있다는 이유만으로 백그라운드 제스처나 고정 샘플 주기를 보장하지 않는다.
- 자동 UI 검증은 실제 Document PiP API와 보조 테스트 프레임에 합성 화면·모의 AI 응답을 연결했다.
  현재 캡처, 576×324 영역 crop, 리플레이, 이미지 0개 후속 질문, 분석 중 잠금, 실패 후 재시도,
  공유 중지 초기화, PiP 닫기 상태 동기화를 확인했다. 380px PiP와 390px 모바일 레이아웃도 확인했다.
  실제 공유 권한 대화상자, OS별 항상 위 배치 및 실제 모델 응답은 별도 실기 검증 대상이다.


### 브라우저 분석 메타데이터 (2026-09-07)

`/api/analyze`는 이미지와 함께 `metadata`를 받고, 검증한 내용을 실제 모델 입력 텍스트에 포함한다. 응답의 `captureContext`는 모델에 포함한 동일한 텍스트이며 PiP 대화와 메인 결과의 **전송 정보**에서 펼쳐 볼 수 있다.

- 기준 시각(UTC), 공유 종류(탭/창/모니터 또는 unknown), 원본 해상도, 요청 구간.
- 리플레이 모음의 각 표본이 기준 시각보다 몇 초 전인지. 요청 구간과 실제 표본 범위를 구분한다.
- 영역 선택은 고정한 원본의 시각·해상도를 유지하고 원본 대비 정규화된 좌/상/우/하 좌표를 전달한다.
- 기존 변화 확대 이미지는 별도 보조 이미지로 표시하며 정확한 시각이 없는 경우 미확인이라고 명시한다.
- 외부 앱의 실제 클릭·버튼명·선택 텍스트는 수집하지 않는다. 선택 영역과 화면 변화를 클릭으로 해석하지 않도록 모델에도 명시한다.
- 텍스트 후속 질문에는 새 이미지나 새 캡처 메타데이터를 붙이지 않는다.

배포 후 기존 탭은 이전 JavaScript를 계속 실행할 수 있다. 메인 페이지를 새로고침한 뒤 PiP를 다시 열어야 최신 UI와 전송 경로를 사용한다.
