# 개발 계획

> 마지막 갱신: 2026-06-03 (Phase K)

---

## 현재 완료 상태

| 구분 | 내용 |
|---|---|
| DB 스키마 | block_orders.tracks(JSON), system_settings, rail_track_sections, bore_type |
| 권한/조직 | 14개 조직, 3단계 role, 관할구간 검증 |
| 차단명령 CRUD | 등록/수정/삭제, PDF 일괄 파싱, 연속작업 감지 |
| 지도 렌더링 | SVG 월드 단위 기반, station_points_mode, strokeCapZoom |
| 시설물 | rail_facilities 지도 표시, 터널/교량 심볼 |
| 시스템 설정 | 색상 22개 + map_settings 2개 (station_points_mode, stroke_cap_zoom) |
| 선로 모델 | tracks JSON (상선/하선/상1~하3), 단선차단→선로차단 통합 |
| 차단작업 표시 원칙 | 선로차단(노선위), 작업구간설정(+0.5gap 외방), 보호지구작업(+1.0gap 해칭), 분야별 마커 |
| 기준정보 관리 UX | 역/KP·시설물 관리: 드롭다운 → 노선 목록+검색 2단계 뷰 (노선원장 패턴 통일) |
| 노선별 집계 API | `/rail-reference/routes/route-summaries` — 역 수/GPS/오류/시설물 수 집계 |

---

## 현재 운영 환경

| 항목 | 값 |
|---|---|
| 백엔드 포트 | 7000 |
| 프론트엔드 포트 | 7001 |
| DB | backend/db.sqlite3 |
| 노선 수 | 156개 (본선 143 + 기지 13) |
| Baseline 보유 노선 | 77개 |
| 시스템 설정 항목 | 24개 |

---

## 미구현 / 예정

### 우선 검토 필요
- **노선 KP 다이어그램 뷰** — 단일 노선의 KP 축 기반 차단현황 시각화 (사용자가 검토 요청)
  - 전체 노선 / 지역본부 구간 / 사용자 입력 구간 선택
  - x축=KP, y축=시간 또는 선로 레인, 직사각형=차단블록

### 향후 개선 검토
- **선로/선로 외측 투입 장비 표시** — 선로차단 작업 시 실제 투입되는 장비(보선장비, 전철장비 등)를
  차단작업 팝업 내 표시 또는 노선도에 직접 심볼로 표시하는 방안 별도 검토 예정

### 추후 구현
- 기지 노선 선로 다중 선택 (현재 상선/하선만 기본 지원)
- 차단명령 PDF 자동 주기 파싱/알림
- 모바일 반응형 (Phase 3)

---

## 주요 아키텍처 결정 이력 (반복 참조용)

### SVG 월드 단위 렌더링 (2026-06-03)
- **결정**: 모든 railway 요소를 SVG world unit으로 표현, non-scaling-stroke 제거
- **근거**: D3 geoMercator scale=12180 (1 SVG unit≈418m). 화면픽셀 고정값은 zoom과 불일치 유발
- **strokeCapZoom**: k≤5에서 자연 성장, k>5에서 픽셀 고정 (사용자 설정 가능)
- **⚠️ 주의**: capStrokeSvg를 zoom handler AND 각 useEffect 렌더링 양쪽에 적용 필수.
  useEffect에서만 누락해도 클릭/선택 시 두께가 달라지는 버그 발생

### tracks 모델 (2026-06-03, tc05)
- **결정**: direction(UP/DOWN/BOTH) → tracks JSON 배열 (상선/하선/상1~하3)
- **근거**: 단선/복선 구분 혼동 제거, 다복선 명확 표현
- **주의**: DB 저장은 JSON 텍스트, API 응답은 list[str]로 파싱 필요

### station_points_mode (2026-06-03)
- **결정**: center_only(기본) / all_points 선택
- **근거**: station_yard_start/end가 역 진입로 곡선을 만들어 예상치 못한 굴곡 발생
- **⚠️ 주의**: facility_start/end(터널·교량 경계)는 center_only에서도 반드시 포함
- **⚠️ 주의**: 노선 렌더링과 KP 보간이 반드시 동일 앵커 사용 — 불일치 시 차단구간 이탈

### assignLanes KP 범위 검증 (2026-06-03)
- **결정**: 같은 노선/선로라도 KP가 겹치지 않으면 lane=0 (선로 위)으로 배정
- **근거**: KP 범위 무관 순번 배정 시 두 번째 블록이 선로 외측에 표시되는 버그
- **구현**: `kpOverlaps(a, b)` 함수로 실제 겹치는 블록만 lane>0 배정

### KP 보간 법선 방향 오차 방지 (2026-06-03)
- **결정**: `_rail_kp_range_coords`가 블록 KP 범위 앞뒤 맥락 앵커 1개씩 포함 반환
- **근거**: 맥락 앵커 없으면 블록 시작점 법선 방향이 노선과 달라져 오프셋 위치 어긋남
- **구현**: 프론트엔드 `buildOffsetPath`에서 맥락 앵커(첫·마지막 점) 제외 후 렌더링

### 기준정보 관리 UX 통일 (2026-06-03)
- **결정**: 역/KP 관리, 시설물 관리를 노선원장과 동일한 목록+검색 2단계 뷰로 변경
- **근거**: 드롭다운으로는 오류 있는 노선을 156개 중 찾기 어려움. 목록에서 오류 수 배지로 한눈에 파악
- **API**: `GET /rail-reference/routes/route-summaries` — 역 오류/GPS/시설물 집계 (rail_stations JOIN)
- **패턴**: 1단계(목록+검색+집계) → 클릭 → 2단계(상세, ← 목록 뒤로가기)
- **⚠️ 주의**: `rail_route_station_points`에 lat/lon 없음 → `rail_stations` JOIN 필요

### 차단작업 표시 원칙 (2026-06-03)
- **결정**: block_type별 노선도 표시 위치/방법 정립
  - 선로차단: 노선 위 직접, 노란 실선, BLOCK_STROKE_SVG (=노선의 2배), `stroke-linecap=butt`
  - 작업구간설정: 최외방 선로 +0.5×gap 외방, 노란 실선
  - 보호지구작업: 최외방 +1.0×gap 외방, 사각형+해칭(높이=2×gap), 신규 block_type
  - 분야 마커: 시설=노란, 전기=녹색, 건축=보라, 선로 외방 1.0×gap 위치, 크기 2배
