# 방금그거뭐였지 데스크톱 앱

웹 앱(`web/`)을 그대로 띄우고, 브라우저가 못 하는 것만 더합니다.

- 화면 공유 창 없이 바로 기록 시작
- 앞에 있던 프로그램·창 제목과, 지정한 작업 폴더의 파일 저장 시각 기록 → `events.json`의 `activity`, `context.md`의 "작업 기록"
- Local Folder는 정해둔 폴더(기본 `문서\방금그거뭐였지`)에 바로 저장하고 프롬프트까지 복사
- 전역 단축키 `Ctrl + Shift + E`, 트레이 아이콘 (창을 닫아도 기록 유지)

앱 안에서는 브라우저의 작은 창(Document PiP)을 쓰지 않습니다. Electron에서 열면 페이지가 멈추기 때문입니다.

## 개발

```bash
npm install
npm run dev      # web/의 개발 서버(localhost:3000)를 띄운 뒤
npm test
```

`WHATWAS_URL`로 띄울 주소를, `WHATWAS_USER_DATA`로 설정 폴더를 바꿀 수 있습니다.

## 배포

설치 파일은 약 100MB라 Git에 넣지 않고 GitHub Releases에 올립니다.
`package.json`의 `version`을 올리고 `desktop-v<버전>` 태그를 푸시하면 `.github/workflows/desktop-release.yml`이 빌드해서 올립니다.
최신 설치 파일 주소: `https://github.com/hyunsuhahaha/AirPointer/releases/latest/download/whatwas-setup.exe`
