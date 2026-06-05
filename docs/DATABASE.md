# DB 스키마

> PostgreSQL 16 (`track_block`) — 모든 데이터는 API를 통해서만 접근

---

## 테이블 계층

```
rail_routes
  ├── rail_track_sections           KP 구간별 선로수·전차선 예외
  ├── rail_route_station_points     노선별 역 KP
  ├── rail_facilities               시설물 (터널/교량/변전소 등)
  ├── rail_baseline_points          KP+GPS anchor 원천
  ├── rail_computed_geometry        노선도 좌표 (all_points 모드 SOT)
  └── rail_route_region_boundaries  관할 구간 경계

organizations
  ├── users
  ├── org_viewport                  지역본부 초기 지도 뷰포트
  ├── organization_route_ranges     관할 담당구역 (→ rail_routes FK)
  └── block_orders ─── routes(legacy) · rail_routes

system_settings                     색상·지도 설정 (24개)
```

---

## 핵심 테이블

### `block_orders`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `tracks` | TEXT | JSON 배열 — `["상선"]` / `["T1","T2"]` 등 |
| `block_type` | TEXT | **대표명령** / 선로차단 / 전차선단전 / 작업구간설정 / 보호지구작업 / 임시완속 / 속도제한 |
| `work_type` | TEXT | 인력 / 장비 / 기계 (NULL 허용) |
| `implementer` | TEXT | 철도공사(기본) / 철도공단 / 외부 |
| `start_kp/end_kp` | FLOAT | KP 기반 보간 기준 |
| `start_km/end_km` | FLOAT | legacy 호환 (km=KP) |
| `danger_level` | TEXT | A / B / C / NULL |
| `doc_no` | TEXT | 사업 묶음 연계 키 |
| `parent_id` | INTEGER | 대표명령 자기참조 FK (NULL=대표명령 자신, 값=하위작업) |
| `equipment_name` | TEXT | 투입장비(작업차량) 명칭 |
| `speed_restriction` | INTEGER | 열차서행 제한속도 (km/h) |
| `speed_restriction_note` | TEXT | 열차서행 구간/사유 |
| `catenary_protection` | TEXT | 전차선 보호장치 (양단접지 / 단접지) |
| `zep` | TEXT | 관제사 보호조치 ZEP 코드 (고속선) |
| `zcp` | TEXT | 관제사 보호조치 ZCP 코드 (고속선) |
| `cpt` | TEXT | 작업자 보호조치 CPT 코드 (고속선) |
| `tzep` | TEXT | 작업자 보호조치 TZEP 코드 (고속선) |
| `worker_count` | INTEGER | 작업자 수 |

**선로 이름 체계**:

| 구분 | 선로명 |
|---|---|
| 단선 | 상선 |
| 복선 | 상선, 하선 |
| 2복선 | 상1, 상2, 하1, 하2 |
| 3복선 | 상1, 상2, 상3, 하1, 하2, 하3 |
| **고속선** | T1(하1) · T2(상1) · T3(하2) · T4(상2) · T5(하3) · T6(상3) · T7(하4) · T8(상4) |

고속선 T번호: 홀수=하선, 짝수=상선, 선로 중심에서 외측 방향으로 번호 증가.

**대표명령 계층 구조**:
```
대표명령 (parent_id=NULL, block_type='대표명령')
  ├─ 선로차단    (parent_id=N)
  ├─ 전차선단전  (parent_id=N)
  └─ 작업구간설정 (parent_id=N)
```
API: `GET /api/v1/block-orders/{id}/children`

### `organizations`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `sort_order` | INTEGER | 표시 순서 (서울=1 ~ 고속전기=14) |

**정렬 순서**: 서울 → 수도권서부 → 수도권동부 → 강원 → 충북 → 대전충남 → 전북 → 광주 → 전남 → 경북 → 대구 → 부산경남 → 고속시설 → 고속전기

