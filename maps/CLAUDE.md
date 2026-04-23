# maps — 노선도 파이프라인

**역할**: 노선 GIS 데이터 관리 → route_geometry DB → D3.js 전국 노선도 렌더링

---

## 핵심 원칙

1. **DB SOT**: 모든 GIS 데이터는 SQLite `route_geometry` 테이블에 저장. 파일로 관리하지 않는다.
2. **source 컬럼으로 레이어 분리**: `source='user'`(공식 데이터)와 `source='shp'`(참조 형태 데이터)를 동일 테이블에서 구분 관리.
3. **user 데이터 우선**: user 데이터가 있는 노선은 user 레이어를 표시. shp 데이터는 user 업로드 완료 후 단계적으로 삭제.
4. **노선별 show/hide**: 전국조망·소속 선택 상태와 무관하게 노선별 표시/숨김 토글 가능.

---

## route_geometry 테이블 구조

```sql
CREATE TABLE route_geometry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    route_code TEXT    NOT NULL,
    source     TEXT    NOT NULL DEFAULT 'shp',  -- 'shp' | 'user'
    lod        TEXT    NOT NULL,                -- 'high' | 'mid' | 'low'
    segment    INTEGER NOT NULL DEFAULT 0,      -- 선분 번호 (아래 기준 참조)
    seq        INTEGER NOT NULL,               -- 선분 내 좌표 순번
    lat        REAL    NOT NULL,               -- WGS84 위도
    lon        REAL    NOT NULL,               -- WGS84 경도
    km         REAL,                           -- KORAIL 거리정 (user만 입력, shp는 NULL)
    UNIQUE (route_code, source, lod, segment, seq)
);
```

### source 별 특성

| source | 입력 방법 | km | 연속성 | 용도 |
|---|---|---|---|---|
| `shp` | 국가기본도 SHP 파싱 | NULL | ❌ 조각남 | 형태 참조용 (점선 표시) |
| `user` | 관리자 CSV 직접 업로드 | ✅ 권장 (NULL 허용) | ✅ 연속 | 공식 노선도 (실선 표시) |

---

## segment 번호 기준

철도 노선은 시점(km 0.0)~종점 구간의 선형 구조이며, 복선·역구내·분기선 등으로 구성된다.
`segment` 컬럼은 이 구조를 표현하기 위한 정수 식별자이다.

### 일반 노선 (복선·복복선)

| segment | 의미 | 비고 |
|---|---|---|
| `0` | **선로 중앙선** (선로 중심, 본선 대표) | SHP 데이터 기준값. 노선도 기본 표시 |
| `1` | **하선** (Down, 종점 방향) | 상세 선형 추가 시 |
| `2` | **상선** (Up, 기점 방향) | 상세 선형 추가 시 |
| `3+` | **3복선 이상** 추가 선로 | 필요 시 순차 추가 |

### 고속선 (KTX)

| segment | 의미 |
|---|---|
| `0` | 선로 중앙선 |
| `1` | T1 (하선, 서울 출발) |
| `2` | T2 (상선, 부산 출발) |

### 역구내 (본선 + 측선)

| segment | 의미 |
|---|---|
| `0` | 본선 (중앙선 연속) |
| 홀수 (1, 3, 5, …) | 상선측 역구내 선 (역 번호 기준) |
| 짝수 (2, 4, 6, …) | 하선측 역구내 선 |

> 역구내 선형은 Phase 3 이후 별도 레이어로 추가 예정.

### 적용 원칙

- **Phase 1 현재**: `segment=0` (선로 중앙선) 만 사용. SHP 데이터가 선로 중심값이므로 그대로 활용.
- SHP import 시 linemerge 결과 연결 불가 구간이 `segment=1, 2, …`로 자동 분리됨 — 이는 임시 조각 번호이며 공식 segment 번호와 무관.
- user CSV 업로드 시에는 `segment=0`으로 통일하여 입력 (지선·측선은 별도 segment).
- 향후 하선/상선 선형 추가 시 `segment=1(하선), 2(상선)` 으로 CSV 직접 입력.

---

---

## 데이터 흐름

### 경로 A — SHP import (source='shp', 형태 참조용)

```
국가기본도_철도중심선 SHP (maps/raw/railway_line/TN_RLROAD_CTLN)
  좌표계: EPSG:5179 → EPSG:4326 변환
  필터: KORAIL 고속(RRC001) + 보통(RRC002) + 도시(RRC004) 철도중심선(RRT001)
    ↓ linemerge → 다중 segment 분리 (연결 불가 구간 별도 segment)
    ↓
route_geometry (source='shp', km=NULL)
  → D3.js: 점선·흐린 색으로 표시 (참고용)
  → user 데이터 업로드 완료 후 삭제 예정
```

