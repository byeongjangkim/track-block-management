# 개발 계획 (plan.md)

> 프로젝트: 선로차단작업 관리 프로그램 (Track-Block-Management)  
> 마지막 갱신: 2026-06-03 (Phase I 완료)

---

## Phase 완료 현황

| Phase | 주요 내용 | 상태 |
|---|---|---|
| **Phase 1** | DB 스키마, 권한·조직, 노선도 geometry, 차단명령 CRUD, PDF 파싱, 시설물 관리 | ✅ 완료 |
| **Phase A~C+** | rail_computed_geometry 구축, 노선 커버리지 확대 (77노선) | ✅ 완료 |
| **Phase D~D+** | 기지 차단작업, rail_facilities 지도 표시, geometry 자동 재계산 | ✅ 완료 |
| **Phase E** | 위험등급 분류·시각화, 차단현황도 인터랙션 | ✅ 완료 |
| **Phase F** | 노선 색상 체계, 선로 구성(복선·단선), 전차선 유무, 작업형태·시행주체 | ✅ 완료 |
| **Phase G** | 터널·교량 심볼, 다중 레인 차단구간, fly-to 포커스 | ✅ 완료 |
| **Phase H** | 시스템 설정(색상 관리), 사업건별 지도 강조, 연속 작업 감지 | ✅ 완료 |
| **Phase I** | tracks 모델 전환, 노선도 좌표 모드, 다복선 LOD, 차단구간 두께·배지 개선 | ✅ 완료 |

---

## Phase H 완료 내역 (2026-06-02)

### 1. 시스템 설정 (System Settings) ✅

**목적**: 지도에 표시되는 색상을 DB에 저장하여 관리자가 UI에서 직접 변경

**DB**: `system_settings` 테이블 (Alembic `tc04_system_settings`)
```
category / key / value / default_value / label / description / sort_order
카테고리: route_colors | block_colors | danger_colors | facility_colors
```

**초기 색상 시드 (22개)**:
- route_colors: highway, electrified, non_electrified, catenary_cut
- block_colors: track_block, danger_zone
- danger_colors: level_a, level_b, level_c, none
- facility_colors: station_master, station_general, ... (12개)

**백엔드 API** (`/api/v1/settings`):
- `GET /settings` — 전체 조회
- `PATCH /settings/{category}/{key}` — 값 변경 (superuser)
- `POST /settings/{category}/{key}/reset` — 단일 기본값 복원
- `POST /settings/reset-all` — 전체 기본값 복원

**프론트엔드**:
- `src/store/settingsStore.ts` — Zustand 전역 상태 (앱 시작 시 로드)
- `src/api/settings.ts` — API 클라이언트
- `src/pages/SystemSettingsPage.tsx` — 색상 피커 UI (superuser 전용)

**색상 적용 방식**: 새로고침 후 반영 (settingsStore → D3 rendering)
- RailwayMap.tsx의 하드코딩 색상 상수 → settingsStore 파생값으로 교체
- `TRACK_BLOCK_COLOR_S`, `CATENARY_CUT_COLOR_S`, `DANGER_MARKER_COLORS_S` 등

### 2. 메뉴 구조 변경 ✅

```
변경 전: [사용자 관리] (superuser 단일 메뉴)
변경 후: [시스템 관리 ▼] (드롭다운)
          ├─ 사용자 관리  (/admin/users)
          └─ 시스템 설정 (/admin/settings)
```

### 3. 사업건별 지도 강조 ✅

**같은 doc_no = 같은 사업 묶음** 시각화:
- 차단명령 카드 클릭 → 같은 doc_no 건들은 밝게, 나머지는 opacity × 0.25로 흐리게
- `RailwayMap`에 `highlightedBlockIds?: Set<number>` prop 추가
- 상세 패널에 "📋 사업 묶음 문서 XXX — N건" 표시

### 4. 연속 작업 감지 ✅

**±45일 확장 쿼리**로 같은 노선·방향·구간·분야의 연속 날짜 자동 탐지:
- 상세 패널에 "📅 연속 작업 YYYY-MM-DD ~ YYYY-MM-DD  [N일]" 표시
- 선택된 건이 있을 때만 확장 쿼리 실행 (`enabled: !!selectedId`)

### 5. 차단명령 목록 문서번호 필터 ✅

- BlockOrdersPage에 `doc_no` 텍스트 검색 입력란 추가
- 같은 사업 문서의 날짜별 전체 건 조회 가능

### 6. 기타 버그 수정 ✅

- **팝업 닫기 버튼**: `data-panel-close` 속성으로 드래그 핸들러에서 완전 분리
  - 이전: 헤더 전체 `onMouseDown`에 drag 핸들러 → 닫기 버튼 click 간섭
  - 수정: `closest('[data-panel-close]')` 체크로 닫기 버튼 영역 제외
