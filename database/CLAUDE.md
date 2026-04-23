# database — DB 스키마 및 시드 데이터

---

## 핵심 원칙: SQLite DB가 유일한 데이터 기준 (Single Source of Truth)

모든 데이터는 SQLite DB에 저장하고, API를 통해서만 조회·수정·삭제한다.
파일(.json/.csv/.tsv)을 데이터 저장소로 사용하지 않는다.

---

## 테이블 계층 구조

```
┌─────────────────────────────────────────────────────┐
│ Layer 0 — GIS 기반 (모든 좌표 계산의 기준)           │
│ route_geometry                                       │
│   route_code, source, lod, segment, seq, lat, lon, km│
└───────────────────┬─────────────────────────────────┘
                    │ route_code = routes.code
┌───────────────────▼─────────────────────────────────┐
│ Layer 1 — 노선                                       │
│ routes  (id, code, name, start_km, end_km, ...)      │
└──────┬──────────────────────────┬───────────────────┘
       │                          │
┌──────▼───────────┐   ┌──────────▼──────────────────┐
│ Layer 2 — 시설물 │   │ Layer 3 — 조직·권한          │
│ facilities       │   │ organizations                │
│ (route_id FK)    │   │ organization_route_ranges    │
│                  │   │ org_viewport                 │
│ 노선도 표시:     │   │ users                        │
│ km → 좌표 보간   │   └──────────┬──────────────────┘
└──────────────────┘              │
                                  │
              ┌───────────────────▼──────────────────┐
              │ Layer 4 — 차단명령                    │
              │ block_orders  (route_id, org_id FK)   │
              │                                       │
              │ 노선도 표시:                          │
              │ start_km~end_km 구간 route_geometry  │
              │ 에서 보간하여 구간 오버레이            │
              └──────────────────────────────────────┘
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
| 중앙선 | jungang | 청량리역 | 경주역 |
| 경강선 (성남~여주) | gyeonggang | 판교역 | 여주역 |
| 강릉선 (원주~강릉) | gangneung | 서원주역 | 강릉역 |
| 중부내륙선 | jungbu_naeryuk | 부발역 | 충주역 |
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
    type            TEXT(20) NOT NULL,
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

| 컬럼 | 설명 |
|---|---|
| type | `STATION` `TUNNEL` `BRIDGE` `OVERPASS` `CROSSING` `SUBSTATION` `JUNCTION` |
| km | KORAIL 공식 시작 거리정 (필수) |
| km_end | 종료 거리정 (TUNNEL·BRIDGE·OVERPASS만 입력) |
| lat / lon | WGS84 좌표 (NULL 허용 — NULL이면 route_geometry에서 km 보간) |
| direction | `'UP'` `'DOWN'` `'BOTH'` `NULL`(방향 무관) |
| has_station_map | 역배선도 연결 여부 (STATION만 해당) |

**노선도 표시 우선순위:**
1. lat/lon 직접 입력값이 있으면 → 그대로 사용
2. lat/lon이 NULL이면 → route_geometry(source='user', lod='high')에서 km 보간

**시설물 type별 노선도 표시 레벨 (줌 기준):**

| type | 표시 조건 |
|---|---|
| STATION | 항상 표시 (전국 조망 포함) |
| TUNNEL / BRIDGE | 소속 선택 후 중간 줌 이상 |
| CROSSING / SUBSTATION / JUNCTION / OVERPASS | 소속 선택 후 상세 줌 이상 |

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

```sql
CREATE TABLE block_orders (
    id               INTEGER PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES organizations(id),
    route_id         INTEGER NOT NULL REFERENCES routes(id),
    created_by       INTEGER NOT NULL REFERENCES users(id),

    -- 노선·위치
    direction        TEXT(4)  NOT NULL,          -- 'UP' / 'DOWN'
    start_km         REAL,                        -- NULL 허용 (전차선 단전)
    end_km           REAL,
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
| `direction` | `'UP'`(상선) / `'DOWN'`(하선) |
| `start_km` / `end_km` | 차단 구간 거리정. 전차선 단전 시 NULL |
| `section_note` | 전차선 단전 구간명 (`"청도SP~밀양SS"`) |
| `field` | `'시설'` `'전기'` `'건축'` |
| `block_type` | 차단 종류 (세부내역 섹션명) |
| `doc_no` | 문서번호 (`작업관리센터TF-XXXXXX`) |
| `reason` | 사유/시행사항 (세부내역 표 파싱) |
| `document_path` | 첨부 PDF 상대경로 (`uploads/` 기준) |

**노선도 표시:** `start_km~end_km` 구간을 `route_geometry`에서 보간하여 차단 구간 오버레이로 표시

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
- 파일(.json/.csv)을 데이터 저장소로 사용하지 않는다 — DB가 유일한 기준
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
