# AirPointer

Windows용 웹캠 공간 포인터입니다. 검지 끝 위치를 화면 전체의 절대 좌표로 바꾸고 엄지와 검지를
붙여 클릭/드래그하며, Windows UI Automation이 찾은 가까운 버튼·입력창·링크를 잠급니다.
설정창에는 손 위치를 확인할 수 있는 미러 카메라 미리보기가 표시됩니다.

## 실행

Python 3.11 권장(MediaPipe 호환 범위가 가장 안정적):

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m airpointer.main
```

편 손의 검지를 움직이면 카메라 왼쪽·오른쪽이 화면 양 끝에 대응합니다. 설정의 `Mapping`에서
`Relative hand`를 고르면 터치패드처럼 상대 이동할 수도 있습니다. 짧게 pinch 후 놓으면 클릭, pinch를 유지하거나
움직이면 드래그가 됩니다. 주먹은 커서를 놓고 손 위치를 다시 잡는 clutch이며, 손을 내리면
제어가 해제됩니다. 앱과 대상 프로그램의 권한 수준이 같아야 UI Snap과 입력이 정상 작동합니다.

## 현재 범위

- 주 모니터 한 대
- 첫 번째로 감지된 손 한 개
- 1€ Filter를 사용한 검지 절대 포인팅(기본값), 선택 가능한 상대 이동
- pinch 진입/해제 hysteresis와 captured drag
- 비동기 UI hover lock, pinch 확정 시 1회 snap
- 접근성 트리를 제공하는 Windows 앱과 웹 콘텐츠의 UI Snap