- **선로수 옵션 레이블**: `"N선 — 이름"` → `"이름 (N선)"` 형식으로 통일

---

## Phase I 완료 내역 (2026-06-03)

### 1. 선로(tracks) 모델 전환 — Alembic `tc05_tracks_field` ✅

**변경 내용**: `block_orders.direction VARCHAR(4)` → `tracks TEXT` (JSON 배열)

| 이전 | 이후 |
|---|---|
| `direction = 'UP'` | `tracks = '["상선"]'` |
| `direction = 'DOWN'` | `tracks = '["하선"]'` |
| `direction = 'BOTH'` | `tracks = '["상선","하선"]'` |

- `block_type`: 단선차단/복선차단 → **선로차단** 통합
- 선로 이름 체계: 복선=상선/하선, 2복선=상1~하2, 3복선=상1~하3
- 등록 폼: 방향 드롭다운 → 선로 체크박스 (노선 `default_track_count` 기반)
- routes API에 `default_track_count` 추가 (rail_routes 이름 매핑)

### 2. 차단구간 렌더링 개선 ✅

**선로 이름 기반 물리 위치 계산**:
- `trackNameToIndex()`: 상선→0, 하선→1, 상1~하3→2복선/3복선 인덱스
- `blockSegmentOffsetSvg()`: 선로 이름 + 노선 선로 수 + 레인 인덱스 → SVG 오프셋
- GeoJSON feature에 `track`(선로명), `route_track_count`(노선 선로 수) 속성 추가

**차단구간 선 두께 zoom 반응**:
- 이전: `6/√k` (zoom 증가할수록 얇아짐)
- 이후: `3 + log₂(k)` (zoom 증가할수록 두꺼워짐)

**다복선(2복선·3복선) 선로 간격 LOD**:
- zoom ≤ 5.8: 압축 모드 (복선과 동일 스팬)
- zoom 5.8→20: 점진적 확장
- zoom ≥ 20: 완전 확장 (선로 간 간격 = 복선 상하선 간격 단위)

**배지 클릭 fly-to 복원**:
- `g.block-badge` 요소에 `.on('click', ...)` 핸들러 재추가
- zoom=2.5, 배지 중심점으로 700ms 애니메이션

### 3. 역 좌표 모드 (station_points_mode) ✅

**목적**: 역 구내 진입로(station_yard_start/end) 좌표에 의한 예상치 못한 노선 굴곡 방지

**설정**: `system_settings.map_settings.station_points_mode`
- `center_only` (기본): 역중심 + 시설물 앵커만 사용
- `all_points`: 기존 rail_computed_geometry 전체 사용

**핵심 규칙**:
1. 노선 geometry 렌더링과 차단명령 KP 보간은 동일한 앵커 셋 사용
2. `facility_start/end`(터널·교량)는 center_only에서도 반드시 포함
3. `station_yard_start/end`만 center_only에서 제외

**프론트엔드**: `settingsStore.stationPointsMode` → geometry queryKey에 포함 → 설정 변경 시 자동 재요청

**시스템 설정 페이지**:
- "지도 설정" 섹션 추가 (라디오 버튼 UI)
- 저장 후 `loadSettings()` + `queryClient.invalidateQueries()` 동시 호출

---

## 현재 운영 환경

| 항목 | 값 |
|---|---|
| 백엔드 포트 | 7000 |
| 프론트엔드 포트 | 7001 |
| DB | `backend/db.sqlite3` (SQLite) |
| 노선 수 | 156개 (본선 143 + 기지 13) |
| Baseline 보유 노선 | 77개 |
| Computed geometry | 77개 노선, 16,295점 |
| 시스템 설정 항목 | 23개 (색상 22개 + station_points_mode 1개) |

---

## Alembic 마이그레이션 이력

| revision | 내용 |
|---|---|
| `tc01_rail_track_sections` | rail_routes 선로수·전차선 + rail_track_sections 테이블 |
| `tc02_work_type_implementer` | block_orders.work_type + implementer |
| `tc03_bore_type` | rail_facilities.bore_type (터널·교량 선로 적용 방식) |
| `tc04_system_settings` | system_settings 테이블 + 22개 색상 시드 |

---

## 향후 개발 계획

| Phase | 주요 내용 | 우선도 |
|---|---|---|
| **Phase I** | 선로차단 ON-TRACK 직접 표시, 선로변 작업 오프셋 분리 | 높음 |
| **Phase J** | 노선 hover/click → 노선 정보 팝업 | 중 |
| **Phase K** | 시설물 아이콘 이미지 교체 (Phase 2 예정) | 낮음 |
| Phase 2 | PostgreSQL 전환, LOD 자동 전환 | 높음 |
| Phase 3 | 통계 대시보드, 모바일 반응형 | 중 |
| Phase 4 | Linux 서버 이전, 알림·보고서 기능 | 낮음 |
