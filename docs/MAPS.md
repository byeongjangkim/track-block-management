# maps — GIS 파이프라인

---

## 역할 구분

| 데이터 종류 | 저장 위치 | 설명 |
|---|---|---|
| **노선 geometry (최종 SOT)** | `rail_computed_geometry` DB 테이블 | baseline anchor 보간 생성, 고속선/일반선 대분류 지원, 77개 노선 |
| **시도·시군구 경계** | `maps/data/*.geojson` 정적 파일 | NGII 데이터 전처리, 서버 파일 서빙 |

> `route_geometry` 테이블은 2026-05-27 Alembic `a0b1c2d3e4f5` 마이그레이션으로 완전 제거됨.

---

## 1. 노선 geometry 아키텍처

### 1-1. KP 기반 보간 원칙

노선도는 역·시설물의 **KP(거리정) + GPS(위도·경도)**를 anchor로 삼아 좌표를 보간 생성한다.

| anchor 유형 | 원천 테이블 | point_type |
|---|---|---|
| 역 중심 | `rail_route_station_points.center_kp` | `station_center` |
| 역 구내 시작 | `rail_route_station_points.yard_start_kp` | `station_yard_start` |
| 역 구내 종료 | `rail_route_station_points.yard_end_kp` | `station_yard_end` |
| 점 시설물 | `rail_facilities.kp_start` | `facility_point` |
| 구간 시설물 시작 | `rail_facilities.kp_start` | `facility_start` |
| 구간 시설물 종료 | `rail_facilities.kp_end` | `facility_end` |
| 수동 보정점 | 직접 입력 | `manual_control` |

**보간 방법:** 같은 노선·segment 내에서 KP 순으로 정렬 후 인접 anchor 두 점 간 선형 보간.

### 1-2. 고속선 / 일반선 대분류

`rail_routes.line_type` 컬럼으로 DB 레벨 분류.  
`rail_computed_geometry.line_type`은 역정규화 값(JOIN 없이 필터 가능).

| line_type | 해당 노선 (2026-05-27 기준) | 색상 |
|---|---|---|
| `고속선` | 경부고속선(H1), 호남고속선(H2) | `#dc2626` (빨강) |
| `일반선` | 나머지 141개 노선 | `#374151` (진회색) |

고속선 추가 시: `UPDATE rail_routes SET line_type = '고속선' WHERE korail_route_code = 'Hx';`

### 1-3. 역 좌표 모드 (station_points_mode)

노선 geometry API와 차단명령 KP 보간에 사용되는 앵커 필터를 제어.  
`system_settings.map_settings.station_points_mode`로 설정. **기본값: `center_only`**

| 모드 | 앵커 필터 | 경부고속선 기준 앵커 수 |
|---|---|---|
| `center_only` | `station_center + facility_point + facility_start + facility_end` | 35개 |
| `all_points` | `is_render_anchor=1` 전체 | 59개 |

**`center_only` 에서 제외되는 point_type:**
- `station_yard_start`: 역 구내 진입로 앵커 — 본선에서 분기하는 커브 때문에 예상치 못한 굴곡 유발
- `station_yard_end`: 역 구내 출구 앵커 — 동일한 이유로 제외

**`center_only` 에서 반드시 포함해야 하는 point_type:**
- `facility_start/end`: 터널·교량 경계점 — 본선 위에 있으므로 반드시 포함 (누락 시 KP 보간 오류)

**일관성 규칙:** 노선 geometry 렌더링과 차단명령 KP 보간(`_rail_kp_range_coords`, `_interpolate_rail_kp`)은 반드시 동일한 앵커 셋을 사용해야 함. 불일치 시 차단구간 선분이 노선을 벗어남.

### 1-4. rail_computed_geometry 현황 (2026-05-27)

| 항목 | 값 |
|---|---|
| 보유 노선 수 | 77개 (rail_baseline_points ≥ 2 anchor) |
| 전체 좌표 수 | 16,295점 (high LOD 기준) |
| LOD 레벨 | high / mid / low (각각 ~0.5km / ~2km / ~10km 간격) |
| D3 렌더링 레이어 | `routes-computed` |
| 미표시 노선 | 10개 소규모 화물선/지선 (anchor 부족 → baseline 추가 시 자동 복구) |

