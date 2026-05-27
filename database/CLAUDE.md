# database — DB 스키마 및 시드 데이터

---

## 핵심 원칙: SQLite DB가 유일한 데이터 기준 (Single Source of Truth)

모든 데이터는 SQLite DB에 저장하고, API를 통해서만 조회·수정·삭제한다.
파일(.json/.csv/.tsv)을 데이터 저장소로 사용하지 않는다.

**예외 — 배경 지도 (시도·시군구 경계):**
한국 행정경계 GeoJSON은 정적 파일로 관리한다 (`maps/data/korea_map_level1.geojson`, `korea_map_level2.geojson`).
DB 저장(22,962행 `sigungu_geometry` 테이블)보다 정적 파일이 훨씬 효율적이므로 예외를 둔다.
API는 `@lru_cache`로 서빙하며, 파일 변경 시 백엔드 재시작 필요. → [maps/CLAUDE.md](../maps/CLAUDE.md)

---

## 현재 DB 정리 상태

현재 최종 SOT 축은 `rail_routes` 계열이다. 아래 legacy 테이블은 기존 화면/API 호환 때문에 아직 DB에 남아 있으나, 최종 노선도·역·시설물·차단현황의 기준으로 사용하지 않는 방향이다.

| 구분 | 테이블/컬럼 | 현재 건수 | 판정 |
|---|---|---:|---|
| 최종 노선 원장 | `rail_routes` | 143 | 유지 |
| 최종 역 원장 | `rail_stations` | 877 | 유지 |
| 최종 노선별 역 KP | `rail_route_station_points` | 1,077 | 유지 |
| 최종 D3/KP 기준선 | `rail_baseline_points` | 2,409 | 유지 |
| 최종 시설물 원장 | `rail_facilities` | 0 | 유지, 신규 입력 대상 |
| 최종 시설물 분류 | `rail_facility_classifications` | 24 | 유지 (Alembic `y4z5a6b7c8d9`에서 재편) |
| 최종 지역본부 KP 경계 | `rail_route_region_boundaries` | 39 | 유지 |
| 기존 노선 원장 | `routes` | 53 | legacy, 제거 후보 |
| 기존 시설물/역 | `facilities` | 565 | legacy, 제거 후보 |
| 기존 GIS 노선 geometry | `route_geometry` | 90,286 | legacy 지도 경로, 제거 후보 |
| 기존 조직 관할 구간 | `organization_route_ranges` | 45 | legacy, `rail_route_region_boundaries`로 대체 |
| 차단명령 legacy 컬럼 | `block_orders.route_id/start_km/end_km` | 13 | 기존 화면 호환용, 제거 후보 |

시·군·구 지도 DB 잔재인 `sigungu_geometry` 테이블은 현재 DB에 없다. 배경 지도는 정적 GeoJSON으로 관리한다.

---

## 최종 테이블 계층 구조

```
rail_routes
  ├─ rail_route_station_points
  │    └─ rail_stations
  ├─ rail_facilities
  │    ├─ rail_facility_classifications
  │    └─ rail_facility_management_offices
  ├─ rail_route_region_boundaries
  ├─ rail_baseline_points
  └─ block_orders
```

---

## 테이블 상세 스키마

### 1. `route_geometry` — GIS 기반 (Layer 0)

```sql
CREATE TABLE route_geometry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    route_code TEXT    NOT NULL,
    source     TEXT    NOT NULL DEFAULT 'shp',
    lod        TEXT    NOT NULL,
    segment    INTEGER NOT NULL DEFAULT 0,
    seq        INTEGER NOT NULL,
    lat        REAL    NOT NULL,
    lon        REAL    NOT NULL,
    km         REAL,
    UNIQUE (route_code, source, lod, segment, seq)
);
CREATE INDEX idx_rg_route_lod    ON route_geometry (route_code, lod);
CREATE INDEX idx_rg_route_source ON route_geometry (route_code, source);
```

| 컬럼 | 설명 |
|---|---|
| route_code | 노선 코드 (routes.code 참조) |
| source | `'shp'` 국가기본도 참조용 / `'user'` 관리자 업로드 공식 데이터 |
| lod | `'high'` 원본 / `'mid'` 중간 / `'low'` 간략 (mid·low는 자동 생성) |
| segment | 선분 번호 (0=본선, 1,2,...=지선·연결 불가 구간) |
| seq | segment 내 좌표 순번 (0부터) |
| lat / lon | WGS84 위도/경도 |
| km | KORAIL 공식 거리정 (source='user'만 입력, 'shp'는 NULL) |

