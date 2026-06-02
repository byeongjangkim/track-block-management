# database — DB 스키마 및 시드 데이터

---

## 핵심 원칙: DB가 유일한 데이터 기준 (Single Source of Truth)

모든 데이터는 SQLite DB에 저장하고, API를 통해서만 조회·수정·삭제한다.  
파일(.json/.csv/.tsv)을 데이터 저장소로 사용하지 않는다.

**예외 — 배경 지도:**  
한국 행정경계 GeoJSON은 정적 파일로 관리한다 (`maps/data/korea_map_level1.geojson`, `korea_map_level2.geojson`).  
API는 `@lru_cache`로 서빙하며, 파일 변경 시 백엔드 재시작 필요.

---

## 현재 DB 상태

| 테이블 | 현재 건수 | 판정 |
|---|---:|---|
| `rail_routes` | 156 | 현행 — 노선 원장 (본선 143 + 기지 13) |
| `rail_stations` | 877 | 현행 — 역 원장 |
| `rail_route_station_points` | 1,077 | 현행 — 노선별 역 KP |
| `rail_baseline_points` | 2,409 | 현행 — KP+GPS anchor 원천 |
| `rail_computed_geometry` | 16,295 | 현행 — 노선도 SOT (77노선 × 3 LOD) |
| `rail_facilities` | 0 | 현행 — 신규 입력 대상 |
| `rail_facility_classifications` | 26 | 현행 |
| `rail_route_region_boundaries` | 39 | 현행 |
| `routes` | 53 | legacy — 제거 후보 |
| `facilities` | 565 | legacy — 제거 후보 |
| `route_geometry` | — | **제거됨** (Alembic `a0b1c2d3e4f5`) |
| `organization_route_ranges` | 45 | legacy (`rail_route_region_boundaries`로 대체 예정) |

---

## 테이블 계층 구조

```
rail_routes
  ├─ rail_route_station_points  ─── rail_stations
  ├─ rail_facilities             ─── rail_facility_classifications
  │                              ─── rail_facility_management_offices
  ├─ rail_route_region_boundaries
  ├─ rail_baseline_points
  └─ rail_computed_geometry          ← 최종 노선도 SOT

organizations
  ├─ organization_route_ranges  ─── routes (legacy)
  ├─ org_viewport
  └─ users

block_orders  ─── organizations
              ─── routes (legacy)
              ─── rail_routes
              ─── users
              ─── facilities (전차선 단전 FK)
```

---

## 테이블 스키마

### 1. `rail_routes` — 노선 원장

