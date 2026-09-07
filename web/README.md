# 방금그거뭐였지 — 브라우저 데모

심사위원이 설치 없이 화면 공유 → 최근 화면 분석 → 후속 질문을 체험하는 Next.js 앱입니다.
`npm install`, `.env.example`을 `.env.local`로 복사하고 서버용 `OPENAI_API_KEY`를 설정한 뒤
`npm run dev`로 실행합니다. 배포 시 `web`을 프로젝트 루트로 지정하고 HTTPS를 사용합니다.

- 기본 브라우저 모드는 로컬 프로그램이나 Codex 로그인 없이 서버 AI 분석을 사용합니다.
- Document PiP: 기록 상태, 변화 전후 이미지, 현재 화면/리플레이/영역 캡처, 텍스트 후속 질문.
- 영역 선택: 고정한 미리보기 위 드래그 또는 방향키(Shift: 크기), 확인 후 잘라낸 이미지만 전송.
- 질문만 보내기: 새 캡처 없이 이전 대화 텍스트로 답변. 최대 8개 메시지/6,000자, 질문 500자.
- 화면 분석은 최근 N초의 대표 프레임 최대 6장을 기본으로 사용합니다. 사용자가 표시한 리플레이 북마크는 N초 범위 밖에 있어도 기본 6장을 대체하지 않고 추가되며, 북마크는 최대 6개입니다. 서버 분석은 `store:false`와 인스턴스별 메모리 기반 IP당 분당 20회 제한을 사용합니다.
- PiP 대화는 공유 세션에 종속되며 공유 중지·새 공유·PiP 닫기 시 초기화됩니다.
- 단축키는 메인 탭 포커스가 필요하며 카메라 제스처의 백그라운드 실행은 보장하지 않습니다.
- Screen Memory 작업대는 변화 화면을 IndexedDB에 저장하고 로컬 OCR 검색, DVR 시간여행, 북마크·태그, 활동 요약, Markdown 리포트를 제공합니다. 자동 기록 최대 500개와 정리 대상에서 제외되는 북마크를 보관합니다.
- AirPointer Companion이 연결되면 브라우저 Screen Memory가 로컬 SQLite로 동기화되고 HTTP API와 Codex/Claude용 stdio MCP에서 검색할 수 있습니다. 순수 브라우저 IndexedDB, 샘플 체험 기록, 네이티브 자체 캡처 버퍼는 MCP가 직접 읽지 않습니다.

`browser-capture-panel.tsx`가 PiP/영역 UI를, `replay-workspace.tsx`가 공유 상태와 분석 요청을,
`replay-buffer.ts`가 순환 버퍼와 변화 선택을 담당합니다. `screen-memory-workbench.tsx`와
`screen-memory.ts`는 검색 작업대와 IndexedDB를 담당합니다. PiP는 React portal로 상태를 공유합니다.
`api/analyze/route.ts`와 `analysis-payload.ts`는 이미지 분석과 텍스트 후속 질문을 검증합니다.

검증: `npm test`, `npm run lint`, `npm run build`, `npx playwright test tests/screen-memory.e2e.ts`.
실제 Codex 전송 테스트와 실제 화면 공유 권한 테스트는 기본으로 건너뜁니다.
브라우저 UI 검증은 실제 Document PiP API에 합성 영상·모의 AI 응답을 연결해 수행했습니다.
실제 OS의 화면 공유 권한·항상 위 배치와 실제 모델 응답 품질은 별도 확인 대상입니다.

전체 기능 모드의 Codex CLI 연결·AirPointer 전송은 선택적 로컬 기능입니다.
세부 경계는 [브라우저와 네이티브 기능](../docs/browser-vs-native-capabilities.md)을 참고하세요.
Screen Memory API와 MCP 도구별 범위는 [Screen Memory 사용법](../docs/screen-memory.md)을 참고하세요.
