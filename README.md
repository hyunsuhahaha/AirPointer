# AirPointer

Windows용 웹캠 제스처 마우스 MVP입니다. 검지로 이동하고 엄지와 검지를 붙여 클릭/드래그하며,
Windows UI Automation이 찾은 가까운 버튼·입력창·링크로 커서를 스냅합니다.
설정창에는 손 위치를 확인할 수 있는 미러 카메라 미리보기가 표시됩니다.

## 실행

Python 3.11 권장(MediaPipe 호환 범위가 가장 안정적):

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m airpointer.main
```

검지만 펴면 이동, 엄지와 검지를 붙이면 클릭/드래그, 주먹을 쥐거나 손을 내리면 제어가
해제됩니다. 앱과 대상 프로그램의 권한 수준이 같아야 UI Snap과 입력이 정상 작동합니다.

## 현재 범위

- 주 모니터 한 대
- 첫 번째로 감지된 손 한 개
- 중앙 활성영역 기반 매핑(감도로 조절)
- 접근성 트리를 제공하는 Windows 앱과 웹 콘텐츠의 UI Snap
