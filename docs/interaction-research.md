# AirPointer 상호작용 조사: 왜 지금 방식이 불편한가

조사 범위: 일반 RGB 웹캠 기반 포인터와 실제 공간 컴퓨팅 제품의 상호작용 설계. 공식 제품 문서, 원 논문, 원본 공개 저장소만 사용했다.

## 결론부터

현재의 `검지 끝 좌표 → 화면 절대좌표 → EMA smoothing → OS 커서` 구조는 데모는 되지만, 실제 마우스처럼 느껴지기 어렵다. 문제는 필터 하나가 아니라 입력 모델 전체다.

실제 제품들은 다음 세 가지를 분리한다.

1. 노이즈가 있는 연속 포인터(raw/filtered pointer)
2. 사용자가 의도한 안정된 대상(hover/focus target)
3. 선택과 조작 상태(commit/captured manipulation)

Apple은 **눈으로 대상 지정 + 손가락 탭으로 확정**, HoloLens와 Ultraleap은 **hand ray로 원거리 지정 + pinch/air-tap으로 확정**한다. 어느 쪽도 손가락의 2D 위치를 디스플레이 전체에 그대로 매핑하는 것을 주 상호작용으로 삼지 않는다. 따라서 AirPointer의 목표도 “검지를 더 매끄럽게 따라가는 커서”가 아니라 **대략적인 조준을 안정된 UI 의도로 바꾸고, 확정 순간에는 대상을 고정하는 포인터**여야 한다.

## 단순 검지-커서 매핑이 불편한 이유