**실행:**
```bash
cd maps && source ../backend/.venv/bin/activate
python3 pipeline/import_shp_to_geometry.py --route gyeongbu   # 단일
python3 pipeline/import_shp_to_geometry.py --all               # 전체
python3 pipeline/import_shp_to_geometry.py --list              # 목록
```

**웹 UI:** 백엔드 CLI 또는 API(`POST /api/v1/admin/shp/import`) 직접 호출 (UI는 제거됨)

---

### 경로 B — CSV 직접 업로드 (source='user', 공식 데이터)

```
KORAIL 선로제원표 / 직접 측정 데이터
  → CSV 작성 (segment, seq, lat, lon, km)
  → 노선도 관리 → "노선도 업로드" → API
    ↓
route_geometry (source='user', km=입력값)
  → D3.js: 실선·진한 색으로 표시 (공식)
  → km 기반 관할구간 슬라이싱 가능
  → 해당 노선의 shp 데이터는 별도 관리 후 삭제
```

**CSV 템플릿 컬럼:**
```
segment,seq,lat,lon,km
```

| 컬럼 | 설명 | 예시 |
|---|---|---|
| segment | 선분 번호 (본선=0, 지선=1,2,...) | 0 |
| seq | 선분 내 좌표 순번 (0부터) | 0, 1, 2, ... |
| lat | WGS84 위도 | 37.5547 |
| lon | WGS84 경도 | 126.9707 |
| km | KORAIL 공식 거리정 (소수점 1자리) | 0.0, 0.3, 0.8, ... |

- 노선 코드는 업로드 URL(`/admin/routes/{route_code}/geometry-upload`)로 결정
- 업로드 시 해당 노선의 기존 `source='user'` 데이터를 교체
- LOD(mid, low)는 서버에서 Douglas-Peucker로 자동 생성

**웹 UI:** 노선도 관리(`/admin/route-geometry`) → [CSV 다운로드] → 편집 → [CSV 업로드]

---

## LOD-줌-km 기준 (D3.js 줌 스케일 k 기준)

초기 화면(전국 조망)의 줌 스케일 k ≈ 0.95.  
D3 Mercator 기준 초기 스케일 s₀ ≈ 3.7 px/km.

### 줌 구간별 LOD 전환

| D3 줌 k | 화면 분해능 (1km→px) | LOD | km 간격 목표 | 대상 뷰 |
|---|---|---|---|---|
| k < 3 | < 11 px/km | `low` | **10km** | 전국·광역 조망 |
| 3 ≤ k < 8 | 11~30 px/km | `mid` | **2km** | 지역본부 권역 |
| k ≥ 8 | ≥ 30 px/km | `high` | **500m** | 노선·구간 정밀 |

- RailwayMap.tsx 줌 핸들러에서 `zoomToLod(k)` 함수로 LOD를 자동 판단 후 `currentLod` state 변경
- `currentLod` 변경 시 `fetchAllGeometry(lod)` 재호출 → 노선 경로만 교체 (레이어 구조·줌 위치 유지)
- LOD 전환 시 프로젝션은 유지 (`projRef`), 현재 줌 위치는 `savedTransformRef`로 복원

### CSV 입력 기준 (source='user')

**입력 CSV = high LOD 원본** (500m 간격 권장), mid/low는 업로드 시 자동 생성.

| LOD | tolerance | 자동 생성 결과 | 비고 |
|---|---|---|---|
| `high` | None (원본) | 500m 간격 유지 | CSV 직접 입력 |
| `mid` | 0.005° ≈ 550m | 직선 구간 제거 → 2km 간격 목표 | Douglas-Peucker 자동 |
| `low` | 0.02° ≈ 2.2km | 주요 굴곡만 유지 → 10km 간격 목표 | Douglas-Peucker 자동 |

### CSV 다운로드 우선순위

노선도 관리에서 [CSV 다운로드] 클릭 시:

| 조건 | 반환 내용 |
|---|---|
| USER geometry 있음 | 현재 USER high LOD 데이터 그대로 반환 |
| USER 없음, SHP 있음 | SHP 좌표 + 역 GPS 앵커 기반 km 추정값 포함 |
| USER·SHP 없음, 역 GPS 있음 | 역 앵커 포인트만 포함 |
| 모두 없음 | 빈 템플릿 + 헤더 주석만 |

모든 경우 CSV 헤더에 노선 관리역 목록(km 기준값)과 LOD 입력 기준 주석 포함.

---

## 노선 레이어 토글 (BlockMapPage)

