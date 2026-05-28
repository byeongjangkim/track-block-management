# 개발 계획 (plan.md)

> 프로젝트: 선로차단작업 관리 프로그램 (Track-Block-Management)  
> 마지막 갱신: 2026-05-29 (Phase D+ 완료 — rail_facilities 지도 표시 + 시설물 등록 시 geometry 자동 재계산)

---

## Phase 완료 현황

| Phase | 주요 내용 | 상태 |
|---|---|---|
| **Phase 1** | DB 스키마, 권한·조직, 노선도 geometry (route_geometry), 차단명령 CRUD, PDF 파싱, 시설물 관리 | ✅ 완료 |
| **Phase A** | `rail_routes.line_type` 분류 추가 (고속선/일반선), `rail_computed_geometry` 테이블 신설, rail_reference API line_type 필터 | ✅ 완료 |
| **Phase B** | `rail_baseline_points` → `rebuild_computed_geometry.py` 보간 (77개 노선 16,295점), `/map/rail-routes/all/geometry` API, Admin rebuild API, D3 `routes-computed` 레이어 | ✅ 완료 |
| **Phase B+** | 고속선/일반선 토글 UI (`hiddenLineTypes`), KP 기반 역 오버레이 (`/map/rail-routes/all/stations`, 833역 실좌표) | ✅ 완료 |
| **Phase C** | `route_geometry` D3 레이어 제거 → `rail_computed_geometry` 단일 렌더링 전환 (50→77 노선 커버리지 확대) | ✅ 완료 |
| **Phase C+** | `route_geometry` 테이블 완전 제거 (Alembic `a0b1c2d3e4f5`), 관련 API·서비스·파이프라인 전체 삭제, org-boundaries KP 기반 전환, 모든 문서 업데이트 | ✅ 완료 |
| **Phase D** | 기지 차단작업 KP 기반 관리 인프라 구축, 분류 코드 2종 추가 (`ELEC_SIGNAL_GENERAL`, `ELEC_COMM_RS`) | ✅ 완료 |
| **Phase D+** | rail_facilities 지도 표시, 시설물 등록 시 geometry 자동 재계산, LineString 시설물 클릭 팝업 | ✅ 완료 |

---

## Phase D 완료 내역 (2026-05-28)

### 1. 시설물 분류 코드 2종 추가 ✅

| code | 분류 | Alembic |
|---|---|---|
| `ELEC_SIGNAL_GENERAL` | 전기설비 > 신호설비 > 신호기계실 (3차 없음) | `b2c3d4e5f6a7` |
| `ELEC_COMM_RS` | 전기설비 > 통신설비 > 무선기지국 / RS | `b2c3d4e5f6a7` |

### 2. 기지 차단작업 KP 기반 관리 인프라 ✅

**설계 원칙:** 기지(차량기지·보수기지)를 `line_type='기지'`인 별도 `rail_routes`로 등록.  
기지 내부 KP는 인출선 분기점 = 0.0 기산. 기존 차단명령 체계(block_orders) 그대로 재사용.

**변경 목록:**

| 계층 | 변경 내용 |
|---|---|
| DB (Alembic `c3d4e5f6a7b8`) | `block_orders.track_name TEXT` 컬럼 추가 |
| Backend model | `BlockOrder.track_name` Mapped 컬럼 추가 |
| Backend schema | `BlockOrderCreate/Update/Response`에 `track_name` 추가, `direction` validator → `UP/DOWN/BOTH` |
| Backend block_orders API | `_assert_can_register()`: `line_type='기지'` 노선은 KP 관할구간 검증 생략 |
| Backend map.py | `GET /api/v1/map/rail-routes/depots` 신규 — 기지 목록 반환 |
| Seed data | `database/seeds/rail_depots.py` — 13개 기지 등록 완료 |
| Frontend types | `Direction = 'UP' | 'DOWN' | 'BOTH'`, `BlockOrderCreate.route_id: number | null`, `track_name` 추가 |
| Frontend api/map.ts | `DepotRoute` 인터페이스 + `fetchDepotRoutes()` |
| Frontend BlockOrderForm | 본선/기지 탭 전환 UI, 기지 선택 시 선로·구역명 입력, BOTH 방향 옵션 |

