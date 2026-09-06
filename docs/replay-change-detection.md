# 리플레이 변화 감지 (Change-Aware Frame Selection)

`airpointer/screen_buffer.py`의 `ScreenReplayBuffer.export_recent()`가 리플레이 구간에서
전송할 프레임을 고를 때 쓰는 로직에 대한 설계 기록. 코드 자체의 docstring/주석에도 요약이
있지만, 왜 이 구조가 됐는지(무엇을 시도했다가 버렸는지 포함)는 여기에만 있음.

## 문제

`export_recent(seconds, frame_count=6)`는 최근 N초 리플레이 버퍼에서 최대 6장의 정지
이미지를 뽑아 Codex/Claude에 전송한다. 이 함수가 나오기 전(그리고 이 문서가 다루는 개선
이전) 구현은 요청 구간의 1초 단위 세그먼트를 **균등 분할**해서 고르고, 고른 세그먼트마다
**중간 프레임**을 뽑았다.

이 방식의 근본적인 문제: 균등분할은 "언제 중요한 일이 일어났는지"와 아무 상관이 없다.
예를 들어 15초 구간에 6장을 뽑으면 샘플 간격이 ~2.5초인데, 사용자 개입 없이 백그라운드에서
1~2초짜리 에러 토스트가 떴다 사라지면 두 샘플 사이에 통째로 낄 수 있어 완전히 누락된다.
클릭/창 전환 이력(`window_tracker.py`, `click_tracker.py`)을 기준으로 샘플링하는 방법도
검토했지만, 사용자가 아무것도 안 눌렀는데 저절로 뜨는 에러는 그걸로도 못 잡는다는 게
분명해서 기각했다 — **화면 자체의 시각적 변화를 직접 재는 방법**으로 방향을 잡았다.

## 접근: 저해상도 썸네일 diff, 녹화 중에 계산

원본 프레임(예: 2560×1600 BGR ≈ 12MB)을 버퍼에 쌓아두고 나중에 비교하는 방식은 메모리를
심각하게 잡아먹는다(5fps로 15초만 유지해도 ~900MB). 그래서 원본은 절대 쌓지 않고, 이미
`_record_segment()`가 매 프레임을 처리하는 그 자리에서(디스크에 압축 영상으로 쓰기 직전)
160×90 흑백 썸네일로 축소한 뒤 비교하고 즉시 버린다. 다운스케일+그레이스케일 변환은
프레임 하나 grab하는 비용(~60~70ms, 별도 문서 없음 — mss 관련 대화 참고)에 비하면 무시할
수준이라, 발열/CPU 부담을 늘리지 않는다.

## 왜 프레임 단위 diff가 아니라 "이벤트"인가

가장 단순한 구현은 "직전 프레임과 다르면 그 순간을 기록"인데, 이러면 문제가 생긴다:

- **스크롤/창 전환처럼 몇 프레임에 걸쳐 계속 변하는 동작**이 프레임 수만큼(예: 500ms
  스크롤 = 10fps 기준 5프레임) 개별 이벤트를 만들어낸다. 점수로 정렬해서 뽑으면 이런
  "크지만 하나의 연속 동작"이 상위 슬롯을 여러 개 독점해서, 정작 중요한 짧은 변화 하나가
  밀려난다.
- 토스트의 "등장 → 유지 → 소멸"이라는 하나의 사건을, 등장 순간의 diff 스파이크 하나로만
  표현하면 그 사건의 지속 구간(started_at~ended_at)이라는 정보가 사라진다.

그래서 `_ChangeTracker`는 프레임마다 이벤트를 만들지 않고, **연속된 "임계값 초과" 프레임들을
하나의 `ChangeEvent`로 병합**하는 작은 상태 머신으로 동작한다:

```
평상시(비활성)
  → 이번 프레임이 임계값 초과: 이벤트 시작(active=True), peak 갱신
  → 계속 임계값 초과: peak_score/peak_at/bbox를 "지금까지 중 가장 큰 변화"로 계속 갱신
  → 임계값 이하가 _QUIET_FRAMES_TO_CLOSE(=2)프레임 연속되면: 이벤트를 ChangeEvent로 확정,
    반환, active=False
```

`ChangeEvent`는 `(started_at, peak_at, ended_at, peak_score, bbox)`를 담는다. `peak_at`이
"이 사건을 대표하는 프레임을 뽑을 때 쓸 시각"이고, `started_at`/`ended_at`은 지금은
저장만 해두고 선택 로직에서는 안 쓴다(향후 "이 구간 전체를 다 보여줘야 하나" 판단에 쓸
여지를 남겨둔 것).

## 왜 전역 변화율만으로는 부족한가 — 타일 기반 스코어링

작은 에러 문구(예: 2560×1600 화면에서 300×80px)는 전체 화면의 0.6% 정도밖에 안 된다.
"전체 썸네일의 몇 %가 바뀌었나"만 보는 전역 임계값(`_GLOBAL_MIN_SCORE=0.02`, 2%)으로는
이런 변화가 절대 안 걸린다 — 이게 실제로 이 설계의 초기 버전에서 재현된 버그였다(아래
"검증 중 발견한 버그" 참고).

그래서 `_score_and_bbox()`는 두 기준을 OR로 본다:

- **전역 기준**: 썸네일 전체에서 바뀐 픽셀 비율 ≥ `_GLOBAL_MIN_SCORE`(2%) — 스크롤,
  창 전환처럼 화면 대부분이 바뀌는 큰 변화를 잡음
- **타일 기준**: 160×90 썸네일을 8×8 타일로 나눠서, **타일 하나라도** 그 안에서 바뀐
  비율이 `_TILE_MIN_SCORE`(15%)를 넘으면 통과 — 화면 전체로는 작아도 한 군데 집중된
  변화(토스트, 팝업)를 잡음

