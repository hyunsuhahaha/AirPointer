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

Windows용 웹캠 공간 포인터입니다. 검지 관절에서 끝으로 향하는 방향을 화면에 투영하고 엄지와 검지를
붙여 클릭/드래그하며, Windows UI Automation이 찾은 가까운 버튼·입력창·링크를 잠급니다.
설정창에는 손 위치를 확인할 수 있는 미러 카메라 미리보기가 표시됩니다.
기본값은 추적 HUD만 표시하는 안전한 미리보기 모드이며, `Mouse Control`을 켜야 실제 마우스가 움직입니다.
`Agent Replay` 탭에서는 최근 화면을 최대 5분 동안 로컬 순환 버퍼에만 보관합니다. 주먹→손바닥으로
영역 선택을 시작하고 검지로 크기를 조절한 뒤 주먹으로 확정하면 선택 영역을, 손바닥을 2초
유지하면 최근 구간의 핵심 프레임을 선택한 Codex 작업으로 전달합니다.

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

Agent 전송에는 API 키 대신 로그인된 Codex CLI가 필요합니다. 웹 화면에서 `Codex Agent` 작업을
선택한 다음 화면 공유와 제스처를 켜세요. 선택한 작업이 실행 중이면 캡처를 유지한 채 자동으로
재시도합니다. Replay Capsule에는 개요 이미지와 타임스탬프가 있는 원본 WebM 조각이 들어가며,
Agent는 `-0.5초`처럼 원하는 과거 시점을 전체 해상도 프레임으로 다시 조회할 수 있습니다.
`OPENAI_API_KEY`는 별도 `OpenAI Image Analysis` 기능에서만 사용합니다.

Vercel에서는 Root Directory를 `web`으로 지정하고 `OPENAI_API_KEY`를 환경 변수로 추가하면 됩니다.
화면 공유와 카메라는 보안 컨텍스트가 필요하므로 배포 환경에서는 HTTPS를 사용해야 합니다.

편 손의 검지를 움직이면 카메라 왼쪽·오른쪽이 화면 양 끝에 대응합니다. 설정의 `Mapping`에서
`Relative hand`를 고르면 터치패드처럼 상대 이동할 수도 있습니다. 짧게 pinch 후 놓으면 클릭, pinch를 유지하거나
움직이면 드래그가 됩니다. 주먹은 커서를 놓고 손 위치를 다시 잡는 clutch이며, 손을 내리면
제어가 해제됩니다. 상대 모드에서도 손을 다시 올린 첫 프레임은 검지의 절대 위치로 재배치된 뒤
상대 이동을 이어갑니다. 앱과 대상 프로그램의 권한 수준이 같아야 UI Snap과 입력이 정상 작동합니다.

## 현재 범위

- 주 모니터 한 대
- 첫 번째로 감지된 손 한 개
- 1€ Filter를 사용한 검지 절대 포인팅(기본값), 선택 가능한 상대 이동
- 카메라 프레임 사이를 240Hz 고해상도 타이머로 보간하는 커서 출력
- MJPG 640×360@60 캡처와 320×180 손 추적
- 깊이(z)를 포함한 3D 손가락 펴짐 판정으로 카메라 정면 포인팅 지원
- 오른쪽 60%에서 최초 인식 후에는 화면 전체로 이동 가능한 시작 게이트
- MediaPipe handedness로 오른손만 선택해 왼손으로 추적 대상이 바뀌는 현상 방지
- 손 크기와 무관한 3D 단위 방향 포인팅 및 Snap 클릭 오차의 세션 자동 보정
- pinch 진입/해제 hysteresis와 captured drag
- 비동기 UI hover lock, pinch 확정 시 1회 snap
- 접근성 트리를 제공하는 Windows 앱과 웹 콘텐츠의 UI Snap
- 1초 MP4 조각으로 구성된 로컬 화면 순환 버퍼(기본 3분, 250MB 상한)
- 주먹→손바닥 영역 선택, 검지 크기 조절 및 주먹 확정 캡처, 손바닥 유지 최근 5/15/30/60초 전송
- Codex App Server 작업 선택과 `localImage` 입력, 바쁜 작업 자동 대기 및 실패 재시도

## Agent Replay

Codex CLI가 설치되고 로그인되어 있어야 합니다. `Agent Replay` 탭을 열어 `Refresh Tasks`로 작업을
불러온 뒤 전송 대상을 선택하세요. 화면 버퍼는 AirPointer 추적을 시작할 때 켜지고 중지 또는 종료 시
삭제됩니다. Agent에는 MP4 원본 대신 시간순 핵심 PNG 프레임 6장이 전달됩니다. 화면 우측 상단의
`BUFFER` HUD로 기록 여부를 항상 확인할 수 있습니다.
