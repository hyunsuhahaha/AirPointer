# 방금그거뭐였지 — 브라우저 데모

심사위원이 설치 없이 화면 공유 → 최근 화면 선택 → 기존 AI에 전달을 체험하는 Next.js 앱입니다.
`npm install` 후 `npm run dev`로 실행합니다. 배포 시 `web`을 프로젝트 루트로 지정하고 HTTPS를
사용합니다. Agent Link를 사용하려면 Vercel Private Blob을 연결합니다. 기본 전달 흐름에는
AI API 키가 필요하지 않습니다.

## 현재 전달 모드

- **Manual**: 대표 화면을 먼저 보여주고 `…`로 사이 화면을 펼칩니다. 선택은 0장에서 시작합니다.
  이미지는 브라우저의 기본 이미지 드래그로 AI 앱이나 브라우저 입력창에 전달하며, 확대 보기,
  선택한 여러 장 다운로드, 현재 기준 갱신을 지원합니다.
- **Agent Link**: 맥락 문서·이벤트 JSON·선별 이미지를 Private Blob에 저장하고 20분짜리 토큰
  URL을 만듭니다. localhost나 대상 AI의 브라우저 확장에 의존하지 않습니다.
- **Local Folder**: File System Access API로 사용자가 허용한 위치에 `Context-*` 폴더를 만들고
  실제 경로가 포함된 프롬프트를 제공합니다.

`agent-export-panel.tsx`가 Document PiP의 세 전달 모드와 Manual 타임라인을 담당합니다.
`replay-workspace.tsx`가 화면 공유와 PiP 상태를, `replay-buffer.ts`가 메모리 순환 버퍼와 변화
선택을 담당합니다. `browser-agent-export.ts`는 세 경로가 공유하는 문서·이벤트·화면 묶음을
만들고, `agent-link.ts`와 `export-directory.ts`가 각각 URL과 폴더 전달을 처리합니다.

검증 명령:

```powershell
npm test
npm run lint
npm run build
npx playwright test tests/agent-export.e2e.ts
```

Manual E2E는 합성 `DragEvent`가 아니라 실제 마우스 이동으로 JPEG `data:` 이미지가 브라우저
입력창에 삽입되는지 검사합니다. 실제 OS 화면 공유 권한과 Document PiP의 항상 위 배치는 지원
브라우저에서 별도로 확인합니다. 세부 경계는
[브라우저와 Windows 앱 기능 비교](../docs/browser-vs-native-capabilities.md)를 참고하세요.