**미표시 10개 노선:** 부전마산선·북전주선·북평선·대불선·덕산선·군산선·군산항선·화순선·진해선·온산선

재계산 API:
```
POST /api/v1/admin/rail-routes/rebuild-computed
  body: {} (전체) | {"route_ids": [1,2,...]} (선택)
  권한: system_superuser 전용
```

**자동 재계산 (`_rebuild_computed_geometry_route`):**  
`backend/app/api/v1/rail_reference.py`에 `rebuild_route()`와 동일한 로직을 내부 헬퍼로 구현.  
`rail_facilities` create/update/delete 시 해당 노선에 대해 자동 호출 → 스크립트 수동 실행 없이 geometry 즉시 갱신.

```python
# rail_reference.py — 시설물 저장 후 자동 호출 패턴
_sync_facility_baseline_points(db, facility_id)   # baseline anchor 동기화
_rebuild_computed_geometry_route(db, rail_route_id)  # rail_computed_geometry 재계산
db.commit()
```

---

## 2. 배경 지도 — 시도·시군구 경계 (정적 GeoJSON)

### 파일 구성

```
maps/data/
├── korea_map_level1.geojson   # 17개 시도 경계 (315 KB)
└── korea_map_level2.geojson   # 255개 시군구 경계 (1.2 MB, NGII 38MB 원본에서 단순화)
```

> **주의:** 이 파일들은 대한민국 지도 배경이므로 절대 삭제하거나 변경하지 않는다.

### 생성 방식 — Level 1 (시도)

`korea_map_level1.geojson`은 **`korea_map_level2.geojson`(시군구)을 시도 코드별로 `unary_union`하여 생성**.

```python
# sig_cd 앞 2자리로 그룹화 → shapely.ops.unary_union() → simplify(0.0005) → strip_holes()
```

이 방식을 사용하는 이유:
- 시군구 경계를 병합하면 내부 경계선이 완전히 제거되어 올바른 시도 외곽선만 남음
- `provinces-geo.json` 등 외부 소스는 인천-경기도 경계가 소실되거나 self-intersecting 오류 발생
- Level 2 NGII 데이터(sig_cd 코드 정확)가 가장 신뢰할 수 있는 소스

후처리:
- `area < 0.0001` 조각 제거 (한강 하중도, 연안 미소 섬 등)
- `strip_holes()`: 내부 hole 제거 (한강·저수지 등 수계가 hole로 생성되는 문제 해결)

재생성 명령:
```bash
cd backend && source .venv/bin/activate && cd ..
python3 - << 'EOF'
# maps/data/korea_map_level2.geojson → korea_map_level1.geojson
# (unary_union + simplify + strip_holes)
EOF
```
> 재생성이 필요한 경우: database/seeds/routes.py 참고, 또는 이 세션 기록 참조

### API

```
GET /api/v1/map/sigungu?level=1    # 시도 17개만
GET /api/v1/map/sigungu?level=2    # 시도 17개 + 시군구 255개
```

- 서버 `@lru_cache(maxsize=2)`로 캐시 → **파일 변경 시 백엔드 재시작 필수**
- 파일 경로: `Path(__file__).resolve().parent×5 / "maps" / "data"`

### GeoJSON Feature 구조

```json
{
  "properties": {
    "sig_cd":      "28",         // 시도 코드 (Level 1: 2자리, Level 2: 5자리)
    "name":        "인천광역시",
    "full_name":   "인천광역시",
    "admin_level": 1,            // 1=시도, 2=시군구
    "centroid":    [126.38, 37.57]
  }
}
```

### 렌더링 규칙 (D3.js)

