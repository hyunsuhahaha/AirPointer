# 방금그거뭐였지

내 상황을 AI에게 매번 설명하지 않아도 되는 화면 맥락 도구입니다. 화면 공유를 시작하면 최근 장면을 짧은 순환 버퍼에 보관하고, 작은 창에서 AI 내보내기를 누르면 직전 화면과 변화 기록을 에이전트가 읽을 수 있는 파일로 만듭니다.

## 원티드 AI 공모전 체험

제출용 핵심 경로는 설치가 필요 없는 `web/`입니다. 화면 공유 권한과 데스크톱 Chrome 또는 Edge가 필요합니다. 기본 내보내기에는 AI API 키가 필요하지 않습니다.

1. 웹에서 화면 공유를 시작하고 화면·창·탭 중 하나를 고릅니다.
2. 항상 위에 뜬 작은 창에서 버퍼 길이와 에이전트가 볼 최근 구간, `전체 접근` 또는 `파일 첨부`를 고르고 **AI 내보내기**를 누릅니다.
3. 전체 접근이면 브라우저 탭에 접근 가능한 에이전트에게 복사된 프롬프트를 붙여넣습니다. 에이전트는 탭의 `window.whatwasContext`에서 기록 목록·문서·이미지·영상을 직접 읽습니다. 파일 첨부의 기본 형식은 `Export-*` 폴더 안의 `context.md + 원본 이미지 6~12장`이며, PDF 한 개도 선택할 수 있습니다.

화면 공유 전에는 **30초 체험하기**로 실제 작업 녹화에서 같은 흐름을 시험할 수 있습니다. 최근 1·3·5분은 브라우저 메모리의 순환 버퍼에 남고, 공유를 중지하면 비워집니다. 전체 접근에서는 다운로드가 없고, 에이전트가 기록 탭에서 JavaScript를 실행할 수 있어야 합니다. 탭을 닫거나 화면 공유를 멈추면 접근이 끝납니다. 원본 파일 폴더 형식은 최초 한 번 상위 폴더를 선택하면 권한을 기억해 이후 `Export-*` 폴더를 그 안에 만듭니다. Explorer 자동 열기·파일 전체 선택은 일반 웹페이지에서 제공하지 않습니다.

## 웹 실행

```powershell
cd web
npm install
npm run dev
```

Vercel 배포 시 Root Directory는 `web`으로 지정하고 프로젝트 Storage에서 **Private Blob** 저장소를 연결합니다. Agent Link는 20분 동안 유효하며 문서와 선별 화면은 앱의 토큰 URL을 통해서만 제공됩니다. 실제 화면 공유는 HTTPS 또는 로컬 환경에서 사용합니다.

## 선택 사항: Windows 앱

Windows 앱은 브라우저 밖에서 전역 단축키로 캡처할 때만 필요합니다. 기본값은 `Ctrl+Alt+S`(현재 화면), `Ctrl+Alt+D`(최근 리플레이), `Ctrl+Alt+R`(영역 선택)입니다. 캡처는 로컬 순환 버퍼에서 준비하고 사용자가 고른 Codex 또는 Claude Desktop 대화에 전달합니다.

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python airpointer_launcher.py
```

Portable EXE는 `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1`로 빌드합니다. `portable\AirPointer.exe`를 한 번 실행하면 사용자별 `airpointer://` 프로토콜이 등록됩니다.

자세한 화면 기록과 Agent 연결 범위는 [Screen Memory](docs/screen-memory.md)와 [브라우저·Windows 기능 비교](docs/browser-vs-native-capabilities.md)에 있습니다.