**입력 경로 (이 두 경로 외 직접 조작 금지):**
- `source='shp'` → `maps/pipeline/import_shp_to_geometry.py` 또는 웹 UI SHP import
- `source='user'` → 웹 UI 노선도 업로드 (`geometry_service.py`)

---

### 1-1. `rail_routes` / `rail_stations` / `rail_route_station_points` — 노선·역 KP 원천 데이터

> Alembic `o4p5q6r7s8t9` 이후 추가, `q6r7s8t9u0v1`에서 GPS NULL 허용 및 역 분류 추가.  
> `t9u0v1w2x3y4`에서 `최종_노선현황목록_KP기반.xlsx` 기준의 노선 시작·종료·길이 정보를 추가했다.

**핵심 원칙**
- `rail_routes`는 철도 노선의 기본 정보와 시작·종료 KP를 제공하는 노선 원장이다.
- 같은 물리 역은 `rail_stations`에 1회 저장한다.
- 노선별 역 중심·구내 시작·구내 종료 KP는 `rail_route_station_points`에 저장한다. 같은 역이라도 노선이 다르면 KP가 다르기 때문이다.
- 좌표가 없어도 `역중심 KP`가 있거나 소속별 역 현황에 등장하면 `rail_stations`에 등록한다.
- 좌표와 `역중심 KP`가 모두 있는 행만 `is_baseline_anchor=1`로 저장한다.
- 좌표는 있으나 `역중심 KP`가 없는 행, 또는 `역중심 KP`는 있으나 좌표가 없는 행은 검토용으로 저장하되 `is_baseline_anchor=0`으로 둔다.
- `yard_start_kp` / `yard_end_kp`는 역의 구내 범위이므로 반드시 보존한다.
- 역명 기준은 최신 `소속별 역 현황.xlsx`를 우선한다 (`디지털시티` → `DMC`, `남동인더스` → `남동인더스파크`).

```sql
CREATE TABLE rail_routes (
    id                 INTEGER PRIMARY KEY,
    korail_route_code  TEXT(20) UNIQUE NOT NULL,
    name               TEXT(100) NOT NULL,
    route_category     TEXT(50),
    start_station_code TEXT(30),
    start_station_name TEXT(100),
    start_lat          REAL,
    start_lon          REAL,
    end_station_code   TEXT(30),
    end_station_name   TEXT(100),
    end_lat            REAL,
    end_lon            REAL,
    start_kp           REAL,
    end_kp             REAL,
    length_kp          REAL,
    station_point_count INTEGER NOT NULL DEFAULT 0,
    calculation_basis  TEXT(255),
    is_active          BOOLEAN NOT NULL DEFAULT 1,
    source_file        TEXT(255),
    imported_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rail_stations (
    id           INTEGER PRIMARY KEY,
    station_code TEXT(30) UNIQUE NOT NULL,
    name         TEXT(100) NOT NULL,
    lat          REAL,
    lon          REAL,
    station_role TEXT(20),     -- 관리역 | 소속역
    station_type TEXT(20),     -- 관리역 | 보통역 | 무인역 | 신호장 | 신호소
    match_note   TEXT(255),
    source_file  TEXT(255),
    imported_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

**조회용 view:** `rail_route_baseline_points`  
`rail_routes + rail_stations + rail_route_station_points`를 조인한 역 위치 조회 view. 최종 D3 기준선은 아래 `rail_baseline_points`를 사용한다.

**최종 노선 import 결과 (`최종_노선현황목록_KP기반.xlsx`)**

| 항목 | 건수 |
|---|---:|
| `rail_routes` | 143 |
| `is_active=1` | 143 |
| 시작역 GPS 누락 노선 | 32 |
| 종료역 GPS 누락 노선 | 59 |

**초기 import 결과 (`20260428_전국 역 관리목록_위경도추가.xlsx`)**

| 항목 | 건수 |
|---|---:|
| import 대상 | 1,077 |
| 좌표 + 역중심 KP 있음 (`is_baseline_anchor=1`) | 833 |
| 좌표 있음, 역중심 KP 없음 (`is_baseline_anchor=0`) | 45 |
| 역중심 KP 있음, 좌표 없음 (`is_baseline_anchor=0`) | 199 |
| 좌표 없음 + 역중심 KP 없음 — 제외 | 96 |
| `rail_routes` | 142 |
| `rail_stations` | 862 |
| `rail_route_station_points` | 1,077 |

**import 명령**

```bash
python3 scripts/import_rail_station_baseline.py \
  "/path/to/20260428_전국 역 관리목록_위경도추가.xlsx" \
  --db backend/db.sqlite3 \
  --replace