---

## Phase D+ 완료 내역 (2026-05-29)

### 1. rail_facilities 지도 표시 ✅

**신규 API:**  
`GET /api/v1/map/rail-routes/all/facility-items` — `is_active=1` 시설물을 FacilityCollection GeoJSON으로 반환.

| 항목 | 내용 |
|---|---|
| 파일 | `backend/app/api/v1/map.py` |
| `구조물` 분류 | type=`구조물`, station_type=sub_category (터널/교량 등) |
| `전기설비` 분류 | type=`변전소`, station_type=detail_category.lower() (ss/sp 등) |
| geometry | linear + 시작·종료 GPS → LineString, 그 외 → Point |

**프론트엔드:**

| 항목 | 내용 |
|---|---|
| `frontend/src/api/map.ts` | `fetchAllRailFacilities()` 추가 |
| `RailwayMap.tsx` | `railFacilitiesData` useQuery (staleTime:0), `mergedFacilityFeatures`에 병합 |

### 2. 시설물 등록·수정·삭제 시 geometry 자동 재계산 ✅

`backend/app/api/v1/rail_reference.py`에 `_rebuild_computed_geometry_route()` 헬퍼 추가.  
`rail_facilities` create / update / delete 핸들러에서 `_sync_facility_baseline_points()` 직후 자동 호출.  
`maps/pipeline/rebuild_computed_geometry.py` 스크립트와 동일 로직(3 LOD 선형 보간).

### 3. LineString 시설물 클릭 팝업 수정 ✅

터널·교량·과선교(`segLayer` path)에 `.on('click', ...)` 핸들러 부재로 클릭 시 팝업이 뜨지 않던 버그 수정.  
`cursor: pointer` + 클릭 시 `setPopupRef` 호출 → 이름·노선명·KP 범위 팝업 표시.

---

## Phase C — 완료

`route_geometry` D3 레이어를 완전 제거하고 `rail_computed_geometry` 단일 렌더링으로 전환 완료.

**결과:**
- D3 렌더링: `route_geometry` 레거시 레이어 → 완전 제거
- 노선 커버리지: 50개 → **77개** (27개 순 증가)
- 일시 미표시: 10개 소규모 화물선/지선 (앵커 부족 — 추가 baseline 데이터 입력 시 복구)
- 사이드바: 레거시 per-route 체크박스 제거 → `hiddenLineTypes` (고속선/일반선) 토글로 통일
- 시설물 레이어: 레거시 km 보간 → KP 기반 실좌표 (833역)으로 전환

**미표시 10개 노선** (기존 route_geometry 포함이었으나 baseline 앵커 부족):
부전마산선, 북전주선, 북평선, 대불선, 덕산선, 군산선, 군산항선, 화순선, 진해선, 온산선
→ `rail_baseline_points`에 KP+GPS 앵커 2개 이상 추가 시 자동 복구

---

## 향후 개발 계획

| Phase | 주요 내용 | 우선도 |
|---|---|---|
| **Phase E** | 기지 내 선로 목록 관리 (`rail_depot_tracks` 테이블), block_orders 등록 시 드롭다운 선택 | 중 |
| **Phase E+** | 기지 KP anchor 추가 → `rail_computed_geometry` 보간 → 지도에 기지 레이아웃 표시 | 중 |
| Phase 2 | 관할구간 KP 슬라이싱, LOD 자동 전환, PostgreSQL 전환 | 높음 |
| Phase 3 | 역구내 배선도 팝업, 통계 대시보드, 모바일 반응형 | 중 |
| Phase 4 | Linux 서버 이전, 알림·보고서 기능 | 낮음 |

---

## 현재 운영 환경

| 항목 | 값 |
|---|---|
| 백엔드 포트 | 7000 |
| 프론트엔드 포트 | 7001 |
| DB | `backend/db.sqlite3` (SQLite) |
| 노선 수 | 156개 (`rail_routes`: 본선 143 + 기지 13) |
| Baseline 보유 노선 | 77개 (`rail_baseline_points` ≥ 2점) |
| Computed geometry | 77개 노선, 16,295점 |
| 레거시 geometry | 50개 노선 (`route_geometry`) |
