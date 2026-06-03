# DB 스키마

> SQLite (`backend/db.sqlite3`) — 모든 데이터는 API를 통해서만 접근

---

## 테이블 계층

```
rail_routes
  ├── rail_track_sections        KP 구간별 선로수·전차선 예외
  ├── rail_route_station_points  노선별 역 KP
  ├── rail_facilities            시설물 (터널/교량/변전소 등)
  ├── rail_baseline_points       KP+GPS anchor 원천
  ├── rail_computed_geometry     노선도 좌표 (all_points 모드 SOT)
  └── rail_route_region_boundaries  관할 구간 경계

organizations
  ├── users
  └── block_orders ─── routes(legacy) · rail_routes

system_settings                  색상·지도 설정
```

---

## 핵심 테이블

### `block_orders`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `tracks` | TEXT | JSON 배열 — `["상선"]` / `["상1","하1"]` 등. tc05에서 direction 대체 |
| `block_type` | TEXT | 선로차단 / 전차선단전 / 작업구간설정 / **보호지구작업** / 임시완속 / 속도제한 |
| `work_type` | TEXT | 인력 / 장비 / 기계 (NULL 허용) |
| `implementer` | TEXT | 철도공사(기본) / 철도공단 / 외부 |
| `start_kp/end_kp` | REAL | KP 기반 보간 기준 |
| `start_km/end_km` | REAL | legacy 호환 (km=KP) |
| `danger_level` | TEXT | A / B / C / NULL |
| `doc_no` | TEXT | 사업 묶음 연계 키 |

**선로 이름 체계**:
- 복선(2): 상선, 하선
- 2복선(4): 상1, 상2, 하1, 하2
- 3복선(6): 상1, 상2, 상3, 하1, 하2, 하3

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
cd backend && source .venv/bin/activate
alembic upgrade head
```

| revision | 내용 |
|---|---|
| tc01_rail_track_sections | rail_routes 선로수·전차선 + rail_track_sections |
| tc02_work_type_implementer | block_orders work_type + implementer |
| tc03_bore_type | rail_facilities bore_type |
| tc04_system_settings | system_settings 테이블 + 색상 시드 |
| tc05_tracks_field | direction→tracks JSON, 단선/복선차단→선로차단 |

---

## 권한 검증 규칙

| role | 조건 |
|---|---|
| `system_superuser` | 무조건 허용 |
| `user` | 거부 (조회 전용) |
| `org_admin` | 자기 조직 관할 km 범위 내 |
| `org_admin` + 기지 노선 | KP 검증 생략, 소속 조직 확인만 |

크로스-org (여러 조직 관할 걸치는 구간): `system_superuser`만 허용.

---

## 주의사항

- `tracks` (block_orders): JSON 텍스트로 저장, API에서 list[str]로 파싱
- `km` = `KP` (동일 의미, 다른 컬럼은 legacy 호환)
- `bcrypt==4.0.1` 고정 (5.x API 변경으로 비호환)
- `db.sqlite3` `.gitignore` 처리