python3 scripts/import_rail_routes.py \
  "/path/to/최종_노선현황목록_KP기반.xlsx" \
  --db backend/db.sqlite3
```

---

### 1-1-1. `rail_station_management_groups` / `rail_station_management_members` — 관리역·소속역 관계

> Alembic `q6r7s8t9u0v1` 이후 추가.  
> 최신 `소속별 역 현황.xlsx` 기준으로 지역본부·관리역·소속역 관계를 저장한다.

역은 기본적으로 `관리역`과 `소속역`으로 구분한다. 소속역은 향후 `보통역` / `무인역` / `신호장` / `신호소`로 별도 관리할 예정이며, 현재 import 단계에서는 모든 소속역을 `보통역`으로 저장한다.

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
    station_role        TEXT(20) NOT NULL, -- 관리역 | 소속역
    station_type        TEXT(20) NOT NULL, -- 관리역 | 보통역 | 무인역 | 신호장 | 신호소
    match_status        TEXT(30) NOT NULL,
    source_order        INTEGER NOT NULL,
    source_file         TEXT(255),
    source_row          INTEGER,
    imported_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (management_group_id, station_id)
);
```

**소속별 역 현황 import 결과**

| 항목 | 건수 |
|---|---:|
| 관리역 그룹 | 77 |
| 관리역·소속역 관계 | 673 |
| `rail_stations.station_role='관리역'` | 77 |
| `rail_stations.station_role='소속역'` | 594 |
| 소속별 파일에서 신규 생성한 GPS 없는 역 | 15 |
| 최종 `rail_stations` | 877 |

**import 명령**

```bash
python3 scripts/import_station_management.py \
  "/path/to/소속별 역 현황.xlsx" \
  --db backend/db.sqlite3 \
  --replace
```

---

### 1-2. `rail_baseline_points` — D3 렌더링·KP 보간 최종 기준선

> Alembic `p5q6r7s8t9u0` 이후 추가.  
> `rail_route_station_points`의 역 중심·역 구내 시작·역 구내 종료 KP를 D3/KP 보간 기준점으로 생성한다.

`rail_baseline_points`는 노선도를 D3.js로 렌더링하고, 시설물·차단명령의 KP를 좌표로 보간하는 최종 기준선 테이블이다.  
다만 원천 데이터는 아니다. 역 원천은 `rail_route_station_points`, 시설물 원천은 `rail_facilities`이며, `rail_baseline_points`는 이 원천 데이터를 D3/KP 보간에 쓰기 좋게 정렬·보간한 파생 기준선이다.

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

**생성 규칙**

| 항목 | 값 |
|---|---|
| `station_center` 대상 | `center_kp` + GPS가 모두 있는 역 |
| `station_yard_start/end` 대상 | `yard_start_kp`/`yard_end_kp` + GPS가 있고, 같은 노선에 보간 가능한 역 중심점이 2개 이상 있는 역 |
| `source_type` | `rail_route_station_point` |
| `source_id` | `rail_route_station_points.id` |
| `segment_no` | 0 |
| `station_yard_start/end` 좌표 | 같은 노선의 `station_center` anchor를 기준으로 KP 선형 보간 |
| `seq` | 노선별 `kp`, point type 순서, 원천 id 순서 |

**현재 생성 결과**

| `point_type` | 건수 |
|---|---:|
| `station_center` | 833 |
| `station_yard_start` | 788 |
| `station_yard_end` | 788 |
| 합계 | 2,409 |

향후 시설물과 수동 보정점은 같은 테이블에 아래 `point_type`으로 추가한다.

| `point_type` | 용도 |
|---|---|
| `facility_point` | 점 시설물 |
| `facility_start` / `facility_end` | 구간 시설물 시작·종료 |
| `junction_point` | 분기·연결 기준점 |
| `manual_control` | 노선 형태 보정용 수동 기준점 |

**재생성 명령**

```bash
python3 scripts/rebuild_rail_baseline_points.py --db backend/db.sqlite3
```

---

### 1-3. `rail_facility_classifications` / `rail_facilities` / `rail_facility_management_offices` — 철도시설물 정보·소속

> Alembic `r7s8t9u0v1w2`, `s8t9u0v1w2x3`, `t9u0v1w2x3y4`, `w2x3y4z5a6b7`, **`y4z5a6b7c8d9`** 이후 추가.  
> 역은 `rail_stations` 계열에서 분리 관리하고, 역 외 철도시설물은 `rail_facilities`에서 관리한다.