bbox도 마찬가지 이유로 "타일 히트가 있으면 그 타일들의 경계만" 쓰고(화면 전체로 안
뭉개짐), 타일 히트가 없고 순수 전역 임계값으로만 통과한 경우에만 전체 마스크의 min/max로
bbox를 잡는다. 여러 군데에서 동시에 작은 변화가 나면 bbox가 부정확해질 수 있는데(두 변화
사이를 잇는 넓은 사각형이 됨), 이건 알려진 한계로 남겨뒀다 — 필요해지면 타일을 연결
요소(connected components)로 묶는 걸 다음 단계로 고려.

## 메모리 사용량

- 이전/현재 썸네일(160×90 흑백) 2장: 약 29KB
- 이벤트 하나당 `ChangeEvent` 객체 1개(튜플 몇 개 수준, 수백 바이트)
- `self._events`는 `deque(maxlen=512)`로 하드 캡을 걸어둠 — 정상적으로는 `_prune()`이
  `retention_seconds()`(기본 3분)보다 오래된 이벤트를 세그먼트와 같은 주기로 지우지만,
  혹시 정리가 못 따라가는 상황에서도 이 상한이 메모리 폭주를 막음
- 원본 프레임은 여전히 압축 영상으로만 디스크에 있고(`ScreenReplayBuffer`가 원래
  하던 대로), 이벤트 자체는 시각·점수·bbox만 들고 있어서 화면 해상도와 무관하게 작음

## 프레임 선택: `_select_notable_moments`

`export_recent()`는 요청 구간의 세그먼트 목록과, 같은 구간에 속한 이벤트 목록을
`_select_notable_moments(segments, events, count)`에 넘긴다. 반환값은
`(Segment, target_at)` 튜플 리스트 — `target_at`이 `None`이면 "이벤트 없음, 세그먼트
중간 프레임 사용"(예전 동작 그대로), 아니면 그 시각에 가장 가까운 프레임을 뽑으라는 뜻.

우선순위:
1. `(세그먼트 경로, 반올림한 시각)`으로 중복만 걸러낸 이벤트 후보 목록을
   `_select_events_diverse(candidates, budget)`에 넘겨 **점수만이 아니라 다양성까지
   고려해서** 채움(이 함수 자체는 아래 별도 절 참고) — **같은 세그먼트 안에 서로 다른
   시각의 이벤트가 여러 개 있으면 둘 다 뽑힐 수 있음**은 그대로: 토스트가 뜨고 지는
   게 1초 세그먼트 하나 안에서 다 일어나도 등장/소멸 둘 다 잡힌다.
2. 예산은 `max(1, count - 2)`까지만 이벤트에 씀 — 나머지 최소 2슬롯은 구간의
   **시작/끝 세그먼트** 보장용. `max(1, ...)`인 이유: `count`가 아주 작아도(1 이하)
   이벤트가 하나라도 있으면 그걸 우선하고, 최종 개수 제한은 맨 끝의
   `result[:count]`가 어차피 강제한다 — 예전 루프도 break 검사가 append *다음에* 실행돼
   실제로는 항상 이랬다(의도적 보존, 버그 아님). 단, 경계 세그먼트가 **이미 이벤트로
   뽑혀 있으면 중복으로 다시 안 넣음**(안 그러면 "이벤트로 뽑힌 좋은 프레임"이 "그냥
   중간 프레임"으로 덮어써지는 버그가 생김 — 아래 참고).
3. 그래도 슬롯이 남으면(이벤트가 적은 조용한 구간) 기존 균등분할(`_evenly_spaced`)로
   채움 — 이벤트가 하나도 없으면 완전히 예전 동작과 동일하게 동작함(퇴화 없음).

## 다양성 있는 프레임 선택: 점수만으로는 왜 부족한가

`_select_notable_moments`는 원래(위 절의 예전 버전) `peak_score` 내림차순 정렬 후
상위 `count-2`개를 그냥 잘라 썼다. 실사용하다 나온 문제: **"화면이 얼마나 크게
바뀌었나"(peak_score)와 "그 순간이 중요한가"는 같은 축이 아니다.** 예를 들어 15초
구간에 스크롤이 3번(각각 전역 임계값을 크게 넘겨 score 0.4~0.5대) 일어나고, 그 사이
어딘가에 작은 에러 토스트(타일 임계값을 겨우 넘겨 score 0.15~0.2대)가 한 번 떴다
지면, 예산이 2~4슬롯이면 스크롤 3개가 상위 슬롯을 다 차지하고 토스트는 점수가 낮아서
탈락한다 — 정작 이 도구가 잡으려던 바로 그 종류의 순간인데도.

이건 비디오 요약(video summarization) 분야에서 이미 이름 붙은 실패 모드다: "순수
relevance(점수) 기준 선택은 근-중복(near-duplicate) 프레임에 수렴해서 커버리지를
희생한다"(AdaRD-key, 2025 — 아래 관련 연구 절 참고). 전체 서브모듈러 최적화(facility
location + log-determinant diversity, Sherman-Morrison 업데이트 등)는 이 프로젝트
규모엔 과하다 — 실시간, CPU 전용, 한 구간의 이벤트 개수도 많아야 수십 개 수준이라.
대신 1998년부터 있는 훨씬 단순한 **MMR(Maximal Marginal Relevance) 그리디** 방식을
쓴다.

### `_select_events_diverse`: MMR + 국소 이벤트 최저 보장

