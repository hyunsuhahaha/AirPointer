# Screen Memory 사용법

AirPointer의 Screen Memory는 음성을 수집하지 않습니다. 공유 중 화면이 의미 있게 바뀌거나 15초가 지나면 브라우저에 장면을 저장하고, 로컬 OCR로 화면 문구를 검색 가능하게 만듭니다.

## 처음 쓰는 순서

1. 웹 상단에서 **화면 공유 시작**을 누릅니다.
2. `LOCAL SCREEN MEMORY` 영역의 여섯 버튼에서 원하는 기능을 고릅니다.
   - **화면 검색**: 오류 문구, 파일명, 버튼 이름을 검색합니다.
   - **시간여행**: 슬라이더와 필름스트립으로 이전 장면을 훑습니다.
   - **북마크·태그**: 중요한 장면에 이름과 태그를 붙여 영구 보관합니다.
   - **활동 요약**: 활동 시간, 변화 장면, 북마크, 태그를 집계합니다.
   - **개발 리포트**: 오류 후보와 북마크를 재현용 Markdown으로 만듭니다.
   - **Agent API**: Full Access의 SQLite 기록을 Codex 등 로컬 Agent에서 검색합니다.
3. 화면 공유 없이 확인하려면 **샘플 개발 기록으로 체험**을 누릅니다.

브라우저 모드는 IndexedDB에 자동 기록 최대 500개와 사용자가 표시한 북마크를 보관합니다. 북마크는 자동 기록 정리 대상에서 제외됩니다. Full Access가 연결되어 있으면 같은 기록을 `%LOCALAPPDATA%\AirPointer\screen-memory`의 SQLite와 이미지 파일에도 동기화하며, 나중에 Companion을 연결해도 브라우저의 최근 기록 최대 120개를 다시 채웁니다.

## 지원 범위

MCP는 브라우저 IndexedDB를 직접 읽지 않습니다. Python MCP 서버와 로컬 HTTP API는 모두 Full Access의 SQLite를 기준으로 동작합니다.

| 기록 또는 실행 환경 | 웹 작업대 | SQLite 동기화 | 로컬 HTTP API | Codex MCP | Claude MCP |
|---|---:|---:|---:|---:|---:|
| 브라우저 화면 공유만 사용 | 지원 | 미지원 | 미지원 | 미지원 | 미지원 |
| 브라우저 화면 공유 + AirPointer Companion 연결 | 지원 | 지원 | 지원 | 지원 | 지원 |
| Companion을 나중에 연결 | 지원 | 최근 기록 최대 120개 재동기화 | 동기화 후 지원 | 동기화 후 지원 | 동기화 후 지원 |
| 네이티브 AirPointer 자체 캡처·리플레이 (AirPointer 실행 중) | 기존 전송 기능 + 자동 적재 (웹 작업대에는 표시 안 됨) | 지원 (자동, `source: native`) | 지원 | 지원 | 지원 |
| **샘플 개발 기록으로 체험** 데이터 | 지원 | 의도적으로 미지원 | 미지원 | 미지원 | 미지원 |

Codex와 Claude의 표준 로컬 stdio MCP 클라이언트에서 같은 `airpointer.mcp_server`를 등록할 수 있습니다(등록은 `python -m airpointer.mcp_install`로 자동화할 수 있습니다 — "MCP 서버" 절 참고). 서버 구현은 특정 Agent에 종속되지 않지만 각 클라이언트의 MCP 설정에는 사용자가 명령을 등록해야 합니다. 기존의 Codex/Claude 화면 전송 기능과 Screen Memory MCP 검색은 서로 다른 경로입니다.

현재 완전 연결된 데이터 흐름은 다음 두 가지입니다.

```text
브라우저 화면 공유 → IndexedDB → AirPointer Companion → SQLite → Codex 또는 Claude MCP
AirPointer 자체 화면 캡처(실행 중) → 15초 간격 또는 화면 변화 시 자동 OCR → SQLite → Codex 또는 Claude MCP
```

두 번째 경로는 브라우저 IndexedDB를 거치지 않으므로 웹 작업대(화면 검색·시간여행·요약 UI)에는 나타나지 않습니다 — SQLite를 직접 읽는 로컬 HTTP API/MCP에서만 조회할 수 있습니다.

## 북마크와 리플레이

PiP의 **북마크** 버튼이나 시간여행의 **이 시점을 북마크** 버튼으로 장면을 저장합니다. 리플레이를 보낼 때 기존 N초 구간에서 뽑는 대표 6장은 그대로 유지되고, 선택한 북마크는 `6장 + 북마크 장수`로 추가됩니다. 북마크가 N초 구간 밖에 있어도 포함됩니다.

