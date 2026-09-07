# 브라우저 전용 vs 네이티브 앱(AirPointer) 확장 기능

이 프로젝트는 "웹 데모"(`web/`, Next.js)와 "네이티브 컴패니언"(`airpointer/`, AirPointer.exe)
두 갈래로 나뉜다. 이 문서는 코드 기준으로 각 갈래에서 실제로 뭐가 되고 안 되는지, 그리고 왜
안 되는지를 남긴다. PRODUCT.md가 제품 원칙을 다룬다면, 이 문서는 "브라우저 탭만 열려 있을
때 vs AirPointer.exe까지 실행 중일 때" 동작 차이의 근거를 코드 위치와 함께 정리한 것이다.

## 왜 나뉘는가

브라우저 샌드박스가 원천적으로 막는 것 네 가지가 이 경계선을 만든다:

- 탭이 포커스/가시 상태가 아닐 때 키보드 입력을 받을 방법이 없음 (전역 단축키 불가)
- OS 마우스 커서를 조작할 방법이 없음 (실제 클릭 드래그로 영역 지정 불가)
- 클립보드를 상시 감시할 방법이 없음 (사용자가 붙여넣기 하는 순간만 접근 가능)
- UI Automation, OCR, 접근성 트리 같은 OS 레벨 API에 접근할 방법이 없음

네이티브 앱은 이 네 가지를 Windows API로 직접 건드리기 때문에 가능한 일이고, 웹 데모는
`getDisplayMedia` / `getUserMedia` / 일반 DOM 이벤트로 갈 수 있는 데까지만 간다.

## 1. 순수 브라우저만으로 가능한 동작

다운로드나 로컬 프로세스 없이, `web/` 앱만 브라우저에서 열면 되는 것들.

| 동작 | 근거 코드 |
|---|---|
| 화면/창/탭 공유 시작·종료 (`getDisplayMedia`) | `replay-workspace.tsx`의 `startSharing`/`stopSharing` |
| 로컬 순환 버퍼 (1~5분 보관, 250MB 상한, 브라우저 메모리에만 존재, 트리거 전엔 서버로 아무것도 안 나감) | `replay-buffer.ts`의 `BrowserReplayBuffer` |
| 변화 감지 (픽셀 diff → 8×8 타일 스코어링 → MMR 다양성 선택으로 "의미 있는 프레임"만 추림, 네이티브 `screen_buffer.py`의 JS 포팅) | `replay-buffer.ts`의 `ChangeTracker`/`selectEventsDiverse` |
| "방금 뭐가 바뀌었나" 하이라이트 카드 (가장 두드러진 변화의 before/after + 확대 crop) | `replay-buffer.ts`의 `recentHighlight` |
| 현재 화면 즉시 캡처 / 최근 5·15·30·60초 리플레이 캡처 (콘택트시트 생성) | `replay-workspace.tsx`의 `captureFrames` |
| OpenAI Responses API로 화면 분석 (서버가 API 키 보관, `store:false`, IP당 분당 5회 제한) | `web/src/app/api/analyze/route.ts` |
| 브라우저 내장 손 제스처: **손바닥 2초 유지 → 최근 구간 전송**만 지원 (MediaPipe WASM, CDN 로드, 웹캠) | `use-browser-gesture.ts` |
| 프롬프트 템플릿 조회/저장/초기화 | `web/src/app/api/prompt-settings/route.ts` |
| 프리뷰 스테이지 드래그 이동/리사이즈, 버퍼 상태 HUD, 실시간 변화 스코어 차트 | `replay-workspace.tsx` UI 상태 (스테이지 박스, HUD 관련 부분) |
| 탭 포커스 시 키보드 단축키 (`Alt+Shift+S`/`Alt+Shift+D`, 커스텀 가능) — 알트탭하면 못 받음 | `replay-workspace.tsx`의 `browserHotkeyEnabled` 이펙트, `comboFromKeyEvent` |
| **Document Picture-in-Picture 캡처 버튼** — 항상 위에 뜨는 작은 창, 다른 앱에 포커스가 가 있어도 그 창의 버튼은 눌림 (Chrome/Edge 116+ 필요) | `replay-workspace.tsx`의 `openCapturePip`/`closeCapturePip` |

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

## 3. 코드는 있지만 연결되지 않은 것 (browser-only로 완성 가능)

새 브라우저 API가 필요한 게 아니라, 이미 짜여 있는 로직을 그냥 안 쓰고 있는 경우.

- **주먹→손바닥 "영역 선택" 커맨드**: `gesture.ts`의 `GestureCommandDetector`가 `start-region`을
  이미 emit하지만, `use-browser-gesture.ts`는 `send-replay`만 처리한다 (해당 파일 주석에
  "region selection is a separate... feature that nothing in the web app implements yet"라고
  명시).
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
| 윙크/눈감았다뜨기, 시선 응시 | HandLandmarker와 같은 방식으로 MediaPipe FaceLandmarker 추가 | 탭 필요 — 네이티브 프로토타입에 이미 있는 wink/gaze 모듈(PRODUCT.md "Evidence on Hand")의 브라우저 포팅 |

> 탭 포커스 시 키보드 단축키와 Document Picture-in-Picture 캡처 버튼은 구현 완료 — 위
> "1. 순수 브라우저만으로 가능한 동작" 표 참고.