```python
def _select_events_diverse(events, budget):
    remaining = list(events)
    picked = []
    while remaining and len(picked) < budget:
        def effective(event):
            redundancy = max((_bbox_iou(event.bbox, other.bbox) for other in picked), default=0.0)
            return event.peak_score * (1 - _REDUNDANCY_LAMBDA * redundancy)
        best = max(remaining, key=effective)
        picked.append(best); remaining.remove(best)

    if budget > 0 and not any(event.extent < _LOCALIZED_EXTENT_MAX for event in picked):
        localized = [e for e in events if e.extent < _LOCALIZED_EXTENT_MAX and e not in picked]
        if localized:
            best_localized = max(localized, key=lambda e: e.peak_score)
            if len(picked) < budget:
                picked.append(best_localized)
            else:
                weakest = min(range(len(picked)), key=lambda i: picked[i].peak_score)
                picked[weakest] = best_localized
    return picked
```

두 단계로 나뉜다:

1. **MMR 재순위**: 매 슬롯마다 "점수는 높은데 이미 뽑힌 것과 안 겹치는" 후보를 고른다.
   `effective(event) = peak_score * (1 - λ * redundancy)`, `redundancy`는 이미 뽑힌
   이벤트들과의 **bbox IoU 중 최댓값**(완전히 겹치면 1.0, 안 겹치면 0.0). 새 데이터
   수집이 필요 없다 — bbox는 어차피 계산돼 있던 값이라, 순수 선택 로직만 바뀐다.
   같은 자리에서 반복되는 큰 변화(긴 스크롤이 쪼개져 이벤트 여러 개가 된 경우 등)는
   첫 번째만 온전한 점수로 뽑히고, 그 다음 것들은 겹침만큼 점수가 깎여서 다른 위치의
   이벤트에게 슬롯을 내준다.
2. **국소 이벤트 최저 보장(floor)**: MMR만으로는 못 잡는 경우가 있다 — 화면의 서로
   **겹치지 않는** 두 곳에서 각각 큰 변화가 나면(왼쪽 절반 스크롤 + 오른쪽 절반
   스크롤), MMR 입장에선 둘 다 "안 겹치니 페널티 없음"이라 점수 순 그대로 뽑히고,
   그 사이 뜬 작은 토스트는 여전히 한 번도 못 이긴다. 그래서 뽑힌 것 중 하나도
   "국소적"(`extent < _LOCALIZED_EXTENT_MAX`, 전역 diff 비율 5% 미만 — 전체 화면
   대비 작다는 뜻)이 없으면, 후보 중 점수가 가장 높은 국소 이벤트를 억지로 끼워
   넣는다(자리가 남으면 추가, 꽉 찼으면 지금 뽑힌 것 중 가장 점수 낮은 걸 밀어냄).

`extent`는 `ChangeEvent`의 새 필드로, `peak_score`와 다르다 — `peak_score`는 타일
히트 시 `max(global_score, _TILE_MIN_SCORE)`로 위로 클램프될 수 있는 반면, `extent`는
클램프 없는 순수 `mask.mean()`(전체 썸네일 대비 바뀐 비율)이라 "이 사건이 화면 전체
대비 실제로 얼마나 넓었나"를 그대로 보존한다 — 토스트는 타일 기준으로 score가 0.15까지
올라가도 extent는 여전히 0.006 근처에 머문다.

`test_select_events_diverse_prefers_a_distinct_event_over_a_near_duplicate`(순수 MMR로
충분한 케이스)와 `test_select_events_diverse_guarantees_a_localized_slot_the_floor_needs`
(MMR만으론 안 되고 floor가 꼭 필요한 케이스)로 두 메커니즘을 각각 별도로 검증했다 —
`tests/test_frame_diversity.py`.

### 성능: 이게 실시간 캡처 스레드를 느리게 만드나

아니다 — `_select_notable_moments`/`_select_events_diverse`는 `_record_segment()`가
매 프레임 도는 캡처 루프 안이 아니라, **사용자가 실제로 캡처를 트리거했을 때**
(`export_recent()`/`capture_still()` 경로)만 한 번 호출된다. 그래도 실측은 했다
(`scripts/bench_frame_diversity.py`, 예전 top-K 구현과 나란히 벤치마크):

| 시나리오 | 예전(top-K) | 새 방식(MMR+floor) | 오버헤드 |
|---|---|---|---|
| 현실적(15초 구간, 이벤트 15개) | 11.1us | 135.5us | +124.3us |
| 바쁨(30초 구간, 이벤트 60개) | 13.7us | 491.7us | +478.0us |
| 스트레스(30초 구간, 이벤트 500개 — 비현실적) | 46.7us | 2638.9us | +2592.3us |

500개 이벤트는 `_QUIET_FRAMES_TO_CLOSE`(연속 조용한 프레임 2개는 있어야 이벤트가
닫힘) 때문에 15fps로도 30초 안에 물리적으로 나오기 힘든 개수라 완전히 과장된
상한선이다. 그 극단적인 경우조차 2.6ms — 실제 캡처 한 번에 들어가는 비디오 프레임
탐색·PNG 인코딩·UI Automation 조회(요소가 막 생겼으면 재시도 지연만 0.25초, 위
"실측하며 발견한 문제 2" 참고) 비용에 비하면 잡음 수준이다. 결론: 다양성 로직을 위해
실시간성을 하나도 희생하지 않았다.

## `_frame_index_for`: 시각 → 프레임 인덱스 변환

세그먼트 하나를 골랐다고 끝이 아니라, 그 세그먼트 영상 안에서 정확히 몇 번째 프레임을
seek할지 계산해야 한다. `_record_segment()`가 프레임을 쓰는 실제 타이밍은:

```
프레임 i는 대략 started + i * interval 에 찍힘  (i = 0 .. rate-1)
```

1초 세그먼트, `rate`(=fps) 프레임이면 마지막 프레임은 `started + (rate-1)*interval`
근처지 `ended`(= 루프 종료 직후 `time.time()`, 즉 대략 `started+1.0`)가 아니다. 즉
프레임들은 `[started, ended]` 구간 "끝까지 꽉 채워서" 균등분포하는 게 아니라
`[started, started + (rate-1)/rate * (ended-started))` 정도만 채운다.