## 로컬 HTTP API

Full Access 실행 중 브라우저가 발급한 연결 토큰을 `token` 쿼리에 넣습니다. 서버는 `127.0.0.1:47822`에서만 수신합니다.

```text
GET /memory/search?token=TOKEN&q=TypeError&from=0&limit=50
GET /memory/timeline?token=TOKEN&from=0&limit=50
GET /memory/bookmarks?token=TOKEN&limit=50
GET /memory/summary?token=TOKEN&from=0
GET /memory/reports?token=TOKEN&limit=20
POST /memory/frames?token=TOKEN
POST /memory/frame?token=TOKEN
POST /memory/delete?token=TOKEN
POST /memory/report?token=TOKEN
```

## MCP 서버

프로젝트 루트에서 다음 명령을 MCP의 stdio 서버 명령으로 등록합니다.

```powershell
python -m airpointer.mcp_server
```

### 자동 등록

Codex(`~/.codex/config.toml`)와 Claude Desktop(`claude_desktop_config.json`)에 위 명령을 직접 등록하는 대신 다음 한 번으로 등록할 수 있습니다.

```powershell
python -m airpointer.mcp_install
```

두 설정 파일 모두 이 도구가 추가하는 `airpointer-screen-memory` 항목 하나만 쓰고(읽거나 수정하기 전에 원본을 `.bak`으로 백업), 기존의 다른 MCP 서버 등록이나 설정은 건드리지 않습니다. 이미 등록돼 있으면 변경 없이 종료합니다. AirPointer 실행 파일이 아니라 실제 Python으로 직접 실행해야 하며, 앱 실행 중 자동으로 호출되지 않습니다 — 사용자가 한 번 실행하는 명시적 단계입니다.

제공 도구는 다음과 같습니다.

| 도구 | 기능 |
|---|---|
| `search_screen_memory` | OCR 문구, 메모, 태그로 화면 검색 |
| `get_screen_timeline` | 최근 시간 범위의 화면을 오래된 순서로 조회 |
| `list_screen_bookmarks` | 영구 북마크와 메모·태그·이미지 경로 조회 |
| `screen_activity_summary` | 활동 시간, 기록 수, 출처, 태그 집계 |
| `create_developer_report` | 북마크와 오류 후보로 Markdown 리포트 생성·저장 |

MCP는 HTTP 연결 토큰을 사용하지 않고 로컬 SQLite를 직접 읽습니다. 결과에는 OCR 텍스트, 메모, 태그와 화면 이미지의 로컬 경로가 포함됩니다. 음성은 저장하거나 검색하지 않습니다.

네이티브 AirPointer 자체 화면 캡처는 실행 중일 때 자동으로 SQLite에 적재됩니다: 캡처 루프가 화면이 의미 있게 바뀌거나(리플레이 변화 감지와 같은 판정) 마지막 적재 후 15초가 지나면 프레임을 하나 골라 Windows 온디바이스 OCR(`ocr_fallback.recognize_frame_text`, 크롭 라벨용으로 이미 쓰던 것과 같은 엔진)로 텍스트를 뽑고 `source: native`로 저장합니다([memory_ingest.py](../airpointer/memory_ingest.py)). OCR·저장은 백그라운드 스레드에서 처리되어 캡처 루프를 막지 않고, 이미 진행 중인 적재가 있으면 다음 트리거는 건너뜁니다(실패해도 캡처는 계속됩니다). 이 경로는 브라우저 IndexedDB를 거치지 않으므로 웹 작업대에는 나타나지 않고, 로컬 HTTP API·MCP로만 조회됩니다.

### 현재 제한

- MCP 서버를 실행한다고 브라우저 IndexedDB가 자동으로 노출되지는 않습니다. AirPointer Companion 동기화가 먼저 필요합니다.
- 샘플 체험 기록은 실제 사용자 기록과 섞이지 않도록 SQLite에 동기화하지 않습니다.
- 네이티브 캡처 자동 적재는 Windows 온디바이스 OCR 언어 팩이 없으면 텍스트 없이(이미지·시각만) 저장됩니다 — `search_screen_memory`/화면 검색 대상에서는 빠지지만, `get_screen_timeline`과 `create_developer_report`(둘 다 텍스트가 아니라 시간 범위로 조회) 결과에는 그대로 포함됩니다.

## 자동 개발 리포트

**개발 리포트** 화면에서 `30분마다 자동 리포트`를 켜면 웹 페이지가 열려 있는 동안 새 기록을 30분 단위 Markdown으로 정리합니다. 수동 리포트와 자동 리포트 모두 복사하거나 `.md` 파일로 받을 수 있고, Full Access 연결 시 SQLite에도 함께 기록됩니다.