`rail_facilities`는 `rail_routes`와 `rail_baseline_points` 기준으로 시설물 위치를 관리하는 최종 시설물 테이블이다.  
기존 `facilities` 테이블은 기존 화면/API 호환을 위한 레거시 테이블이다. 기존 철도시설물 데이터는 이관하지 않고, 신규 시설물은 `rail_facilities`에 새로 등록한다.
시설물 분류는 자유 텍스트가 아니라 `rail_facility_classifications.id`를 FK로 참조한다.

```sql
CREATE TABLE rail_facility_classifications (
    id                INTEGER PRIMARY KEY,
    code              TEXT(50) UNIQUE NOT NULL,
    major_category    TEXT(30) NOT NULL,   -- 대분류: 구조물 | 전기설비
    sub_category      TEXT(50) NOT NULL,   -- 1차 분류
    detail_category   TEXT(30),            -- 2차 분류 (nullable)
    tertiary_category TEXT(30),            -- 3차 분류 (nullable, 건널목 종별·IEC/InEC 등)
    geometry_type     TEXT(20) NOT NULL,   -- point | linear
    sort_order        INTEGER  NOT NULL,
    is_active         BOOLEAN  NOT NULL DEFAULT 1,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (major_category, sub_category, detail_category, tertiary_category)
);

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

**역할 분리**

| 테이블 | 역할 |
|---|---|
| `rail_facility_classifications` | 시설물 분류 코드 SOT |
| `rail_facilities` | 시설물 자체 정보, 노선, KP, 좌표, 시설물 분류 FK, 관리 사업소 FK |
| `rail_facility_management_offices` | 시설물 관리 단위: 지역본부 + 사업소 + 분야 |
| `rail_baseline_points` | 시설물을 D3/KP 보간 기준선에 올린 결과 |

철도시설물의 소속 체계는 역의 `관리역/소속역` 체계와 분리한다.

| 대상 | 소속 체계 |
|---|---|
| 역 | 지역본부 → 관리역 → 소속역 |
| 철도시설물 | 지역본부 → 사업소 → 시설물 |

`rail_facility_affiliations`는 한 시설물이 여러 조직·사업소에 동시에 소속될 가능성을 고려한 다대다 연결 테이블이었다. 현재 요구사항은 시설물 1건당 지역본부·사업소 1개를 갖는 구조이므로 제거하고, `rail_facilities.management_office_id`로 직접 연결한다.

**시설물 분류 체계 (Alembic `y4z5a6b7c8d9` 기준, 총 24개)**

> **4단계 계층:** 대분류 → 1차(sub_category) → 2차(detail_category) → 3차(tertiary_category)  
> 대분류는 **구조물** / **전기설비** 2개. 건널목·선로출입문은 구조물 하위로 통합. 변전소·신호·통신은 전기설비 하위로 통합.

#### 대분류: 구조물 (15개)

| code | 1차 분류 | 2차 분류 | 3차 분류 | geometry |
|---|---|---|---|---|
| `STRUCTURE_BRIDGE` | 교량 | — | — | linear |
| `STRUCTURE_TUNNEL` | 터널 | — | — | linear |
| `STRUCTURE_TUNNEL_SGANG` | 터널 | 사갱 | — | point |
| `STRUCTURE_TUNNEL_VERTICAL` | 터널 | 수직구 | — | point |
| `STRUCTURE_TUNNEL_SUMP` | 터널 | 집수정 | — | point |
| `STRUCTURE_OVERPASS` | 과선교 | — | — | point |
| `STRUCTURE_CROSSING_STAFFED_1` | 건널목 | 유인 | 1종 | point |
| `STRUCTURE_CROSSING_STAFFED_2` | 건널목 | 유인 | 2종 | point |
| `STRUCTURE_CROSSING_STAFFED_3` | 건널목 | 유인 | 3종 | point |
| `STRUCTURE_CROSSING_UNSTAFFED_1` | 건널목 | 무인 | 1종 | point |
| `STRUCTURE_CROSSING_UNSTAFFED_2` | 건널목 | 무인 | 2종 | point |
| `STRUCTURE_CROSSING_UNSTAFFED_3` | 건널목 | 무인 | 3종 | point |
| `STRUCTURE_GATE_UP` | 선로출입문 | 상선 | — | point |
| `STRUCTURE_GATE_DOWN` | 선로출입문 | 하선 | — | point |
| `STRUCTURE_OTHER` | 기타 | — | — | point |

#### 대분류: 전기설비 (9개)

| code | 1차 분류 | 2차 분류 | 3차 분류 | geometry |
|---|---|---|---|---|
| `ELEC_SUBSTATION_SS` | 변전설비 | SS | — | point |
| `ELEC_SUBSTATION_SP` | 변전설비 | SP | — | point |
| `ELEC_SUBSTATION_SSP` | 변전설비 | SSP | — | point |
| `ELEC_SUBSTATION_PP` | 변전설비 | PP | — | point |
| `ELEC_SUBSTATION_ATP` | 변전설비 | ATP | — | point |
| `ELEC_POWER_DIST` | 전력설비 | 배전소 | — | point |
| `ELEC_SIGNAL_IEC` | 신호설비 | 신호기계실 | IEC | point |
| `ELEC_SIGNAL_INEC` | 신호설비 | 신호기계실 | InEC | point |
| `ELEC_COMM_ROOM` | 통신설비 | 통신기계실 | — | point |

```
구조물
├── 교량
├── 터널 ── 사갱 / 수직구 / 집수정
├── 과선교
├── 건널목 ── 유인(1·2·3종) / 무인(1·2·3종)
├── 선로출입문 ── 상선 / 하선
└── 기타