## 검증 중 발견한 버그 (구현하면서 실제로 잡은 것들)

합성 데이터로 실제 테스트하면서 아래 두 개를 발견하고 고쳤다. 둘 다 처음 버전에서는
"토스트가 이벤트로는 잡히는데, 정작 뽑힌 이미지에는 안 보인다"는 증상으로 나타났다.

1. **`_frame_index_for`의 분모 실수**: 처음엔 `fraction * (frame_count - 1)`로 계산해서
   "프레임이 [started, ended] 양 끝까지 꽉 채워 분포한다"고 가정했다. 실측해보니 10fps
   세그먼트에서 fraction=0.6인 이벤트가 인덱스 5로 계산됐는데, 실제 그 순간의 프레임은
   인덱스 6이었다(1프레임 어긋남). `frame_count`로 나누는 것으로 고쳐서 실제 녹화 케이던스와
   맞췄다.
2. **경계 세그먼트가 이벤트를 덮어쓰는 문제**: 처음 버전은 "첫/마지막 세그먼트는 무조건
   `target_at=None`으로 포함"이었는데, 만약 그 경계 세그먼트 안에 마침 진짜 이벤트가 있으면
   (구간 끝나기 직전에 토스트가 뜬 경우 등) 그 이벤트 정보가 무시되고 그냥 중간 프레임이
   뽑혔다. "이미 이벤트로 뽑힌 세그먼트면 경계용 None을 또 안 넣는다"로 고쳤다.

두 버그 다 유닛 테스트(`_select_notable_moments`를 합성 `Segment`/`ChangeEvent`로 직접
호출)와, 실제 `ScreenReplayBuffer`를 가짜 `grab` 함수로 돌려서 작은 토스트가 실제로
익스포트된 PNG에 나타나는지 픽셀 단위로 확인하는 엔드투엔드 테스트로 둘 다 재현하고
고친 뒤 재검증했다.

위 두 개와는 별개로, 이 저장소 자체의 위치(`OneDrive\문서\...`, 한글 포함) 때문에 발견한
환경 버그도 하나 있었다: **`cv2.imwrite`는 Windows에서 한글 등 비-ASCII 문자가 섞인
절대경로로는 예외 없이 조용히 `False`를 반환하고, 같은 문자가 섞인 상대경로로는
정상 동작한다.** `ScreenReplayBuffer.root`/`dispatch`는 `.resolve()`로 항상 절대경로가
되므로, 사용자 계정 이름이나 `%LOCALAPPDATA%` 경로 어딘가에 비-ASCII 문자가 있는 PC에서는
스크린샷/리플레이 저장이 원인 불명으로 실패할 수 있었다(이번 사용자 환경은
`%LOCALAPPDATA%`가 전부 영문이라 실제로는 안 걸렸음). `frame-regions.json` 관련 테스트
(`tests/test_region_hint.py`)를 이 저장소 경로 밑의 `tmp_path`로 작성하다가 그대로
재현되어 발견했다.

고친 방법은 `cv2.imwrite(str(path), frame)` 대신, `cv2.imencode()`로 메모리에서
PNG로 인코딩한 뒤 `Path.write_bytes()`(파이썬 자체 파일 I/O, Windows에서 유니코드
경로를 정상적으로 처리함)로 직접 쓰는 것이다 (`screen_buffer._imwrite`). `cv2.VideoWriter`/
`VideoCapture`는 이 문제가 없어서(이미지 코덱 경로만의 문제) 그대로 뒀다. `imwrite`와
같은 bool 반환 계약을 유지해서 `capture_still()`/`export_recent()`의 기존 성공/실패
분기는 안 건드렸다. 회귀 테스트는 `tests/test_unicode_paths.py`에 있고, 이 저장소가
어디에 체크아웃돼 있든 재현되도록 자체적으로 한글 이름 임시 폴더를 만들어 검증한다.

## 변화 위치를 프롬프트 힌트로 전달

`ChangeEvent.bbox`는 한동안 프레임을 고르는 데만 쓰이고 어디에도 안 쓰였는데(바로 아래
"아직 안 한 것"에는 이 항목이 있었다), 이제는 실제로 Codex/Claude에게 "대략 어디를
보라"는 한 줄 힌트로 넘어간다.

`export_recent()`가 `_select_notable_moments()`의 반환값에서 `bbox`를 함께 받아(더 이상
`(Segment, target_at)` 페어가 아니라 `(Segment, target_at, bbox)` 트리플), 이벤트로 뽑힌
프레임에 한해 `_bbox_label(bbox, width, height)`로 픽셀 좌표를 3x3 격자 기준 한국어
위치 문구(`"오른쪽 아래"`, `"왼쪽"`, `"가운데"` 등)로 바꾼다. 이 라벨들은 `frame-times.json`
과 같은 폴더에 두 번째 사이드카 `frame-regions.json`으로 `{파일명: 라벨}` 형태로 저장된다
(이벤트로 뽑힌 프레임이 하나도 없으면 파일 자체를 안 만듦).

`frame-times.json`은 전송이 끝난 뒤 `main.App._publish_sent_frames`가 읽는 반면,
`frame-regions.json`은 **전송 전에** 읽혀야 프롬프트에 반영될 수 있다. 그래서
`CaptureController._deliver()`가 `codex.send()`를 부르기 직전에
`read_and_clear_region_hint(paths)`(`screen_buffer.py`)로 한 번 읽고 즉시 지운 뒤,
기존 `window_history`(창 전환/클릭 로그) 뒤에 한 줄씩 이어 붙인다:

```
최근 활동:
창 전환: Chrome → VS Code
클릭: 저장 버튼
화면 변화 감지: 1번째 프레임, 오른쪽 아래 영역

(원래 프롬프트)
```

