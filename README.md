# AirPointer

## Portable Windows companion

Build the no-installer companion with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

The result is `portable\AirPointer.exe`. Run it once to register the per-user
`airpointer://` protocol. After that, the website's gesture switch requests
camera access and launches the transparent companion overlay with
`airpointer://start`; turning the switch off sends `airpointer://stop`.

> 웹 출품작 이름: **방금그거뭐였지**

Windows용 웹캠 제스처 캡처 + Agent Replay 도구입니다. OS 마우스 커서는 조작하지 않습니다.
설정창에는 손 위치를 확인할 수 있는 미러 카메라 미리보기가 표시됩니다.
`Agent Replay` 탭에서는 최근 화면을 최대 5분 동안 로컬 순환 버퍼에만 보관합니다. 주먹→손바닥으로
영역 선택을 시작하면 화면이 잠기고, 이후에는 실제 마우스로 클릭 드래그하여 영역을 지정하고
놓으면 확정됩니다(오른쪽 클릭으로 취소). 손바닥을 2초 유지하면 최근 구간의 핵심 프레임을
선택한 Codex 작업으로 전달합니다.

## 실행

설치가 끝난 PC에서는 `AirPointer.bat`을 더블클릭하면 콘솔 창 없이 실행됩니다.

Python 3.11 권장(MediaPipe 호환 범위가 가장 안정적):

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m airpointer.main
```

## 웹 버전 실행 및 배포

`web/`은 AI Championship 2026 제출용 Next.js 앱입니다. 브라우저의 화면 공유로 최근 1~5분을
메모리 순환 버퍼에 보관합니다. 선택한 Codex 작업으로 현재 화면 또는 최근 5/15/30/60초의 원본
Replay Capsule을 보내는 Agent 전송과, Responses API로 화면을 분석하는 기능은 서로 분리되어 있습니다.
카메라를 허용하면 손바닥 2초 유지로 최근 구간을 고정합니다. 이후 추천 질문을 고르거나 직접
프롬프트를 입력해 확인해야 선택한 Codex 작업으로 화면 맥락과 질문이 함께 전송됩니다.

```powershell
cd web
Copy-Item .env.example .env.local
# .env.local의 OPENAI_API_KEY를 실제 키로 변경
npm install
npm run dev
```

Agent 전송에는 API 키 대신 로그인된 Codex CLI가 필요합니다. Codex 데스크톱 앱이 설치돼 있어도
`codex` 실행 파일이 PATH에 없을 수 있습니다(버전별 해시 폴더 아래 설치되는 경우). 이 경우
`web/.env.local`에 `CODEX_EXECUTABLE=<codex.exe 전체 경로>`를 추가하세요
(예: `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`). 웹 화면에서 `Codex Agent` 작업을
선택한 다음 화면 공유와 제스처를 켜세요. 선택한 작업이 실행 중이면 캡처를 유지한 채 자동으로
재시도합니다. Replay Capsule에는 개요 이미지와 타임스탬프가 있는 원본 WebM 조각이 들어가며,
Agent는 `-0.5초`처럼 원하는 과거 시점을 전체 해상도 프레임으로 다시 조회할 수 있습니다.
`OPENAI_API_KEY`는 별도 `OpenAI Image Analysis` 기능에서만 사용합니다.

Vercel에서는 Root Directory를 `web`으로 지정하고 `OPENAI_API_KEY`를 환경 변수로 추가하면 됩니다.
화면 공유와 카메라는 보안 컨텍스트가 필요하므로 배포 환경에서는 HTTPS를 사용해야 합니다.

앱과 대상 프로그램의 권한 수준이 같아야 화면 캡처 오버레이의 클릭이 정상 동작합니다.

## 현재 범위

- 주 모니터 한 대
- 첫 번째로 감지된 손 한 개
- MJPG 640×360@60 캡처와 320×180 손 추적
- MediaPipe handedness로 오른손만 선택해 왼손으로 추적 대상이 바뀌는 현상 방지
- 1초 MP4 조각으로 구성된 로컬 화면 순환 버퍼(기본 3분, 250MB 상한)
- 주먹→손바닥으로 영역 선택 모드 진입, 이후 실제 마우스 클릭 드래그로 영역 지정 및 확정(오른쪽 클릭 취소)
- 손바닥 유지 최근 5/15/30/60초 전송
- Codex 작업 선택과 로컬 이미지 첨부, 바쁜 작업 자동 대기 및 실패 재시도

## Agent Replay

네이티브 앱은 자체적으로 Codex App Server를 띄우지 않고, `web/`이 이미 사용 중인 로컬
Codex 연결(`http://127.0.0.1:3000/api/agent`)을 그대로 사용합니다. 그래서 **`npm run dev`로
web 앱이 켜져 있어야** `Agent Replay` 탭에서 작업 목록을 불러오고 전송할 수 있습니다
(AirPointer.exe가 매 빌드마다 서명 없는 새 바이너리가 되면서 Windows 스마트 앱 컨트롤이 자식
프로세스 실행을 막는 경우가 있어, 그 경로를 아예 쓰지 않도록 했습니다). `Agent Replay` 탭을
열어 `Refresh Tasks`로 작업을 불러온 뒤 전송 대상을 선택하세요. 화면 버퍼는 AirPointer 추적을
시작할 때 켜지고 중지 또는 종료 시 삭제됩니다. Agent에는 MP4 원본 대신 시간순 핵심 PNG 프레임
6장이 전달됩니다. 화면 우측 상단의 `BUFFER` HUD로 기록 여부를 항상 확인할 수 있습니다.