| 항목 | Level 1 (시도) | Level 2 (시군구) |
|---|---|---|
| 채움 | 시도별 연한 색 (불투명도 0.15) | 없음 |
| 선 색 | `#6b8299` | `#8fa5b8` |
| 선 굵기 | 1.0 px | 0.5 px |
| 표시 조건 | 항상 | zoom ≥ 1.5 |

시도별 채움색: 4색 배분 원칙 (인접 시도 구분)
- 연장밋빛(서울·세종·경남·강원), 연파랑(부산·충북·전남·제주)
- 연보라(대구·울산·전북), 연에메랄드(인천·충남·경북)
- 연노랑(광주·대전·경기)

### 핵심 교훈 (시행착오)

| 실패한 접근 | 이유 |
|---|---|
| `provinces-geo.json` 단순화 버전 사용 | 인천-경기도 경계 소실 |
| 사용자 정의 RDP 적용 | self-intersecting 폴리곤 생성 (TopologyException) |
| `sigungu_geometry` DB 테이블 유지 | 대용량(22,962행), 정적 GeoJSON이 훨씬 효율적 |
| 외부 province-level GeoJSON 사용 | 내부 구/시/군 경계 미병합으로 망가진 경계 표시 |

**올바른 방법: Level 2(시군구) → `unary_union` → Level 1(시도) 생성**

---

## 3. rail_facilities 지도 표시

### 3-1. 엔드포인트

```
GET /api/v1/map/rail-routes/all/facility-items
  응답: FacilityCollection GeoJSON (is_active=1 시설물 전체)
  인증: 로그인 사용자 전체
```

### 3-2. type / station_type 매핑

| `major_category` | D3 type | `station_type` 결정 |
|---|---|---|
| `구조물` | `'구조물'` | `sub_category` (터널/교량/과선교/건널목/분기) |
| `전기설비` | `'변전소'` | `detail_category.lower()` (ss/sp/ssp/atp/pp 등), 없으면 `sub_category.lower()` |

### 3-3. geometry 결정

| 조건 | geometry |
|---|---|
| `geometry_type='linear'` AND `lat/lon/lat_end/lon_end` 모두 있음 | `LineString [[lon,lat],[lon_end,lat_end]]` |
| 그 외 (`lat/lon` 있음) | `Point [lon, lat]` |
| GPS 없음 | 응답에서 제외 |

### 3-4. D3 렌더링 분기

- **LineString** (터널·교량·과선교): `segLayer` path — `stroke-width 4`, `cursor: pointer`, 클릭 시 팝업 표시 (노선명 + KP 범위)
- **Point** (건널목·분기·변전소): `pointLayer` g — 기존 역·전기설비와 동일한 `pointGroups` 흐름

---

## 파일 구성

```
maps/
├── pipeline/
│   ├── add_route.py                  # 신규 노선 추가 통합
│   ├── download_osm.py               # Overpass API → osm_korea.geojson
│   ├── extract_routes.py             # osm_korea.geojson → 노선별 GeoJSON 분리
│   ├── rebuild_computed_geometry.py  # rail_baseline_points → rail_computed_geometry 보간
│   ├── import_facilities.py          # 시설물 CSV → rail_facilities DB
│   └── seed_org_viewport.py          # org_viewport 초기값 DB 입력
├── data/
│   ├── korea_map_level1.geojson      # 17개 시도 (unary_union 생성) — 삭제 금지
│   ├── korea_map_level2.geojson      # 255개 시군구 (NGII 기반) — 삭제 금지
│   └── stations.csv                  # 역 마스터 (replace_stations.py 입력)
└── raw/
    └── railway_line/
        └── TN_RLROAD_CTLN.*          # 국가기본도 SHP (.gitignore)
```

---

## 관련 문서

| 문서 | 내용 |
|---|---|
| [ROUTE_MANAGEMENT.md](ROUTE_MANAGEMENT.md) | 51개 노선 등록 현황 |
| [../database/CLAUDE.md](../database/CLAUDE.md) | rail_computed_geometry 스키마 상세 |
| [../backend/CLAUDE.md](../backend/CLAUDE.md) | /map/sigungu API, rail-routes geometry API |