스크린샷/영역 캡처나 변화가 감지되지 않은 조용한 리플레이 구간에는 사이드카 자체가 없어서
이 줄이 그냥 안 생긴다(`read_and_clear_region_hint`가 `""`를 반환).

## 6장으로도 놓친 순간: 매니페스트 기반 추가 프레임 조회 (Codex 전용)

`_select_events_diverse()`(위 절)로 6장을 아무리 잘 골라도, 정말로 그 6장 다 놓친 순간이
있을 수 있다. 그럴 때 이미 보낸 화면 원본을 다시 볼 방법이 지금까진 없었다 — 전송이 끝나면
그걸로 끝이었다.

### 왜 6장을 없애지 않고 "얹는" 방식인가

대안으로 "미리 뽑지 말고 원본을 통째로 주고 Codex가 알아서 보게 하자"도 검토했다. 기각한
이유: Codex는 영상을 직접 보는 도구가 없고 `view_image`로 정지 이미지만 본다. 미리 뽑아주지
않으면 제일 단순한 질문에도 매번 최소 1번의 추가 도구 호출(및 그 세션의 승인 정책에 따라
확인 대기)이 필요해진다. 그래서 "6장은 그대로 먼저 주고, 모자라면 더 볼 수 있는 통로만
같이 준다"로 정리했다 — 대부분의 경우(6장으로 충분한 경우) 추가 비용이 전혀 없고, 드문
경우에만 그 비용을 문다.

### 왜 Codex 전용인가

Claude Desktop은 기본적으로 로컬 셸/파일 읽기 도구가 없다(사용자가 MCP 커넥터를 직접
붙이지 않는 한). `DesktopPasteDelivery`는 UI 자동화로 붙여넣기만 할 뿐 상대 앱에 새 도구를
얹어주는 게 아니라서, Claude한테 "이 명령을 실행해봐"라고 안내해도 실행할 방법이 없다 —
그냥 죽은 텍스트가 된다. 그래서 이 기능은 `CaptureController`가 `self.codex.target is CODEX`일
때만 켠다(`desktop_paste.CODEX`/`CLAUDE`로 타겟이 이미 명확히 갈려 있다).

### 설계: pin 대신 복사

라이브 버퍼의 리텐션(`retention_seconds`, 기본 3분)을 만지는 대신, `export_recent(...,
with_manifest=True)`가 요청 구간에 걸치는 세그먼트 mp4들을 캡처용 `dispatch` 폴더 밑
`segments/`로 **복사**한다(`write_manifest()`). 이 폴더는 라이브 버퍼의 `_prune()` 스윕
대상이 아니므로, 별도의 참조 카운트/pin 로직 없이 자연히 더 오래 산다 — 1초 세그먼트
15~30개 복사 비용은 무시할 수준(수 MB).

같은 폴더에 `manifest.json`도 함께 쓴다: 복사된 세그먼트 목록(`path`/`startedAt`/`endedAt`),
`triggeredAt`(호출 시각), 그리고 `frameQuery`(실행할 명령 예시 + 한글 설명). 다른 사이드카와
달리(`frame-regions.json` 등) **전송 전후로 안 지워진다** — `read_manifest_hint()`가
`read_and_clear_region_hint()`와 같은 폴더 탐색 패턴을 쓰지만 파일을 그대로 남겨둔다. 대신
`_MANIFEST_TTL_SECONDS`(기본 600초, 라이브 버퍼 리텐션보다 일부러 더 길게 — 그 이후까지
조회 가능하게 하려는 게 이 기능의 목적이므로)가 지나면 `_prune()`의 스로틀된(1분에 한 번)
스윕(`_sweep_expired_manifests`)이 통째로 지운다.

### 조회 스크립트: `airpointer/replay_query.py`

`query_frame(manifest_path, offset_seconds)`가 실제 조회를 담당한다: `triggeredAt +
offset_seconds`를 절대 시각으로 바꿔 그 시각을 담고 있는(또는 가장 가까운) 세그먼트를
찾고, `cv2.VideoCapture` + `CAP_PROP_POS_MSEC`로 그 시각까지 seek해서 프레임 한 장을
추출한다(`_imwrite` 재사용, 유니코드 경로 안전). `_frame_index_for`(위 절)를 안 쓰는 이유:
그건 세그먼트 자신의 `frame_count`를 알아야 하는 인덱스 기반 계산인데, 여기선 그런 사전
정보 없이 절대 시각으로만 seek하면 되니 시간 기반이 더 간단하다. 이건 웹 쪽의
`web/scripts/replay-frame.mjs`(ffmpeg 기반)와 정확히 같은 발상의 네이티브 버전이지만,
`cv2`가 이미 있어서 새 의존성이 없다.

`airpointer_launcher.py`의 `main()`은 `sys.argv[1] == "--replay-frame"`이면 Tk/App을 전혀
안 띄우고 바로 `replay_query.main()`을 호출한 뒤 종료한다 — 패키징된 `AirPointer.exe`를
그대로 재사용해서 이 조회 전용 CLI로도 쓸 수 있다는 뜻이다(`sys.frozen`이면 `sys.executable`
자신, 아니면 `python airpointer_launcher.py`를 커맨드 예시로 씀 — `_replay_query_command_example()`).

### 아직 실측 안 한 것

Codex Desktop이 이 안내문을 보고 실제로 조용히 그 명령을 실행할지는 그 세션의 승인 정책에
달려 있어서, 코드 구조상 "가능"과 실제 사용성은 별개다. 첫 실사용 때 확인이 필요하다.

## 위치 힌트를 3x3 격자에서 실제 UI 요소 이름으로

위 힌트는 처음엔 `_bbox_label()`이 만드는 "오른쪽 아래" 같은 3x3 격자 문구가 전부였다.
이제는 `_bbox_element_label(bbox, width, height)`가 가능하면 "저장 버튼" 같은 실제 UI
요소 이름을 먼저 시도하고, 실패하면(요소가 없거나 이름이 없거나 등) 기존 격자 라벨로
조용히 폴백한다.