- 카메라의 작은 손 떨림과 landmark 오차가 화면 확대 배율만큼 커진다. 1€ Filter 원 논문도 입력 확대가 센서 잡음을 증폭시키며, 불안정한 커서는 작은 표적 획득을 방해한다고 설명한다. 이동평균은 떨림을 줄이는 대신 최대 윈도 길이만큼 지연을 만든다. [Casiez·Roussel·Vogel, CHI 2012](https://gery.casiez.net/publications/CHI2012-casiez.pdf)
- 고정 EMA는 “천천히 조준할 때는 강하게 안정화”와 “빨리 이동할 때는 낮은 지연”을 동시에 만족시키지 못한다. smoothing을 올리면 끈적이고, 내리면 떤다.
- 검지와 엄지를 붙이는 순간 검지 끝 자체가 이동한다. 동일한 점을 조준과 클릭 센서로 쓰면 클릭 직전에 포인터가 흔들리거나 대상 밖으로 빠질 수 있다.
- 손이 잠깐 사라졌다 돌아오면 절대좌표 포인터가 재획득 지점으로 점프한다. 명시적인 clutch가 없으면 사용자는 손을 쉬거나 자세를 바꿀 수 없다.
- UI Snap이 매 프레임 다른 후보를 선택하거나 중심으로 순간 이동하면 도움 기능이 새로운 떨림을 만든다. hover 대상, 클릭 대상, drag 대상이 분리되어야 한다.
- 공중에서 팔과 손가락을 계속 고정하는 것은 본질적으로 피로하다. Ultraleap은 큰 동작, 오래 유지하는 자세, 어깨 위로 팔 들기와 팔을 완전히 뻗는 동작을 피하라고 명시한다. [Ultraleap Design Principles](https://docs.ultraleap.com/xr-guidelines/Getting%20started/design-principles.html)

## 실제 시스템은 어떻게 푸는가

### 1. MediaPipe Hands: 추적기이지 완성된 포인터가 아니다

MediaPipe Hands는 전체 영상의 palm detector와 잘린 손 영역의 21개 2.5D landmark 모델을 결합한다. 첫 프레임 또는 추적 실패 때만 detector를 다시 실행하고, 보통은 이전 landmark에서 다음 crop을 계산한다. 원 논문의 Full 모델 landmark 추론 시간은 당시 기기 기준 Pixel 3 16.1ms, Galaxy S20 11.1ms, iPhone 11 5.3ms였다. 이 수치는 모델 추론이며 카메라 캡처·Python·UI Automation·렌더링·OS 입력을 합친 end-to-end 지연은 아니다. [MediaPipe Hands 원 논문](https://arxiv.org/abs/2006.10214)

Python Hand Landmarker의 `LIVE_STREAM`은 비동기이며 지연을 낮추기 위해 입력 프레임을 버릴 수 있다. 따라서 “카메라 프레임마다 출력이 온다”는 가정으로 120Hz 보간만 추가해도 새 정보가 늘지는 않는다. timestamp가 있는 latest-result 구조로 소비해야 한다. [공식 Hand Landmarker 구현](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/python/vision/hand_landmarker.py)

시사점:

- 카메라 버퍼는 1장만 유지해 오래된 프레임을 처리하지 않는다.
- landmark timestamp부터 실제 `SendInput`까지 end-to-end latency를 측정한다.
- index tip만 쓰지 말고 palm 크기로 거리 정규화하고, 손바닥 중심·index MCP·tip을 함께 사용해 안정된 기준을 만든다.
- 추적 confidence가 낮을 때 클릭을 금지하고, 시각 포인터를 fade한다.

### 2. Apple visionOS: “손이 포인터”가 아니라 “시선이 타깃, 손은 확정”

visionOS의 기본 간접 입력은 사용자가 보는 요소를 타기팅하고, 엄지와 검지를 탭해 선택한다. 손은 무릎이나 옆의 편한 위치에 둘 수 있다. tap 유지 후 이동은 drag가 된다. Apple은 최소 60pt target area와 hover 효과로 현재 대상이 반응하도록 권장하며, Dwell Control은 일정 시간 바라보는 것으로 손 탭을 대체한다. [WWDC23 spatial input](https://developer.apple.com/videos/play/wwdc2023/10073/), [visionOS 시작 문서](https://developer.apple.com/visionos/get-started/), [Apple Gestures HIG](https://developer.apple.com/design/human-interface-guidelines/gestures/), [Apple Accessibility HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility)

Apple은 필터나 예측 계수를 공개하지 않는다. 가져올 핵심은 알고리즘 수치가 아니라 **target intent와 commit을 분리하고, 대상 자체가 hover/pressed 상태로 반응하게 하는 구조**다.

### 3. HoloLens/MRTK: 원거리는 ray, 근거리는 직접 조작

HoloLens 2의 원거리 입력은 손에서 ray를 쏘고 교차점에 donut cursor를 표시한 뒤 air-tap으로 확정한다. 가까운 대상에서는 ray가 꺼지고 index-tip cursor/direct manipulation으로 전환된다. [Microsoft Point and commit](https://learn.microsoft.com/en-us/windows/mixed-reality/design/point-and-commit), [Direct manipulation](https://learn.microsoft.com/en-us/windows/mixed-reality/design/direct-manipulation)

상태 피드백도 명시적이다. pointing ray는 점선과 도넛, commit은 실선과 점으로 바뀌고, 객체는 default → targeted/hover → pressed 상태를 가진다. 조작 중에는 처음 선택한 객체를 캡처한다. [Microsoft Cursors](https://learn.microsoft.com/en-us/windows/mixed-reality/design/cursors), [Interactable object](https://learn.microsoft.com/en-us/windows/mixed-reality/design/interactable-object)

MRTK Solver는 보간 시간을 늘려 jitter를 줄일 수 있지만 도달 지연이 늘어난다고 문서화한다. 즉 고정 보간만으로는 trade-off가 사라지지 않는다. [MRTK Solver](https://learn.microsoft.com/en-us/windows/mixed-reality/mrtk-unity/mrtk3-spatialmanipulation/packages/spatialmanipulation/solvers/solver)

AirPointer에 필요한 것은 3D ray 복제가 아니라 이 상태 모델이다. `raw reticle`, `hover target`, `captured target`을 별도 값으로 유지해야 한다.

### 4. Ultraleap: hysteresis, 활성화 조건, 피로 관리

Ultraleap은 원거리 상호작용에 hand ray와 pinch/grab을 사용하고, 가까운 직접 조작에서는 surface cursor를 숨겨 시각 혼잡을 줄인다. [Direct and distant interaction](https://docs.ultraleap.com/xr-guidelines/Interactions/direct_and_distant_interaction_mode.html), [UI panels](https://docs.ultraleap.com/xr-guidelines/Components/ui-panels.html)

공식 `PinchDetector`는 pinch와 unpinch에 **서로 다른 임계값**을 사용한다. 이 hysteresis가 임계점 부근의 press/release 채터링을 막는다. 기능은 필요할 때만 활성화하고, 우발 활성화는 어렵게 하며, 추적 영역 끝에서는 손 표현을 fade해 손실을 예고한다. [PinchDetector](https://docs.ultraleap.com/xr-and-tabletop/xr/unity/plugin/features/pinch-detector.html), [PinchDetector API](https://docs.ultraleap.com/api-reference/unity-api/class/class_leap_1_1_pinch_detector.html), [Ultraleap locomotion guidance](https://docs.ultraleap.com/xr-guidelines/Interactions/locomotion.html)

AirPointer에서는 단일 `distance < threshold`를 버리고 최소한 `OPEN → ARMED/HOVER → PINCHED/CAPTURED → RELEASE` 상태와 서로 다른 진입/해제 임계값을 써야 한다.

### 5. 1€ Filter: 속도에 따라 안정성과 반응성을 바꾼다

1€ Filter는 저속에서는 낮은 cutoff로 jitter를 억제하고, 고속에서는 cutoff를 올려 lag를 줄인다. 두 핵심 파라미터는 `min_cutoff`와 `beta`다. 저속 jitter가 크면 `min_cutoff`를 낮추고, 고속 lag가 크면 `beta`를 올리는 순서로 튜닝한다. [원 저자 알고리즘·튜닝 문서](https://gery.casiez.net/1euro/), [CHI 2012 논문](https://gery.casiez.net/publications/CHI2012-casiez.pdf)

AirPointer에는 고정 EMA나 이동평균을 겹치는 것보다 2D 1€ Filter를 한 번 적용하는 것이 타당하다. 단, 필터는 target lock·pinch hysteresis·clutch를 대신하지 않는다.

## 공개 웹캠 가상 마우스에서 확인한 패턴과 한계

아래는 원본 저장소의 실제 구현을 읽어 비교한 것이다. 품질 보증이나 사용자 연구 결과가 아니라, 구현 패턴을 확인하기 위한 표본이다.

| 프로젝트 | 구현 방식 | 얻을 점 | 코드상 한계 |
|---|---|---|---|
| [parthahuja33/gesture-mouse](https://github.com/parthahuja33/gesture-mouse) | 모듈식 camera/tracker/gesture/engine, index 절대좌표, EMA, pinch edge+시간 debounce, PyAutoGUI | 추적·제스처·OS 입력 분리, hand loss 시 상태 reset | pinch 진입 하나의 임계값만 사용하고 첫 pinch에서 click 후 다음 프레임 drag로 전환한다. hover target, clutch, semantic snap, latency prediction이 없다. [gesture_controller.py](https://github.com/parthahuja33/gesture-mouse/blob/360b2354ff7a477220fb301e32dcfff8940b0a4b/virtual_mouse/src/virtual_mouse/gesture_controller.py) |
| [HarishG20/air-mouse-gesture-control](https://github.com/HarishG20/air-mouse-gesture-control) | 중앙 ROI 절대좌표, 5-frame 평균+EMA, 제스처 enum, 4-frame hold debounce, HUD | 연속 프레임 확인으로 오클릭 억제, 디버그 HUD에 pinch 거리/hold 표시 | 두 필터를 겹쳐 lag를 키울 수 있고, pinch threshold가 픽셀값이라 손-카메라 거리 영향을 받는다. drag는 fist라 pointing pose에서 모드 전환 부담이 크고 semantic target/capture가 없다. [air_mouse.py](https://github.com/HarishG20/air-mouse-gesture-control/blob/9522ba1e214987494682dce5165f50a8e24a1bff/air_mouse.py) |
| [Rounak7721/Virtual-Mouse](https://github.com/Rounak7721/Virtual-Mouse) | 중앙 경계 절대좌표, EMA, dead zone, 여러 손가락 pose, pynput/PyAutoGUI | 화면 경계 축소와 dead zone, drag 상태 보존 | dead zone이 작은 의도 이동도 버려 계단감을 만들 수 있다. drag 시작/해제가 같은 27px 임계값이라 채터링 가능하고, gesture 수가 많아 pose 충돌 위험이 크다. [main.py](https://github.com/Rounak7721/Virtual-Mouse/blob/495b293320fc588bc2bc05a81cbdf1f54fa1e7fd/src/main.py) |

공통적으로 “index 절대좌표 + smoothing + cooldown”에 머무르며, Apple/Microsoft/Ultraleap식의 target intent, hover lock, captured manipulation, confidence-aware clutch가 없다. 이것이 GitHub 데모를 그대로 확장해도 제품 감각이 잘 나오지 않는 이유다.

## 권장 AirPointer v0.2 아키텍처

```text
Camera(latest frame only, timestamp)
  → MediaPipe LIVE_STREAM / landmark result
  → Hand feature layer
      palm scale, palm center, index ray/delta, pinch ratio, confidence
  → Motion estimator
      1€ filter + velocity + measured-latency compensation(optional)
  → Pointer mapper
      relative virtual touchpad (기본) / absolute ROI (실험군)
      explicit clutch + reacquisition anchor
  → Intent engine (Windows UIA, 별도 저주기 worker)
      candidates → scored target → hover lock/hysteresis
  → Gesture state machine
      OFF → TRACKING → HOVER_ARMED → PINCHED → DRAG_CAPTURED
  → Output
      Win32 SendInput + 60/120Hz overlay + optional short sound
```

핵심 규칙:

- 카메라/추적은 최신 결과만 공유한다. 렌더와 UI Automation이 추적 루프를 막지 않는다.
- 포인터 매핑 기본 후보는 **상대 이동형 virtual touchpad**다. 손을 편한 위치에서 clutch한 뒤 작은 palm/index delta를 cursor delta로 바꾸면 화면 끝 도달과 재획득 점프를 줄일 수 있다. 현재 absolute ROI 방식은 A/B 실험군으로 유지한다. 이는 조사 자료에서 도출한 AirPointer용 제안이지, Apple의 gaze나 HoloLens의 3D ray를 그대로 구현한다는 뜻은 아니다.
- UI 후보 점수는 거리만 쓰지 않고 `거리 + 진행 방향 + 컨트롤 타입 + 크기 + 이전 hover 유지 보너스`로 계산한다. 진입 반경보다 해제 반경을 크게 두고 80~120ms 안정 후 lock한다.
- snap은 OS 커서를 매 프레임 버튼 중앙으로 순간이동시키지 않는다. raw reticle은 계속 손을 따라가고, hover target만 고정한다. pinch commit 순간에 target의 안전한 hit point로 1회 이동하고 클릭한다.
- pinch는 palm size로 정규화하고 `pinch_on < pinch_off` hysteresis를 둔다. 50~100ms confirm 후 press, release confirm 후 up. drag 중에는 hover 재검색을 멈추고 최초 target/cursor를 capture한다.
- hand loss는 즉시 cursor jump가 아니라 짧은 grace(예: 150~250ms) 동안 freeze/fade한다. 단, mouse-down 안전 해제 시간은 별도로 짧고 확실하게 둔다.
- “아이언맨 느낌”은 스킨이 아니라 상태 가시화다. TRACKING은 얇은 trail/점선 ray, HOVER는 reticle 수축+대상 outline/pulse, PINCHED는 실선 ray+pressed flash, DRAG는 captured tether, 신뢰도 저하는 fade로 표현한다. 광범위한 네온 애니메이션보다 입력 상태와 정확히 동기화하는 것이 우선이다.

## 우선순위 실험

1. **측정부터:** 2분 사용 로그에 camera timestamp, landmark timestamp, filtered pointer, target, gesture state, `SendInput` 시간을 기록한다. 목표는 end-to-end p50/p95 latency, stationary jitter, dropped-result rate, false click 수다.
2. **Pinch state A/B:** 단일 임계값 vs palm-normalized hysteresis+confirm. 100회 클릭의 오클릭/미클릭과 클릭 직전 cursor displacement를 비교한다.
3. **필터 A/B:** 현 EMA vs 1€ Filter. 작은 버튼 선택 시간, stationary jitter, 빠른 화면 횡단 시간을 함께 비교한다. 보간 프레임 수가 아니라 실제 새 입력의 지연을 측정한다.
4. **매핑 A/B:** absolute ROI vs relative virtual touchpad+clutch. 화면 네 모서리와 작은 링크를 반복 선택해 시간·오류·팔 피로도를 비교한다.
5. **Target lock A/B:** 매 프레임 nearest snap vs scored hover lock+진입/해제 hysteresis+commit-time snap. Chrome/YouTube의 인접 링크와 작은 아이콘에서 target switching 횟수를 센다.
6. **피드백:** 단순 점 vs 상태 동기화 ray/reticle/target outline. 사용자가 클릭 전에 선택 대상을 맞게 예측하는 비율을 측정한다.
7. **짧은 예측은 마지막:** 전체 latency가 측정된 뒤에만 1~2 frame constant-velocity prediction을 시험한다. overshoot가 늘면 제거한다.

## v0.2 성공 기준

- 100회 의도 클릭에서 false click ≤ 2, missed click ≤ 5
- 버튼 hover 중 target switching이 초당 1회 미만
- 손 정지 시 cursor jitter가 일반 100% 배율에서 작은 버튼 hit-area 안에 유지
- 빠른 화면 횡단 후 overshoot 없이 즉시 세밀 조준 가능
- 손을 내렸다 다시 올려도 cursor가 점프하거나 mouse-down이 남지 않음
- 사용자가 pinch 전에 어떤 대상이 선택될지 overlay만 보고 예측 가능

이 기준을 만족한 뒤 scroll·우클릭·음성/LLM을 넣는 편이 맞다. 지금 필요한 “아이언맨화”는 제스처 수를 늘리는 것이 아니라 **의도 잠금, 확정, 캡처, 피드백이 하나의 일관된 상태 머신처럼 느껴지게 만드는 것**이다.