전기설비
├── 변전설비 ── SS / SP / SSP / PP / ATP
├── 전력설비 ── 배전소
├── 신호설비 ── 신호기계실(IEC / InEC)
└── 통신설비 ── 통신기계실
```

**시설물 baseline 반영 규칙**

| 시설물 형태 | `rail_baseline_points.point_type` |
|---|---|
| 점 시설물 | `facility_point` |
| 구간 시설물 시작 | `facility_start` |
| 구간 시설물 종료 | `facility_end` |

`rail_baseline_points.rail_facility_id`가 최종 시설물 원천 FK다.

---

### 1-4. `rail_route_region_boundaries` — 지역본부 KP 경계

> Alembic `w2x3y4z5a6b7` 이후 추가.  
> 지역본부 경계를 `rail_routes + KP` 기준으로 저장한다.

지역본부 경계는 노선 전체 또는 일부 구간을 `start_kp ~ end_kp`로 표현한다. D3 렌더링 시 `rail_baseline_points`에서 해당 KP 구간을 보간하여 지역본부별 색상/경계선으로 표시한다.

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

**현재 이관 결과**

| 항목 | 건수 |
|---|---:|
| 지역본부 KP 경계 | 39 |
| 지역본부 수 | 12 |
| 포함 노선 수 | 22 |
| D3 LineString 렌더링 가능 경계 | 37 |

`진해선`, `서해선 일부 경계`처럼 `rail_baseline_points`가 2점 미만이거나 해당 KP 구간을 충분히 덮지 못하는 경우는 경계 데이터는 보존되지만 렌더링 LineString은 아직 생성되지 않는다.

---

### 2. `routes` — 노선 (Layer 1)

```sql
CREATE TABLE routes (
    id             INTEGER PRIMARY KEY,
    code           TEXT(30) UNIQUE NOT NULL,
    name           TEXT(50) NOT NULL,
    start_km       REAL     NOT NULL DEFAULT 0.0,
    end_km         REAL     NOT NULL,
    up_direction   TEXT(50),
    down_direction TEXT(50),
    start_station  TEXT(50),   -- 시점역명 (km=0.0 기준역, Alembic g6h7i8j9k0l1)
    end_station    TEXT(50)    -- 종점역명
);
```

| 컬럼 | 예시 |
|---|---|
| code | `'gyeongbu'` |
| name | `'경부선'` |
| start_km / end_km | `0.0` / `451.8` |
| up_direction | `'서울 방향'` |
| down_direction | `'부산 방향'` |
| start_station | `'서울역'` |
| end_station | `'부산역'` |

> **km 기준 원칙:** 각 노선의 `start_station`이 `km=0.0`인 역이며, 같은 노선의 `facilities.km`, `block_orders.start_km/end_km`, `route_geometry.km` 모두 이 역 기준으로 통일한다. 같은 물리적 역이 여러 노선의 시점역일 경우(예: 익산역 → 전라선·군산선), 각 노선 기준 km=0.0으로 별도 등록한다.

---

### 주요 노선 시점역 (start_station) 기준표

노선별 km=0.0 기준역 목록. user geometry CSV 작성 및 시설물 km 입력 시 반드시 이 역 기준으로 맞춰야 한다.

| 노선명 | code | 시점역 (km=0.0) | 종점역 |
|---|---|---|---|
| 경부선 | gyeongbu | 서울역 | 부산역 |
| 경원선 | gyeongwon | 용산역 | 백마고지역 |
| 교외선 | gyooe | 능곡역 | 의정부역 |
| 서해선 | seohae | 대곡역 | 홍성역 |
| 평택선 | pyeongtaek | 현덕역 | 평택역 |
| 중앙선 | jungang | 청량리역 | 모량신호장 |
| 경강선 (성남~여주) | gyeonggang | 판교역 | 여주역 |
| 강릉선 (원주~강릉) | gangneung | 서원주역 | 강릉역 |
| 중부내륙선 | jungbu_naeryuk | 부발역 | 문경역 |
| 영동선 | yeongdong | 영주역 | 강릉역 |
| 태백선 | taebaek | 제천역 | 백산역 |
| 동해선 | donghae | 부산진역 | 삼척역 |
| 장항선 | janghang | 천안역 | 익산역 |
| 호남선 | honam | 대전조차장역 | 목포역 |
| 경부고속선 | gyeongbu_high | 서울역 | 부산역 |
| 충북선 | chungbuk | 조치원역 | 봉양역 |
| 전라선 | jeolla | 익산역 | 여수엑스포역 |
| 경전선 | gyeongjeon | 삼랑진역 | 광주송정역 |
| 호남고속선 | honam_high | 오송역 | 목포역 |
| 경북선 | gyeongbuk | 김천역 | 영주역 |

---

### 3. `facilities` — 시설물 (Layer 2)

```sql
CREATE TABLE facilities (
    id              INTEGER PRIMARY KEY,
    route_id        INTEGER NOT NULL REFERENCES routes(id),
    type            TEXT(20) NOT NULL,    -- 대분류
    station_type    TEXT(10),             -- 소분류 (Alembic h7i8j9k0l1m2, i8j9k0l1m2n3)
    name            TEXT(100) NOT NULL,
    km              REAL NOT NULL,
    km_end          REAL,
    lat             REAL,
    lon             REAL,
    direction       TEXT(4),
    has_station_map BOOLEAN NOT NULL DEFAULT 0,
    note            TEXT
);
```

#### 시설물 분류 체계 (Alembic i8j9k0l1m2n3 이후 적용)

| 대분류 (type) | 소분류 (station_type) | 설명 |
|---|---|---|
| `역` | `관리역` | 지역본부 관리 단위역 (직제규정 [별표2]) |
| `역` | `보통역` | 관리역 산하 소속역 |
| `역` | `무인역` | 무인 운영역 |
| `역` | `신호장` | 신호장 (운전취급, 여객 없음) |
| `역` | `신호소` | 신호소 |
| `변전소` | `SS` / `SP` / `SSP` / `ATP` / `PP` | 변전소 종류별 |
| `구조물` | `터널` / `교량` / `과선교` | km_end로 구간 표시 |
| `구조물` | `건널목` / `분기` | Point 마커 표시 |
| `소속경계` | `지역본부` / `사업소` | 관할 구간 경계 표시 |

| 컬럼 | 설명 |
|---|---|
| type | 대분류: `역` `변전소` `구조물` `소속경계` |
| station_type | 소분류 (위 표 참조) |
| km | KORAIL 공식 시작 거리정 (필수) |
| km_end | 종료 거리정 (구조물/터널·교량·과선교만 입력) |
| lat / lon | WGS84 좌표 (NULL 허용 — NULL이면 route_geometry에서 km 보간) |
| direction | `'UP'` `'DOWN'` `'BOTH'` `NULL`(방향 무관) |
| has_station_map | 역배선도 연결 여부 (역만 해당) |

**노선도 표시 우선순위:**
1. lat/lon 직접 입력값이 있으면 → 그대로 사용
2. lat/lon이 NULL이면 → route_geometry(source='user', lod='high')에서 km 보간

**시설물 줌 레벨별 표시 기준:**

| 대분류/소분류 | 표시 조건 |
|---|---|
| 역/관리역 | 초기 화면부터 (줌 × 0.8 이상) |
| 역/보통역·무인역·신호장·신호소 | 중간 확대 (줌 × 3 이상) |
| 구조물/터널·교량·과선교 | 중간 확대 (줌 × 3 이상, 구간 선으로 표시) |
| 변전소·건널목·분기 | 상세 확대 (줌 × 8 이상) |

---

### 4. `organizations` — 조직 (Layer 3)

```sql
CREATE TABLE organizations (
    id        INTEGER PRIMARY KEY,
    code      TEXT(30) UNIQUE NOT NULL,
    name      TEXT(100) NOT NULL,
    org_type  TEXT(20) NOT NULL,
    is_active BOOLEAN  NOT NULL DEFAULT 1
);
```

| org_type | 설명 |
|---|---|
| `'regional'` | 지역본부 (12개) |
| `'special'` | 사업단 (2개: 고속시설, 고속전기) |

---

### 5. `organization_route_ranges` — 조직별 관할 구간 (Layer 3)

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

| field 코드 | 설명 |
|---|---|
| `'all'` | 본부 행정 관할 (모든 분야 포함) |
| `'시설'` | 시설 분야 담당 경계 |
| `'전기'` | 전기 분야 담당 경계 |
| `'건축'` | 건축 분야 담당 경계 |

---

### 6. `org_viewport` — 조직별 초기 지도 뷰 (Layer 3)

```sql
CREATE TABLE org_viewport (
    id              INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id),
    center_lat      REAL    NOT NULL,
    center_lon      REAL    NOT NULL,
    zoom_level      REAL    NOT NULL DEFAULT 5.0
);
```

zoom_level 기준: 1=전국 조망, 6=본부 권역 수준

---

### 7. `users` — 사용자 (Layer 3)

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
| `'system_superuser'` | 전체 CRUD, 크로스-org 등록, organization_id=NULL |
| `'org_admin'` | 자기 조직 관할 구간 내 등록, organization_id 필수 |
| `'user'` | 전국 조회 전용, organization_id 필수 |

| field | 설명 |
|---|---|
| `NULL` 또는 `'all'` | 모든 분야 |
| `'시설'` `'전기'` `'건축'` | 해당 분야만 |

---

### 8. `block_orders` — 차단명령 (Layer 4)

> **파싱 상세 및 전체 컬럼 명세** → [docs/block_order_pdf_parsing.md](../docs/block_order_pdf_parsing.md)
> Alembic `u0v1w2x3y4z5`, `v1w2x3y4z5a6` 이후 `rail_routes + KP` 기준을 추가했다. 철도 `km`와 `KP`는 같은 의미로 사용하며, 기존 `start_km/end_km` 값은 `start_kp/end_kp`로 그대로 승계한다.

```sql
CREATE TABLE block_orders (
    id               INTEGER PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES organizations(id),
    route_id         INTEGER REFERENCES routes(id),       -- legacy 호환
    rail_route_id    INTEGER REFERENCES rail_routes(id),  -- 최종 노선 기준
    created_by       INTEGER NOT NULL REFERENCES users(id),

    -- 노선·위치
    direction        TEXT(4)  NOT NULL,          -- 'UP' / 'DOWN'
    start_km         REAL,                        -- legacy 호환. KP와 같은 의미
    end_km           REAL,
    start_kp         REAL,                        -- 최종 D3/KP 보간 기준
    end_kp           REAL,
    section_note     TEXT(200),                  -- 단전구간명 (예: "청도SP~밀양SS")

    -- 일시
    work_date        DATE     NOT NULL,
    start_time       TIME     NOT NULL,
    end_time         TIME     NOT NULL,

    -- 분류
    field            TEXT(30) NOT NULL,           -- '시설' | '전기' | '건축'
    block_type       TEXT(30) NOT NULL,
    has_equipment    BOOLEAN  DEFAULT 0,
    has_labor        BOOLEAN  DEFAULT 1,
    is_external      BOOLEAN  DEFAULT 0,

    -- 문서
    doc_no           TEXT(30),
    document_path    TEXT(255),

    -- 담당자 및 연락처
    dept_head        TEXT(50),
    dept_head_phone  TEXT(20),
    work_supervisor  TEXT(50) NOT NULL,
    work_supervisor_phone TEXT(20),
    safety_manager   TEXT(50) NOT NULL,
    safety_manager_phone TEXT(20),
    electric_safety_manager TEXT(50),
    electric_safety_manager_phone TEXT(20),
    contractor       TEXT(100),
    train_watcher    TEXT(50),
    train_watcher_phone TEXT(20),

    -- 작업 내용
    reason           TEXT,
    safety_items     TEXT,
    note             TEXT
);
```

| 컬럼 | 설명 |
|---|---|
| `rail_route_id` | 최종 노선 FK. `rail_routes.id` 기준 |
| `route_id` | 기존 화면/API 호환용 legacy FK. `routes.id` 기준 |
| `direction` | `'UP'`(상선) / `'DOWN'`(하선) |
| `start_kp` / `end_kp` | 차단 구간 KP. 전차선 단전 등 KP 없는 경우 NULL |
| `start_km` / `end_km` | legacy 호환 컬럼. 철도 km와 KP는 같은 의미이므로 `start_kp/end_kp`와 같은 값 |
| `section_note` | 전차선 단전 구간명 (`"청도SP~밀양SS"`) |
| `field` | `'시설'` `'전기'` `'건축'` |
| `block_type` | 차단 종류 (세부내역 섹션명) |
| `doc_no` | 문서번호 (`작업관리센터TF-XXXXXX`) |
| `reason` | 사유/시행사항 (세부내역 표 파싱) |
| `document_path` | 첨부 PDF 상대경로 (`uploads/` 기준) |

**노선도 표시:** `rail_route_id + start_kp/end_kp` 기준으로 `rail_baseline_points`에서 선형 보간하여 차단 구간 오버레이로 표시한다.  
기존 데이터·화면 호환을 위해 `route_id + start_km/end_km`도 입력받지만, 저장 시 같은 값을 `rail_route_id + start_kp/end_kp`로 동기화한다.

**이관 결과**

| 항목 | 건수 |
|---|---:|
| 기존 `block_orders` | 13 |
| `rail_route_id` 매핑 완료 | 13 |
| `start_kp/end_kp` 승계 완료 | 13 |

---

## 권한 검증 로직 (차단명령 등록 시)

| 역할 | 조건 |
|---|---|
| `system_superuser` | 무조건 허용 |
| `user` | 거부 (조회 전용) |
| `org_admin` + `field='all'` | 자기 조직 관할 km 범위 내 모든 분야 |
| `org_admin` + `field='시설'` 등 | 자기 조직 관할 km 범위 내 해당 분야만 |

> 크로스-org(여러 조직 관할에 걸친 구간): system_superuser만 등록 가능

---

## 시드 데이터 실행 순서 (최초 1회)

```bash
cd backend && source .venv/bin/activate && cd ..