동작 방식:
1. `_frame_to_screen_point(bbox, frame_width, frame_height)`가 bbox 중심 좌표를, 녹화된
   프레임 자체의 픽셀 공간(이미 `_grab_screen()`이 1280x720 상한으로 다운스케일한 것)에서
   **현재** 모니터의 실제 물리 픽셀 좌표로 되돌린다. 히스토리적으로 어떤 배율을 썼는지
   재현하는 대신, "이 프레임 크기 / 지금 모니터 크기" 비율을 그때그때 다시 계산해서 쓴다
   — 다운스케일 상수가 나중에 바뀌거나 모니터 배치가 바뀌어도 안전.
2. 이 프로세스는 `airpointer_launcher._make_dpi_aware()`가 시작 시점에 Per-Monitor DPI
   Aware V2로 고정해두므로, mss가 잡은 물리 픽셀 좌표와 UI Automation이 기대하는 좌표계가
   추가 변환 없이 그대로 맞아떨어진다(이 DPI 고정이 없었다면 혼합 DPI 다중 모니터 환경에서
   좌표가 어긋났을 것 — 실제로 HUD 배치에서 겪었던 문제와 같은 종류).
3. `selection_context.element_label_at(x, y)`(`selection_context.py`)가 그 좌표를
   `UIAElementInfo.from_point()`로 조회해서, 이름이 있으면 컨트롤 타입별 한국어 명사
   (`Button`→"버튼" 등, 매핑 없는 타입은 이름만)를 붙여 반환한다.

`element_label_at`은 `get_selected_text()`가 이미 쓰고 있던 UIA 초기화(`IUIA()`,
`UIAElementInfo`)를 그대로 재사용한다 — 새 의존성이나 새로운 COM 초기화 경로 없음.
실패 경로(오프-윈도우, COM 미준비, 요소 없음)는 전부 `None`으로 흡수되고 호출 측이
`_bbox_label()`로 폴백하므로, 이 조회 하나 때문에 캡처 자체가 막히는 일은 없다.

### 실측하며 발견한 문제 1: AirPointer 자신의 HUD 오버레이가 조회를 가로챔

만들고 나서 실제 화면으로 검증하다가(합성 프레임이 아니라 진짜 마우스 좌표로
`element_label_at`을 직접 호출) 처음 버전이 사실상 항상 `None`만 반환한다는 걸
발견했다. 원인: `overlay.py`의 `Overlay`는 AirPointer가 켜져 있는 동안 가상 데스크톱
전체를 덮는 항상-최상단 투명 창인데, 마우스 클릭은 `WS_EX_TRANSPARENT`로 아래 앱에
정상적으로 통과되지만(사용자가 실제로 클릭하면 아래 앱이 눌림), **`IUIAutomation::
ElementFromPoint`는 이 클릭-통과 설정을 무시하고 오버레이 자신을 계속 최상위 요소로
반환**했다 — 같은 좌표에서 순수 Win32의 `WindowFromPoint`(실제 클릭이 쓰는 히트테스트)는
정확히 아래 앱을 찾아내는데도. `info.process_id == _own_pid` 필터가 있어서 틀린 라벨을
만들지는 않았지만(조용히 격자 라벨로 폴백), 의도한 "저장 버튼" 업그레이드가 AirPointer가
켜져 있는 한(=거의 항상) 사실상 발동하지 않는 상태였다.

고친 방법: `element_label_at` 호출 직전 오버레이를 `SetWindowPos(..., SWP_HIDEWINDOW |
SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER)`로 아주 잠깐 숨겼다가, 조회가
끝나면 곧바로 다시 보여준다(포커스 도둑질/이동/크기변경 없이 순수 가시성만 토글). 여기서
두 번째 함정을 만났다: `overlay.py`가 들고 있는 `self._hwnd`(`Overlay.window.winfo_id()`)를
직접 숨겨봐도 아무 효과가 없었다 — **Tk의 `winfo_id()`는 `overrideredirect()` 창의
내부 콘텐츠 핸들(class `TkChild`)이지, Windows가 실제로 Z-order를 매기는 바깥쪽
최상위 창(class `TkTopLevel`)이 아니다.** `GetAncestor(hwnd, GA_ROOT)`로 진짜 최상위
핸들을 구해서 그걸 숨겨야 실제로 효과가 있었다(`register_own_overlay_hwnd`가 등록
시점에 한 번 이 변환을 해둠). 이 두 발견 모두 합성 프레임이 아니라 실제 화면·실제
작업표시줄 버튼으로 검증하는 과정에서만 드러났다 — 단위 테스트만으로는 절대 못 잡았을
종류의 버그.

### 실측하며 발견한 문제 2: 늦게 물어보면 이미 지나간 순간을 잘못 짚을 수 있음

처음 설계는 `export_recent()`가 캡처를 전송하는 시점에(=사건이 벌어지고 최대
`replay_seconds`까지 지난 뒤) `_bbox_element_label`을 불렀다. 그런데 그 사이 화면이
이미 바뀌었을 수 있다 — 15초 전 떴다 사라진 에러 팝업 자리에, 전송 시점엔 전혀 다른 게
있을 수 있는 것. 그래서 조회 시점을 **사건이 감지된 바로 그 순간**으로 옮겼다:
`_ChangeTracker.observe()`가 `_QUIET_FRAMES_TO_CLOSE`(2)개의 조용한 프레임 뒤 이벤트를
`ChangeEvent`로 확정하는 바로 그 지점에서 한 번 조회해서 `ChangeEvent.element_label`에
저장해둔다(프레임마다가 아니라 이벤트 하나가 닫힐 때 딱 한 번 — 매 프레임 UIA 조회를
돌리면 오버레이 숨김/보임까지 얹혀서 실시간 캡처 스레드의 프레임 간격을 흔들 수 있다).
`_select_notable_moments()`와 `export_recent()`는 이제 UI Automation을 직접 부르지
않고, 이미 이벤트에 저장된 `element_label`을 그대로 실어 나르기만 한다.