BlockMapPage 사이드바의 [지도 설정 ▼] 섹션 내에 노선별 show/hide 체크박스를 제공한다.

- 날짜·노선 필터, 조직 선택과 **무관하게** 항상 노선 목록 표시 가능
- D3.js는 `hiddenRoutes: Set<string>` 집합에 없는 route_code만 렌더링
- `hiddenRoutes` 변경 시 D3 path `display` 속성만 갱신 (전체 재초기화 없음)
- **그룹 분류:**
  - 고속철도: `gyeongbu_high`, `honam_high`, `gangneung`, `donghae_ktx`, `jungbu_naeryuk`, `suseo_pyeongtaek`
  - 지하철: `suin`, `bundang`
  - 보통철도: 나머지 전체
- 초기 상태: 전체 표시

---

## 파일 구성

```
maps/
├── pipeline/
│   ├── import_shp_to_geometry.py      # SHP → route_geometry source='shp' (신규 노선 등록용)
│   └── seed_org_viewport.py           # org_viewport 초기값 DB 입력
└── raw/
    └── railway_line/
        └── TN_RLROAD_CTLN.*           # 국가기본도_철도중심선 SHP (.gitignore)
```

---

## 구현 단계 및 현황

| 단계 | 내용 | 상태 |
|---|---|---|
| **1. 노선 DB 구축** | routes 테이블 — 51개 노선 등록 | ✅ 완료 |
| **2. SHP import** | source='shp' 49개 노선, 다중 segment | ✅ 완료 |
| **3. 노선 레이어 토글** | BlockMapPage 사이드바 노선별 show/hide (그룹 분류) | ✅ 완료 |
| **4. 노선도 CSV 업로드** | source='user' CSV 업로드, 템플릿/다운로드 | ✅ 완료 |
| **5. SHP 삭제 기능** | 노선별 source='shp' 데이터 삭제 UI | ✅ 완료 |
| **6. user/shp 레이어 분리 렌더링** | user=실선, shp=점선 표시 | ✅ 완료 |
| **7. 시설물 레이어 (km 보간)** | user geometry km 기반 좌표 보간 → D3 렌더링 | ✅ 완료 |
| **8. 차단구간 오버레이** | start_km~end_km → user geometry 보간 → GeoJSON 오버레이 | ✅ 완료 |
| **9. 경부선 user geometry 등록** | SHP → 위도 기반 정렬 + Haversine km 계산 → CSV (12,738pts) | ✅ 완료 |
| **10. 관리역 GPS 앵커 등록** | OSM Overpass API 배치 조회 → 75개 역 GPS 취득 → facilities 등록 | ✅ 완료 |
| **11. LOD 자동 전환** | 줌 k < 3 → low, 3~8 → mid, ≥ 8 → high | ✅ 완료 |
| **12. CSV 다운로드 개선** | geometry-template → USER/SHP/앵커 우선순위별 실데이터 반환 | ✅ 완료 |
| **13. LOD tolerance 재조정** | low 0.02°(10km), mid 0.005°(2km), high None(500m) | ✅ 완료 |
| **14. km 기반 관할구간 슬라이싱** | 전 노선 user 업로드 완료 후 활성화 | ⬜ 대기 |
| **15. 노선별 user CSV 입력** | 각 노선 CSV 다운로드 → 공식 km 수정 → 업로드 → SHP 삭제 | 🔄 진행 중 |

---

## SHP 데이터 한계 (참고)

| 항목 | 내용 |
|---|---|
| km=NULL | SHP에 KORAIL 공식 거리정 없음 → 관할구간 슬라이싱 불가 |
| 선분 조각남 | 경부선 low LOD 기준 69개 조각 → linemerge로 완전 해결 불가 |
| 방향 없음 | 상선/하선(UP/DOWN) 구분 정보 없음 |
| 일부 미수록 | 가야선·가은선 SHP 미수록 |
| 위상 불일치 | 인접 선분 끝점 좌표가 정확히 일치하지 않음 |

→ **위 한계는 user CSV 직접 입력으로만 해결 가능**

---

## 관련 문서

| 문서 | 내용 |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | 프로젝트 전체 개요, 노선도 GIS 아키텍처 요약 |
| [ROUTE_MANAGEMENT.md](ROUTE_MANAGEMENT.md) | 51개 노선 등록 현황, SHP→user 전환 절차 |
| [../backend/CLAUDE.md](../backend/CLAUDE.md) | geometry 관리 API 엔드포인트 |
| [../frontend/UI_UX.md](../frontend/UI_UX.md) | 노선도 렌더링 UI, source별 색상·스타일 |