python database/seeds/organizations.py    # 1. 14개 조직
python database/seeds/routes.py           # 2. 51개 노선
python database/seeds/org_route_ranges.py # 3. 조직별 관할 구간
python database/seeds/admin_user.py       # 4. 초기 관리자 계정

# 이후:
# 노선도 geometry → 웹 UI (SHP import 또는 노선도 CSV 업로드)
# 시설물 → 웹 UI 시설물 관리 (단건 등록 또는 CSV 업로드)
```

---

## Alembic 마이그레이션

```bash
cd backend && source .venv/bin/activate

alembic upgrade head                              # 최초 테이블 생성 / 최신 반영
alembic revision --autogenerate -m "설명"         # 모델 변경 후 마이그레이션 파일 생성
alembic upgrade head                              # 적용
```

---

## Phase 2: PostgreSQL 전환

```bash
brew install postgresql@15 && brew services start postgresql@15
createdb track_block
# backend/.env: DATABASE_URL=postgresql://localhost/track_block
pip install psycopg2-binary
alembic upgrade head
```

---

## 주의사항

- `db.sqlite3`는 `.gitignore` 처리
- `direction` (block_orders): 반드시 `'UP'` 또는 `'DOWN'`만 저장
- `km` 컬럼은 Float, 소수점 1자리, km 단위
- 비밀번호는 bcrypt 해시값만 저장
- `organization_id=NULL`은 `system_superuser`만 허용
- 파일(.json/.csv)을 데이터 저장소로 사용하지 않는다 — DB가 유일한 기준 (배경 지도 GeoJSON 제외)
- `route_geometry`는 `shp_service` 또는 `geometry_service`를 통해서만 채운다
- `facilities`에서 `route_geometry`를 자동 생성(배포)하지 않는다

---

## 관련 문서

| 문서 | 내용 |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | 프로젝트 전체 개요, 권한 체계, 조직 구조 |
| [../backend/CLAUDE.md](../backend/CLAUDE.md) | ORM 모델 파일 위치, API 엔드포인트, Alembic 명령 |
| [../maps/CLAUDE.md](../maps/CLAUDE.md) | route_geometry 상세 (source 컬럼, LOD, SHP/user 분리) |
| [../docs/block_order_pdf_parsing.md](../docs/block_order_pdf_parsing.md) | 차단명령 PDF 파싱 명세 (파싱 항목·정규식·연락처·Alembic 이력) |