실측 결과 이 타이밍만으로는 완벽하지 않다는 것도 확인했다: 실제 Notepad 창을 새로
띄워서 검증했을 때, 창이 뜨자마자(=변화 감지가 이벤트를 닫는 바로 그 순간) 조회하면
아직 그 창의 UI Automation 트리가 완전히 준비되지 않아 이름 없는 요소만 잡히는 경우가
있었다(같은 좌표를 1~2초 뒤에 다시 물어보면 정상적으로 이름이 잡힘). 버그라기보다
"막 생성된 창은 UIA에 노출되기까지 아주 약간의 지연이 있을 수 있다"는 실제 OS 동작이다.

이걸 고치는 방법으로 두 가지를 검토했다: (a) 조회를 처음부터 일정 시간 지연시키기,
(b) 즉시 한 번 물어보고 실패했을 때만 짧게 기다렸다가 재시도하기. (a)는 "막 생성된
창"이 아닌 대다수의 평범한 경우(이미 떠 있던 앱 안에서의 토스트/텍스트 변경/스크롤 등,
UIA에 이미 등록된 요소)에도 매번 불필요한 지연을 강제한다는 문제가 있고, 애초에 이
섹션 전체가 풀려던 "너무 늦게 물어봐서 화면이 이미 바뀌었을 수 있다"는 문제를 (작은
폭이지만) 다시 불러오는 셈이다. 그래서 (b)를 택했다: `_bbox_element_label()`이 첫
조회에서 `None`을 받으면 `_ELEMENT_LABEL_RETRY_DELAY`(0.25초)만 기다렸다가 딱 한 번
재조회한다. 이미 준비된 요소(대다수 케이스)는 첫 시도에서 바로 끝나 지연이 전혀 없고,
"방금 생긴 창" 같은 드문 경우에만 그 재시도 비용을 문다. 같은 Notepad 시나리오로
재검증해서 이 재시도로 실제 이름("텍스트 편집기")이 정상적으로 잡히는 것까지 확인했다.

테스트에서는 실제 화면을 실제로 조회하면 그 순간 화면에 뭐가 떠 있느냐에 따라 값이
달라져서 결정론이 깨지므로, `_ChangeTracker`/`ScreenReplayBuffer` 양쪽 다 이 조회
함수를 주입 가능하게 열어뒀다(`grab`/`grab_region`과 같은 기존 패턴). 오버레이
숨김/보임(`_set_own_overlay_visible`)과 재시도 지연(`time.sleep`) 둘 다 스텁으로
바꿔 결정론적으로 검증한다(`tests/test_region_hint.py`, `tests/test_selection_context.py`).

## 관련 연구 / 유사 프로젝트와의 관계

이 파일이 다루는 두 가지 문제 — "리플레이에서 어느 순간이 중요한가"와 "화면의 어느
지점이 바뀌었는가를 사람이 읽을 말로 바꾸기" — 는 이 저장소 안에서 즉흥적으로 생긴
문제가 아니라, 각각 더 큰 연구/제품 흐름 안에 있는 문제다.

- **중요 순간 선택**: `_select_notable_moments()`의 "이벤트 점수로 프레임 채우기" 방식은
  학계의 video highlight detection / change-point detection 계열과 같은 문제 정의를
  공유한다(예: NeurIPS 2025의 "AHA: Predicting What Matters Next"의 온라인 하이라이트
  예측, VSCD의 비정렬 장면 변화 감지). 다만 그쪽은 대개 학습된 모델(오디오·비주얼
  임베딩, 트랜스포머)을 쓰는데, 이 프로젝트는 사용자 노트북 CPU에서 리플레이 녹화와
  동시에 실시간으로 돌아야 해서 학습 모델 대신 저해상도 썸네일 diff + 타일 스코어링이라는
  훨씬 가벼운 방법을 골랐다 — 정확도를 일부 내주고 지연시간/발열/의존성(모델 다운로드,
  GPU 유무)을 없앤 트레이드오프. `_select_events_diverse()`의 다양성 재순위 자체도
  같은 계열의 하위 문제("점수만으로 뽑으면 근-중복 프레임에 수렴해 커버리지를
  잃는다")를 다루는데, 그쪽 최신 해법(AdaRD-key/RD-MV의 facility-location coverage
  항 + log-determinant diversity, Sherman-Morrison 역행렬 업데이트)은 매 프레임 실시간
  스레드와 나란히 돌기엔 무겁다고 판단해서, 대신 1998년부터 있던 훨씬 단순한 MMR
  그리디 재순위(위 "다양성 있는 프레임 선택" 절 참고)로 같은 문제의 가벼운 버전만
  풀었다 — 여기서도 같은 트레이드오프(정확도 vs. 무의존성/저지연)가 반복된다.