### `organization_route_ranges`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `rail_route_id` | INTEGER | FK → rail_routes.id (153개 노선 모두 선택 가능) |
| `field` | TEXT | all(행정경계) / 시설 / 전기 / 건축 |
| `start_km` | FLOAT | 담당 구간 시작 KP |
| `end_km` | FLOAT | 담당 구간 종료 KP |

### `org_viewport`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `center_lat/lon` | FLOAT | 지역본부 HQ 역 GPS 기준 |
| `zoom_level` | FLOAT | 기본 3.0 |

### `rail_baseline_points`

KP 보간의 원천 데이터.

| point_type | 용도 | center_only 모드 |
|---|---|---|
| `station_center` | 역 중심 GPS | ✅ 포함 |
| `facility_point` | 변전소 등 점 시설물 | ✅ 포함 |
| `facility_start` | 터널·교량 시작점 | ✅ 포함 (본선 위) |
| `facility_end` | 터널·교량 종점 | ✅ 포함 (본선 위) |
| `station_yard_start` | 역 구내 진입로 | ❌ 제외 (곡선 유발) |
| `station_yard_end` | 역 구내 출구 | ❌ 제외 (곡선 유발) |

### `rail_computed_geometry`

all_points 모드에서 사용하는 노선 geometry SOT.  
KP 0.5km 간격 보간. LOD: high / mid / low.

재계산: `POST /api/v1/admin/rail-routes/rebuild-computed`

### `system_settings`

| category | key | 기본값 | 설명 |
|---|---|---|---|
| route_colors | highway | #dc2626 | 고속선 |
| route_colors | electrified | #f97316 | 일반선 전철화 |
| route_colors | non_electrified | #9ca3af | 일반선 비전철 |
| route_colors | catenary_cut | #16a34a | 전차선단전 |
| block_colors | track_block | #ca8a04 | 선로차단 |
| block_colors | danger_zone | #ca8a04 | 위험/보호지구 |
| danger_colors | level_a/b/c/none | 적/황/녹/회색 | 위험등급 |
| facility_colors | (12개) | 각 색상 | 시설물 |
| map_settings | station_points_mode | center_only | center_only \| all_points |
| map_settings | stroke_cap_zoom | 5 | 선두께 포화배율 (2~20) |

---

## Alembic 마이그레이션

```bash
# 스키마 최신화
alembic upgrade head

# 현재 버전 확인
alembic current
# → tc09_block_order_parent
```

| revision | 내용 |
|---|---|
| tc01 | rail_routes.default_track_count/has_catenary + rail_track_sections |
| tc02 | block_orders.work_type + implementer |
| tc03 | rail_facilities.bore_type |
| tc04 | system_settings 테이블 + 색상 시드 |
| tc05 | direction → tracks TEXT(JSON), 단선차단→선로차단 통합 |
| tc06 | org_route_ranges: route_id(legacy) → rail_route_id (153개 노선) |
| tc07 | organizations.sort_order |
| tc08 | block_orders: catenary_protection / ZEP·ZCP·CPT·TZEP / worker_count |
| tc09 | block_orders: parent_id / equipment_name / speed_restriction[_note] |

---

## PostgreSQL 운영

```bash
# 서버 상태 확인
brew services list | grep postgresql

# DB 접속
psql -d track_block

# 전체 백업
pg_dump track_block > track_block_$(date +%Y%m%d).sql

# 기준데이터만 백업 (운영 차단명령 제외)
pg_dump --data-only \
  --exclude-table=block_orders \
  --exclude-table=alembic_version \
  track_block > reference_data_$(date +%Y%m%d).sql
```

---

## 노선 현황 (2026-06-05)

| 구분 | 수 |
|---|---|
| 활성 노선 | 153개 |
| 역/KP 포인트 | 1,066개 |
| baseline 포인트 | 2,453개 |
| computed geometry | 16,226건 |

**주요 변경 이력**:
- 수서고속선(H3) → **수서평택고속선** 명칭 변경
- 동해선(경주-영덕, 8B) **삭제** — 동해선(75)과 KP 110~188 중복
- 서해선(0.69~47km) + 서해남부선(47~135km) → **서해선 통합** (0.69~135.703km, 24개 역)