```sql
CREATE TABLE rail_routes (
    id                  INTEGER PRIMARY KEY,
    korail_route_code   TEXT(20)  UNIQUE NOT NULL,
    name                TEXT(100) NOT NULL,
    line_type           TEXT(20)  NOT NULL DEFAULT '일반선',  -- '고속선' | '일반선' | '기지'
    route_category      TEXT(50),
    start_station_code  TEXT(30),
    start_station_name  TEXT(100),
    start_lat           REAL,
    start_lon           REAL,
    end_station_code    TEXT(30),
    end_station_name    TEXT(100),
    end_lat             REAL,
    end_lon             REAL,
    start_kp            REAL,
    end_kp              REAL,
    length_kp           REAL,
    station_point_count INTEGER NOT NULL DEFAULT 0,
    calculation_basis   TEXT(255),
    is_active           BOOLEAN NOT NULL DEFAULT 1,
    source_file         TEXT(255),
    imported_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

고속선 추가: `UPDATE rail_routes SET line_type = '고속선' WHERE korail_route_code = 'Hx';`

**추가 컬럼 (Alembic `tc01_rail_track_sections`):**
- `default_track_count INTEGER DEFAULT 2` : 1=단선|2=복선|4=복복선|6=삼복선
- `default_has_catenary BOOLEAN DEFAULT 1` : 전차선 유무 (0=비전철화)

> 구간별 예외: `rail_track_sections` 참조. 없으면 이 기본값 적용.

**기지 노선 (line_type = '기지'):**  
차량기지·보수기지를 `rail_routes`에 별도 노선으로 등록. `korail_route_code` 형식: `DEP-{약칭}`.  
KP는 기지 인출선 분기점을 0.0으로 기산. 시드 스크립트: `database/seeds/rail_depots.py`.

| 기지 코드 | 명칭 | route_category |
|---|---|---|
| `DEP-SEOUL` | 서울차량기지 | 차량기지 |
| `DEP-SUSEO` | 수서차량기지 | 차량기지 |
| `DEP-SUWON` | 수원차량기지 | 차량기지 |
| `DEP-UIJEONGBU` | 의정부차량기지 | 차량기지 |
| `DEP-DAEJEON` | 대전차량기지 | 차량기지 |
| `DEP-OSONG` | 오송고속차량기지 | 차량기지 |
| `DEP-DONGDAEGU` | 동대구차량기지 | 차량기지 |
| `DEP-BUSAN` | 부산차량기지 | 차량기지 |
| `DEP-GWANGMYEONG` | 광명고속차량기지 | 차량기지 |
| `DEP-GWANGJU` | 광주차량기지 | 차량기지 |
| `DEP-MAINT-SEOUL` | 서울보수기지 | 보수기지 |
| `DEP-MAINT-DAEJEON` | 대전보수기지 | 보수기지 |
| `DEP-MAINT-BUSAN` | 부산보수기지 | 보수기지 |

---

### 2. `rail_stations` — 역 원장

```sql
CREATE TABLE rail_stations (
    id           INTEGER PRIMARY KEY,
    station_code TEXT(30) UNIQUE NOT NULL,
    name         TEXT(100) NOT NULL,
    lat          REAL,
    lon          REAL,
    station_role TEXT(20),   -- '관리역' | '소속역'
    station_type TEXT(20),   -- '관리역' | '보통역' | '무인역' | '신호장' | '신호소'
    match_note   TEXT(255),
    source_file  TEXT(255),
    imported_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**원칙:**
- 같은 물리 역은 `rail_stations`에 1회 저장한다.
- 노선별 역 KP는 `rail_route_station_points`에 저장한다 (같은 역이라도 노선마다 KP가 다름).
- 좌표와 역중심 KP 모두 있는 행만 `is_baseline_anchor=1`.

---

### 3. `rail_route_station_points` — 노선별 역 KP

```sql
CREATE TABLE rail_route_station_points (
    id                     INTEGER PRIMARY KEY,
    rail_route_id           INTEGER NOT NULL REFERENCES rail_routes(id),
    station_id              INTEGER NOT NULL REFERENCES rail_stations(id),
    route_sequence_no       INTEGER,
    center_kp               REAL,
    yard_start_kp           REAL,
    yard_end_kp             REAL,
    main_track_speed        REAL,
    side_track_speed        REAL,
    functional_location_no  TEXT(80),
    plant_code              TEXT(30),
    regional_org            TEXT(100),
    distance_from_prev      REAL,
    direction_distance      REAL,
    is_baseline_anchor      BOOLEAN NOT NULL DEFAULT 1,
    match_note              TEXT(255),
    source_row              INTEGER,
    source_file             TEXT(255),
    imported_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rail_route_id, station_id)
);
```

---

### 4. `rail_station_management_groups` / `rail_station_management_members` — 관리역·소속역 관계

```sql
CREATE TABLE rail_station_management_groups (
    id                   INTEGER PRIMARY KEY,
    organization_id      INTEGER REFERENCES organizations(id),
    region_name          TEXT(100) NOT NULL,
    manager_station_id   INTEGER NOT NULL REFERENCES rail_stations(id),
    manager_station_name TEXT(100) NOT NULL,
    source_file          TEXT(255),
    source_row           INTEGER,
    imported_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (region_name, manager_station_name)
);

CREATE TABLE rail_station_management_members (
    id                  INTEGER PRIMARY KEY,
    management_group_id INTEGER NOT NULL REFERENCES rail_station_management_groups(id),
    station_id          INTEGER NOT NULL REFERENCES rail_stations(id),
    station_name        TEXT(100) NOT NULL,
    station_role        TEXT(20) NOT NULL,  -- '관리역' | '소속역'
    station_type        TEXT(20) NOT NULL,  -- '관리역' | '보통역' | '무인역' | '신호장' | '신호소'
    match_status        TEXT(30) NOT NULL,
    source_order        INTEGER NOT NULL,
    source_file         TEXT(255),
    source_row          INTEGER,
    imported_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (management_group_id, station_id)
);
```

---

### 5. `rail_baseline_points` — KP 보간 anchor 원천

```sql
CREATE TABLE rail_baseline_points (
    id                      INTEGER PRIMARY KEY,
    rail_route_id            INTEGER NOT NULL REFERENCES rail_routes(id),
    segment_no               INTEGER NOT NULL DEFAULT 0,
    seq                      INTEGER NOT NULL,
    kp                       REAL NOT NULL,
    lat                      REAL NOT NULL,
    lon                      REAL NOT NULL,
    point_type               TEXT(40) NOT NULL,
    source_type              TEXT(40) NOT NULL,
    source_id                INTEGER,
    station_id               INTEGER REFERENCES rail_stations(id),
    rail_facility_id         INTEGER REFERENCES rail_facilities(id),
    is_interpolation_anchor  BOOLEAN NOT NULL DEFAULT 1,
    is_render_anchor         BOOLEAN NOT NULL DEFAULT 1,
    note                     TEXT,
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

| `point_type` | 원천 | 현재 건수 | center_only 포함 |
|---|---|---:|---|
| `station_center` | `rail_route_station_points.center_kp` | 833 | ✅ |
| `station_yard_start` | `rail_route_station_points.yard_start_kp` | 788 | ❌ |
| `station_yard_end` | `rail_route_station_points.yard_end_kp` | 788 | ❌ |
| `facility_point` | `rail_facilities.kp_start` (점 시설물) | 19+ | ✅ |
| `facility_start` | `rail_facilities.kp_start` (구간 시설물 시작) | 12+ | ✅ |
| `facility_end` | `rail_facilities.kp_end` (구간 시설물 종점) | 12+ | ✅ |
| `manual_control` | 수동 입력 | — | ✅ |

> `station_yard_start/end`는 역 진입로 좌표로 곡선 굴곡을 유발할 수 있어 `center_only` 모드에서 제외됨.  
> `facility_start/end`(터널·교량 경계)는 본선 위에 있으므로 `center_only` 모드에서도 포함.

재생성: `python3 scripts/rebuild_rail_baseline_points.py --db backend/db.sqlite3`

---

### 6. `rail_computed_geometry` — 노선도 좌표 계열 (최종 SOT)

`rail_baseline_points` anchor를 KP 순으로 선형 보간하여 생성한 노선 좌표 계열.

```sql
CREATE TABLE rail_computed_geometry (
    id             INTEGER PRIMARY KEY,
    rail_route_id  INTEGER NOT NULL REFERENCES rail_routes(id),
    line_type      TEXT(20) NOT NULL DEFAULT '일반선',  -- 역정규화: '고속선' | '일반선'
    kp             REAL NOT NULL,
    lat            REAL NOT NULL,
    lon            REAL NOT NULL,
    source         TEXT(20) NOT NULL DEFAULT 'interpolated',
                   -- 'station' | 'facility' | 'interpolated' | 'manual'
    lod            TEXT(10) NOT NULL DEFAULT 'high',
                   -- 'high' (~500 m) | 'mid' (~2 km) | 'low' (~10 km)
    seq            INTEGER NOT NULL,
    computed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rail_route_id, lod, seq)
);
CREATE INDEX idx_rcg_route_lod     ON rail_computed_geometry (rail_route_id, lod);
CREATE INDEX idx_rcg_line_type_lod ON rail_computed_geometry (line_type, lod);
```

재계산 API (system_superuser 전용):
```
POST /api/v1/admin/rail-routes/rebuild-computed
body: {} (전체) | {"route_ids": [1, 2, ...]} (선택)
```

---

### 7. `rail_facility_classifications` — 시설물 분류 코드

```sql
CREATE TABLE rail_facility_classifications (
    id                INTEGER PRIMARY KEY,
    code              TEXT(50) UNIQUE NOT NULL,
    major_category    TEXT(30) NOT NULL,   -- '구조물' | '전기설비'
    sub_category      TEXT(50) NOT NULL,
    detail_category   TEXT(30),
    tertiary_category TEXT(30),
    geometry_type     TEXT(20) NOT NULL,   -- 'point' | 'linear'
    sort_order        INTEGER  NOT NULL,
    is_active         BOOLEAN  NOT NULL DEFAULT 1,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (major_category, sub_category, detail_category, tertiary_category)
);
```

**분류 체계 (총 24개):**

| code | 대분류 | 1차 | 2차 | 3차 | geometry |
|---|---|---|---|---|---|
| `STRUCTURE_BRIDGE` | 구조물 | 교량 | — | — | linear |
| `STRUCTURE_TUNNEL` | 구조물 | 터널 | — | — | linear |
| `STRUCTURE_TUNNEL_SGANG` | 구조물 | 터널 | 사갱 | — | point |
| `STRUCTURE_TUNNEL_VERTICAL` | 구조물 | 터널 | 수직구 | — | point |
| `STRUCTURE_TUNNEL_SUMP` | 구조물 | 터널 | 집수정 | — | point |
| `STRUCTURE_OVERPASS` | 구조물 | 과선교 | — | — | point |
| `STRUCTURE_CROSSING_STAFFED_1` | 구조물 | 건널목 | 유인 | 1종 | point |
| `STRUCTURE_CROSSING_STAFFED_2` | 구조물 | 건널목 | 유인 | 2종 | point |
| `STRUCTURE_CROSSING_STAFFED_3` | 구조물 | 건널목 | 유인 | 3종 | point |
| `STRUCTURE_CROSSING_UNSTAFFED_1` | 구조물 | 건널목 | 무인 | 1종 | point |
| `STRUCTURE_CROSSING_UNSTAFFED_2` | 구조물 | 건널목 | 무인 | 2종 | point |
| `STRUCTURE_CROSSING_UNSTAFFED_3` | 구조물 | 건널목 | 무인 | 3종 | point |
| `STRUCTURE_GATE_UP` | 구조물 | 선로출입문 | 상선 | — | point |
| `STRUCTURE_GATE_DOWN` | 구조물 | 선로출입문 | 하선 | — | point |
| `STRUCTURE_OTHER` | 구조물 | 기타 | — | — | point |
| `ELEC_SUBSTATION_SS` | 전기설비 | 변전설비 | SS | — | point |
| `ELEC_SUBSTATION_SP` | 전기설비 | 변전설비 | SP | — | point |
| `ELEC_SUBSTATION_SSP` | 전기설비 | 변전설비 | SSP | — | point |
| `ELEC_SUBSTATION_PP` | 전기설비 | 변전설비 | PP | — | point |
| `ELEC_SUBSTATION_ATP` | 전기설비 | 변전설비 | ATP | — | point |
| `ELEC_POWER_DIST` | 전기설비 | 전력설비 | 배전소 | — | point |
| `ELEC_SIGNAL_GENERAL` | 전기설비 | 신호설비 | 신호기계실 | — | point |
| `ELEC_SIGNAL_IEC` | 전기설비 | 신호설비 | 신호기계실 | IEC | point |
| `ELEC_SIGNAL_INEC` | 전기설비 | 신호설비 | 신호기계실 | InEC | point |
| `ELEC_COMM_ROOM` | 전기설비 | 통신설비 | 통신기계실 | — | point |
| `ELEC_COMM_RS` | 전기설비 | 통신설비 | 무선기지국 | RS | point |

---

### 8. `rail_facilities` — 철도시설물

```sql
CREATE TABLE rail_facilities (
    id                     INTEGER PRIMARY KEY,
    rail_route_id           INTEGER NOT NULL REFERENCES rail_routes(id),
    facility_code           TEXT(50),
    name                    TEXT(100) NOT NULL,
    classification_id       INTEGER NOT NULL REFERENCES rail_facility_classifications(id),
    kp_start                REAL,
    kp_end                  REAL,
    lat                     REAL,
    lon                     REAL,
    lat_end                 REAL,
    lon_end                 REAL,
    direction               TEXT(10),
    section_from            TEXT,       -- 구간 시점 (건널목 등)
    section_to              TEXT,       -- 구간 종점
    address                 TEXT,       -- 소재지 주소
    road_width_m            REAL,       -- 도로폭 (건널목)
    is_paved                BOOLEAN,    -- 포장 여부 (건널목)
    bus_accessible          BOOLEAN,    -- 버스 통행 가능 여부 (건널목)
    entrance_passage_type   TEXT,       -- 출입구 통로 유형 (선로출입문)
    entrance_lock_type      TEXT,       -- 잠금 방식 (선로출입문)
    nearest_station_id      INTEGER REFERENCES rail_stations(id),
    management_office_id    INTEGER REFERENCES rail_facility_management_offices(id),
    use_as_baseline_anchor  BOOLEAN NOT NULL DEFAULT 0,
    is_active               BOOLEAN NOT NULL DEFAULT 1,
    source_file             TEXT(255),
    source_row              INTEGER,
    note                    TEXT,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`rail_baseline_points.rail_facility_id`가 시설물 anchor FK다.

---

### 9. `rail_facility_management_offices` — 시설물 관리 사업소

```sql
CREATE TABLE rail_facility_management_offices (
    id              INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    region_name     TEXT(100) NOT NULL,
    office_name     TEXT(100) NOT NULL,
    office_type     TEXT(30) NOT NULL DEFAULT '사업소',
    field           TEXT(20) NOT NULL DEFAULT 'all',
    source_file     TEXT(255),
    source_row      INTEGER,
    note            TEXT,
    imported_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, office_name, field)
);
```

---

### 8-1. `rail_facilities` CSV 업로드 형식

API: `GET /api/v1/rail-reference/routes/{id}/facilities/template` (양식 다운로드)  
API: `POST /api/v1/rail-reference/routes/{id}/facilities/bulk` (CSV 업로드, **기존 데이터에 추가**)

#### CSV 컬럼

| 컬럼명 | 필수 | 설명 | 예시 |
|---|---|---|---|
| `classification_code` | **필수** | `rail_facility_classifications.code` 값 | `STRUCTURE_TUNNEL_SUMP` |
| `name` | **필수** | 시설물 공식 명칭 | `○○집수정` |
| `facility_code` | 선택 | 내부 관리 코드 | `KR-TS-0042` |
| `kp_start` | **필수** | 시작 거리정, 소수점 3자리 | `125.300` |
| `kp_end` | **linear만 필수** | 종료 거리정 (교량·터널) | `127.850` |
| `lat` | 선택 | 시작점 위도 WGS84 | `37.553456` |
| `lon` | 선택 | 시작점 경도 WGS84 | `127.013456` |
| `lat_end` | 선택 | 종료점 위도 (linear용) | `37.560123` |
| `lon_end` | 선택 | 종료점 경도 (linear용) | `127.020123` |
| `direction` | 선택 | `UP` / `DOWN` / `BOTH` | `UP` |
| `section_from` | 선택 | 구간 시점역명 | `오송역` |
| `section_to` | 선택 | 구간 종점역명 | `천안아산역` |
| `address` | 선택 | 소재지 주소 | `충청북도 청주시 ○○구` |
| `road_width_m` | 선택 | 도로폭(m) — 건널목 전용 | `6.0` |
| `is_paved` | 선택 | 포장여부 — 건널목 전용. `1`=예, `0`=아니오 | `1` |
| `bus_accessible` | 선택 | 버스진입가능 — 건널목 전용. `1`/`0` | `0` |
| `entrance_passage_type` | 선택 | 출입구 통로형태 — 선로출입문 전용 | `직선통로` |
| `entrance_lock_type` | 선택 | 잠금방식 — 선로출입문 전용 | `번호키` |
| `use_as_baseline_anchor` | 선택 | 노선도 보간 기준점 등록. `1`/`0` (기본 `0`) | `1` |
| `is_active` | 선택 | 사용여부. `1`/`0` (기본 `1`) | `1` |
| `note` | 선택 | 비고 | `○○공사 시공` |

#### 입력 규칙

- `classification_code`: 코드표(`rail_facility_classifications.code`)에서 정확히 입력. 백엔드가 자동으로 `classification_id` FK로 변환.
- `lat`/`lon`: 반드시 둘 다 입력하거나 둘 다 생략. 하나만 입력하면 오류.
- `lat_end`/`lon_end`: 동일 규칙. `geometry_type=linear`인 시설물(교량·터널)에만 사용.
- `#`으로 시작하는 행은 주석으로 처리되어 무시됨.
- CSV 업로드는 **추가 방식** (기존 데이터 삭제 없음).

#### `geometry_type`별 필수 컬럼 요약

| geometry_type | 해당 분류 | kp_end | lat_end/lon_end |
|---|---|---|---|
| `linear` | 교량, 터널 | **필수** | 선택 (있으면 노선도 종점 anchor) |
| `point` | 나머지 모두 | 생략 | 생략 |

---

### 10. `rail_route_region_boundaries` — 지역본부 KP 경계

```sql
CREATE TABLE rail_route_region_boundaries (
    id              INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    rail_route_id   INTEGER NOT NULL REFERENCES rail_routes(id),
    region_name     TEXT(100) NOT NULL,
    boundary_type   TEXT(30) NOT NULL DEFAULT '지역본부',
    start_kp        REAL NOT NULL,
    end_kp          REAL NOT NULL,
    source_type     TEXT(50),
    source_id       INTEGER,
    note            TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, rail_route_id, boundary_type, start_kp, end_kp)
);
```

현황: 39건, 지역본부 12개, 포함 노선 22개.

---

### 11. `routes` — 노선 (legacy)

`organization_route_ranges`, `block_orders.route_id`, `facilities.route_id`에서 참조 중. 향후 제거 후보.

```sql
CREATE TABLE routes (
    id             INTEGER PRIMARY KEY,
    code           TEXT(30) UNIQUE NOT NULL,   -- e.g. 'gyeongbu'
    name           TEXT(50) NOT NULL,           -- e.g. '경부선'
    start_km       REAL     NOT NULL DEFAULT 0.0,
    end_km         REAL     NOT NULL,
    up_direction   TEXT(50),
    down_direction TEXT(50),
    start_station  TEXT(50),   -- km=0.0 기준역명
    end_station    TEXT(50)
);
```

> km 기준: 각 노선의 `start_station`이 km=0.0. `facilities.km`, `block_orders.start_km/end_km`이 이 기준을 따른다.  
> 노선 목록 → `database/seeds/routes.py`

---

### 12. `facilities` — 시설물 (legacy)

`block_orders.start_facility_id/end_facility_id`(전차선 단전 FK)에서 참조 중.  
차단현황도 시설물 레이어의 실질 데이터 소스. `GET /api/v1/map/facilities` 에서 GeoJSON으로 서빙.

```sql
CREATE TABLE facilities (
    id              INTEGER PRIMARY KEY,
    route_id        INTEGER NOT NULL REFERENCES routes(id),
    type            TEXT(20) NOT NULL,   -- '역' | '변전소' | '구조물' | '소속경계'
    station_type    TEXT(10),            -- 소분류 (아래 표 참조)
    name            TEXT(100) NOT NULL,
    km              REAL NOT NULL,
    km_end          REAL,               -- 선형 구조물(터널·교량·과선교) 종점 거리정
    lat             REAL,
    lon             REAL,
    direction       TEXT(4),             -- 'UP' | 'DOWN' | 'BOTH' | NULL
    has_station_map BOOLEAN NOT NULL DEFAULT 0,
    note            TEXT
);
```

#### type / station_type 조합

| type | station_type | 비고 |
|---|---|---|
| 역 | 관리역 / 보통역 / 무인역 / 신호장 / 신호소 | Point |
| 변전소 | ss / sp / ssp / atp / pp | Point — 변전소 종류 |
| 변전소 | 전기실 | Point — 전기실(AC/DC) |
| 변전소 | 통신실 | Point — 통신기계실 |
| 변전소 | 신호기계실 | Point — 신호기계실(IEC/INEC) |
| 구조물 | 터널 / 교량 / 과선교 | LineString — km_end 필요 |
| 구조물 | 건널목 / 분기 | Point |
| 소속경계 | 지역본부 / 사업소 | Point |

#### CSV 업로드 형식 (admin.py)

헤더: `종류,소분류,이름,시작km,종료km,시작위도,시작경도,방향,역배선도,비고`

- `소분류` 열이 2026-05 릴리스에 추가됨. 이전 형식(`종류,이름,...`)도 역방향 호환 허용 (소분류 없으면 NULL 저장).
- `GET /api/v1/admin/routes/{code}/csv-template` — 기존 데이터 포함 최신 양식 다운로드.
- `POST /api/v1/admin/routes/{code}/upload-csv` — 업로드 시 해당 노선 전체 **교체** (replace=True).

---

### 13. `organizations` — 조직

```sql
CREATE TABLE organizations (
    id        INTEGER PRIMARY KEY,
    code      TEXT(30) UNIQUE NOT NULL,
    name      TEXT(100) NOT NULL,
    org_type  TEXT(20) NOT NULL,   -- 'regional' (지역본부 12개) | 'special' (사업단 2개)
    is_active BOOLEAN  NOT NULL DEFAULT 1
);
```

---

### 14. `organization_route_ranges` — 조직별 관할 구간 (legacy)

```sql
CREATE TABLE organization_route_ranges (
    id              INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    route_id        INTEGER NOT NULL REFERENCES routes(id),
    field           TEXT(20) NOT NULL DEFAULT 'all',
    start_km        REAL     NOT NULL,
    end_km          REAL     NOT NULL,
    UNIQUE (organization_id, route_id, field)
);
```

| field | 설명 |
|---|---|
| `'all'` | 본부 행정 관할 (모든 분야) |
| `'시설'` | 시설 분야 |
| `'전기'` | 전기 분야 |
| `'건축'` | 건축 분야 |

---

### 15. `org_viewport` — 조직별 초기 지도 뷰

```sql
CREATE TABLE org_viewport (
    id              INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id),
    center_lat      REAL    NOT NULL,
    center_lon      REAL    NOT NULL,
    zoom_level      REAL    NOT NULL DEFAULT 5.0   -- 1=전국, 6=본부 권역
);
```

---

### 16. `users` — 사용자

```sql
CREATE TABLE users (
    id               INTEGER PRIMARY KEY,
    username         TEXT(50)  UNIQUE NOT NULL,
    hashed_password  TEXT(255) NOT NULL,
    full_name        TEXT(100) NOT NULL,
    is_active        BOOLEAN   NOT NULL DEFAULT 1,
    role             TEXT(30)  NOT NULL DEFAULT 'user',
    field            TEXT(20),
    organization_id  INTEGER REFERENCES organizations(id)
);
```

| role | 설명 |
|---|---|
| `'system_superuser'` | 전체 CRUD, organization_id=NULL |
| `'org_admin'` | 관할 구간 내 등록, organization_id 필수 |
| `'user'` | 전국 조회 전용, organization_id 필수 |

---

### 17. `block_orders` — 차단명령

> 파싱 항목 상세 → [block_order_pdf_parsing.md](block_order_pdf_parsing.md)

```sql
CREATE TABLE block_orders (
    id               INTEGER PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES organizations(id),
    route_id         INTEGER REFERENCES routes(id),       -- legacy 호환
    rail_route_id    INTEGER REFERENCES rail_routes(id),  -- 최종 노선 기준
    created_by       INTEGER NOT NULL REFERENCES users(id),

    -- 노선·위치
    -- direction 컬럼은 Alembic tc05에서 삭제됨 → tracks TEXT(JSON)으로 대체
    tracks           TEXT     NOT NULL DEFAULT '["상선"]',
                                                 -- JSON 배열: ["상선"] | ["하선"] | ["상1","하1"] 등
                                                 -- 복선(2): 상선/하선, 2복선(4): 상1~하2, 3복선(6): 상1~하3
    start_km         REAL,                        -- legacy. KP와 같은 의미
    end_km           REAL,
    start_kp         REAL,                        -- 최종 D3/KP 보간 기준
    end_kp           REAL,
    section_note     TEXT(200),                  -- 단전구간명 (예: '청도SP~밀양SS')
    start_facility_id INTEGER REFERENCES facilities(id),  -- 전차선 단전 시점 변전소
    end_facility_id   INTEGER REFERENCES facilities(id),  -- 전차선 단전 종점 변전소
    track_name       TEXT,                        -- 기지 내 선로/구역명 (예: '유치선1', '검수선A')

    -- 일시
    work_date        DATE     NOT NULL,
    start_time       TIME     NOT NULL,
    end_time         TIME     NOT NULL,

    -- 분류
    field            TEXT(30) NOT NULL,           -- '시설' | '전기' | '건축'
    block_type       TEXT(30) NOT NULL,
    -- 작업형태 (Alembic tc02): '인력'|'장비'|'기계' (NULL=미지정)
    work_type        TEXT(10),
    has_equipment    BOOLEAN  DEFAULT 0,          -- (레거시) 장비작업 여부
    has_labor        BOOLEAN  DEFAULT 1,          -- (레거시) 인력작업 여부
    -- 시행주체 (Alembic tc02): '철도공사'|'철도공단'|'외부'
    implementer      TEXT(20) NOT NULL DEFAULT '철도공사',
    is_external      BOOLEAN  DEFAULT 0,          -- (레거시) implementer='외부'이면 true

    -- 문서
    doc_no           TEXT(30),
    document_path    TEXT(255),                  -- PDF 상대경로 (uploads/ 기준)

    -- 담당자
    dept_head                     TEXT(50),
    dept_head_phone               TEXT(20),
    work_supervisor               TEXT(50) NOT NULL,
    work_supervisor_phone         TEXT(20),
    safety_manager                TEXT(50) NOT NULL,
    safety_manager_phone          TEXT(20),
    electric_safety_manager       TEXT(50),
    electric_safety_manager_phone TEXT(20),
    contractor                    TEXT(100),
    train_watcher                 TEXT(50),
    train_watcher_phone           TEXT(20),

    -- 작업 내용
    reason           TEXT,
    safety_items     TEXT,
    note             TEXT
);
```

| 컬럼 | 설명 |
|---|---|
| `tracks` | 차단 선로 목록 (JSON 배열). 복선: `["상선"]`/`["하선"]`, 2복선: `["상1"]` 등 |
| `rail_route_id` + `start_kp/end_kp` | 최종 노선도 오버레이 기준 |
| `route_id` + `start_km/end_km` | legacy 호환. km = KP (같은 값) |
| `start_facility_id/end_facility_id` | 전차선 단전 시 변전소 좌표 조회용 |
| `section_note` | 전차선 단전 구간명. km 없을 때 사용 |
| `track_name` | 기지 내 선로·구역명 (예: 유치선1, 검수선A). 본선 작업 시 NULL |

**기지 작업 등록 규칙:**
- `rail_route_id`: `line_type='기지'`인 기지 노선 ID
- `route_id`: NULL (기지는 legacy routes에 없음)
- `start_kp/end_kp`: 기지 내부 KP (NULL도 허용 — 기지 전체 작업 시)
- `direction`: 기지 전체 작업이면 `BOTH`, 특정 방향이면 `UP` / `DOWN`
- `track_name`: 선로 지정 작업이면 입력, 전체 작업이면 NULL
- 권한 검증: `line_type='기지'` 노선이면 KP 관할구간 검증 생략 (org_admin 이상 허용)

---

### 추가 테이블: `rail_track_sections` — 노선 구간별 선로수·전차선 예외

> Alembic `tc01_rail_track_sections`

```sql
CREATE TABLE rail_track_sections (
    id              INTEGER PRIMARY KEY,
    rail_route_id   INTEGER NOT NULL REFERENCES rail_routes(id) ON DELETE CASCADE,
    start_kp        REAL    NOT NULL,
    end_kp          REAL    NOT NULL,
    track_count     INTEGER NOT NULL DEFAULT 2,   -- 1|2|4|6
    has_catenary    BOOLEAN NOT NULL DEFAULT 1,
    note            TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_rail_track_sections_route ON rail_track_sections (rail_route_id);
```

- `rail_routes.default_track_count/has_catenary` 가 노선 전체 기본값
- 이 테이블에 KP 구간이 등록되면 해당 구간은 기본값을 덮어씀
- 조회 우선순위: `rail_track_sections` → (없으면) `rail_routes` 기본값
- CRUD: `GET/POST /api/v1/rail-reference/routes/{id}/track-sections`
- 기본값 수정: `PATCH /api/v1/rail-reference/routes/{id}/defaults`

### 추가 컬럼: `rail_facilities.bore_type` — 터널·교량 선로 적용 방식

> Alembic `tc03_bore_type`

```sql
ALTER TABLE rail_facilities ADD COLUMN bore_type TEXT(20) NOT NULL DEFAULT '복선';
-- 값: '복선' | '단선_상선' | '단선_하선'
```

| 값 | 의미 | 지도 표시 |
|---|---|---|
| `복선` | 상·하선이 하나의 구조물 안에 있음 (기본) | 양쪽 선로를 감싸는 하나의 심볼 |
| `단선_상선` | 상선 전용 단선 터널/교량 | 상선 위치에만 |
| `단선_하선` | 하선 전용 단선 터널/교량 | 하선 위치에만 |

### 추가 테이블: `system_settings` — 시스템 설정

> Alembic `tc04_system_settings` + `map_settings` (직접 시드)

```sql
CREATE TABLE system_settings (
    id            INTEGER PRIMARY KEY,
    category      TEXT(50)  NOT NULL,
    key           TEXT(50)  NOT NULL,
    value         TEXT(255) NOT NULL,
    default_value TEXT(255) NOT NULL,
    label         TEXT(100),
    description   TEXT(255),
    sort_order    INTEGER   NOT NULL DEFAULT 0,
    updated_by    INTEGER REFERENCES users(id),
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (category, key)
);
```

**카테고리별 항목:**
| category | 항목 수 | 주요 키 | 값 형식 |
|---|---|---|---|
| `route_colors` | 4 | highway, electrified, non_electrified, catenary_cut | `#RRGGBB` |
| `block_colors` | 2 | track_block, danger_zone | `#RRGGBB` |
| `danger_colors` | 4 | level_a, level_b, level_c, none | `#RRGGBB` |
| `facility_colors` | 12 | station_master, station_general, tunnel_bridge 등 | `#RRGGBB` |
| `map_settings` | 1 | station_points_mode | `center_only` \| `all_points` |

**`map_settings.station_points_mode`**:
- `center_only` (기본): 역 중심+시설물 앵커만 사용. 역 진입로 굴곡 없음.
- `all_points`: 기존 `rail_computed_geometry` 전체 사용.
- 노선 geometry API + 차단명령 KP 보간 양쪽에 동일하게 적용됨.

**API**: `GET/PATCH /api/v1/settings`, `POST /api/v1/settings/{cat}/{key}/reset`

**적용 방식**: 새로고침 후 반영 (settingsStore → D3 렌더링 + geometry 재요청)

---

## 권한 검증 로직

| 역할 | 조건 |
|---|---|
| `system_superuser` | 무조건 허용 |
| `user` | 거부 (조회 전용) |
| `org_admin` + `field='all'` | 자기 조직 관할 km 범위 내 모든 분야 |
| `org_admin` + `field='시설'` 등 | 자기 조직 관할 km 범위 내 해당 분야만 |
| `org_admin` + **기지 노선** | KP 관할구간 검증 생략 — 소속 조직 여부만 확인 |

크로스-org (여러 조직 관할에 걸친 구간): `system_superuser`만 등록 가능.  
기지 작업 (`line_type='기지'`): legacy route가 없으므로 KP 검증 없이 org_admin이면 허용.

---

## 시스템 설정 초기화

시스템 설정은 `tc04_system_settings` 마이그레이션 실행 시 자동 시드된다.  
수동 재초기화가 필요한 경우:
```
POST /api/v1/settings/reset-all  (system_superuser 인증 필요)
```

---

## 시드 데이터 실행 순서 (최초 1회)

```bash
cd backend && source .venv/bin/activate && cd ..

python database/seeds/organizations.py    # 1. 14개 조직
python database/seeds/routes.py           # 2. 51개 노선 (legacy)
python database/seeds/org_route_ranges.py # 3. 조직별 관할 구간
python database/seeds/admin_user.py       # 4. 초기 관리자 계정
python database/seeds/rail_depots.py      # 5. 기지 노선 13개 (rail_routes, line_type='기지')
```

---

## Alembic 마이그레이션

```bash
cd backend && source .venv/bin/activate

alembic upgrade head                             # 최초 생성 / 최신 반영
alembic revision --autogenerate -m "설명"        # 모델 변경 후 파일 생성
alembic upgrade head                             # 적용
```

---

## 주의사항

- `db.sqlite3`는 `.gitignore` 처리
- `tracks` (block_orders): JSON 배열 텍스트. `direction` 컬럼은 tc05에서 삭제됨
- `km` 컬럼은 Float, 소수점 1자리, km 단위
- 비밀번호는 bcrypt 해시값만 저장
- `organization_id=NULL`은 `system_superuser`만 허용
- `rail_computed_geometry`는 `POST /api/v1/admin/rail-routes/rebuild-computed` API로만 재계산

---

## 관련 문서

| 문서 | 내용 |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | 프로젝트 전체 개요, 권한 체계 |
| [MAPS.md](MAPS.md) | rail_computed_geometry 아키텍처, KP 보간 |
| [block_order_pdf_parsing.md](block_order_pdf_parsing.md) | 차단명령 PDF 파싱 명세 |