- **위치를 사람이 읽을 말로**: `_bbox_element_label()`이 하는 일(스크린샷의 한 지점을
  구조화된 UI 의미로 바꾸기)은 Microsoft의 [OmniParser](https://github.com/microsoft/OmniParser)나
  Google의 [ScreenAI](https://arxiv.org/abs/2402.04615) 같은 "vision-based GUI parsing"
  연구가 푸는 문제와 같다. 차이는 접근 방식이다 — 그쪽은 스크린샷을 비전 모델에 다시
  통과시켜 요소를 추론하지만, 이 프로젝트는 Windows가 이미 알고 있는 접근성
  트리(UI Automation, 화면 읽기 프로그램이 쓰는 바로 그 API)를 조회한다. 비전 모델 호출
  없이 로컬에서 즉시 답이 나오고, 컨트롤 이름이 존재하는 한 픽셀을 보고 추측하는 것보다
  정확하다는 게 장점이지만, 접근성 정보를 제대로 노출하지 않는 앱(일부 게임, 커스텀
  렌더링 UI)에서는 이름이 안 잡혀 조용히 격자 라벨로 폴백한다는 한계가 있다.
- **"항상 켜진 화면 기록"과의 포지셔닝**: 이 프로젝트가 속한 더 큰 카테고리(로컬 AI가
  화면 맥락을 이해해서 돕는 도구)에는 Microsoft의 Windows Recall과, 그 오픈소스
  대안인 [Screenpipe](https://github.com/screenpipe/screenpipe)가 있다. Recall은 출시
  때마다 프라이버시 문제로 연기됐다 — 초기 버전은 평문 DB에 신용카드·주민번호까지 담긴
  스크린샷을 그대로 저장했고, 이를 통째로 유출하는 도구(`TotalRecall`)가 몇 초 만에
  전체 이력을 빼낼 수 있음을 보여줬다. 이 프로젝트의 핵심 설계(30초 링버퍼, 명시적
  제스처/단축키 전에는 아무것도 전송·영구저장 안 함, PRODUCT.md의 "disposable local
  replay, not permanent recording")는 정확히 이 실패를 피하기 위한 것이다: "항상 기록"이
  아니라 "요청받은 순간에만, 아주 짧은 과거만" 보여준다는 점이 이 프로젝트를 Recall류와
  구분 짓는 핵심 주장이다.

## 아직 안 한 것 (의도적으로 범위 밖)

- **변경 영역만 crop해서 전송**: 검토는 했지만 기각했다 — 에러 메시지가 뜬 부분만 잘라
  보내면 "무슨 작업을 하다가 이게 떴는지"라는 주변 맥락이 사라져서, 이 도구의 목적(AI가
  화면 전체 맥락으로 진단)에 반대로 작용한다. bbox는 메타데이터 힌트로만 쓰고, 실제
  전송 이미지는 항상 전체 프레임을 유지하기로 함.
- **다중 동시 변화의 blob 분리**: 화면 여러 군데에서 동시에 작은 변화가 나면 bbox가
  부정확해질 수 있다는 한계를 위에서 언급했는데, 이걸 제대로 풀려면 타일들을 연결
  요소로 묶는 로직이 필요하다. 지금은 안 함.
- **`_QUIET_FRAMES_TO_CLOSE`(2)보다 짧게 나타났다 사라지는 변화**: 물리적으로 복구
  불가능한 영역. capture_fps(현재 5/10/15 중 선택)가 100ms~200ms 간격이라, 그보다 짧게
  뜨고 사라지는 화면은 애초에 grab 시점에 안 걸릴 수도 있다 — 어떤 선택 알고리즘으로도
  해결 안 되고, fps를 올리는 것만 답이다(단, 화질/발열 트레이드오프는 별개 논의).
- **동시에 여러 개의 국소 이벤트가 있을 때의 floor**: `_select_events_diverse`의
  국소 이벤트 보장은 "뽑힌 것 중 국소 이벤트가 하나도 없으면" 딱 1개만 끼워 넣는다.
  같은 구간에 서로 다른 위치의 토스트가 2개 이상 뜨면 그중 점수가 더 높은 것만
  보장되고, 나머지는 여전히 MMR 재순위(점수 경쟁)에 맡겨진다 — 필요해지면 "국소
  이벤트 전용 슬롯 개수"를 늘리는 것도 검토할 만하다.
- **`_REDUNDANCY_LAMBDA`(0.7)/`_LOCALIZED_EXTENT_MAX`(0.05)도 실측 튜닝 아님**: 위
  다른 상수들과 같은 사정 — 합리적인 출발점으로 고른 값이라, 실제 사용 패턴을 보고
  조정이 필요할 수 있다.

## 관련 상수 (전부 `screen_buffer.py` 상단, 튜닝 지점)

| 상수 | 값 | 의미 |
|---|---|---|
| `_THUMB_SIZE` | (160, 90) | diff용 다운스케일 크기 |
| `_PIXEL_THRESHOLD` | 25 | 픽셀당 밝기 차이 임계값(0~255) — 이 이하는 노이즈로 무시 |
| `_TILE_GRID` | (8, 8) | 타일 분할 격자 |
| `_GLOBAL_MIN_SCORE` | 0.02 | 전역 변화 판정 임계값(썸네일 전체 대비 비율) |
| `_TILE_MIN_SCORE` | 0.15 | 타일 단위 변화 판정 임계값(타일 하나 대비 비율) |
| `_QUIET_FRAMES_TO_CLOSE` | 2 | 이벤트를 확정 짓기까지 필요한 연속 "조용한" 프레임 수 |
| `_REDUNDANCY_LAMBDA` | 0.7 | `_select_events_diverse`에서 겹치는 이벤트를 얼마나 세게 깎을지(1.0=완전 겹치면 0점, 0.0=다양성 없음) |
| `_LOCALIZED_EXTENT_MAX` | 0.05 | 이 미만이면 "국소적"(토스트류)으로 보고 최저 슬롯 보장 대상이 됨 |
| `_MANIFEST_TTL_SECONDS` | 600 | 매니페스트+복사된 세그먼트를 dispatch 폴더에 보존하는 시간 |
| `_MANIFEST_SWEEP_INTERVAL_SECONDS` | 60 | 만료된 매니페스트 폴더를 스캔하는 주기 |

전부 실측 기반 튜닝이 아니라 합리적인 출발점으로 고른 값들이라, 실제 사용 패턴을 보고
조정이 필요할 수 있음(특히 `_TILE_MIN_SCORE`는 화면 해상도/DPI에 따라 체감이 다를 수
있음).
