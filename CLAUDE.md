# 선로차단작업 관리 프로그램

KORAIL 전국 선로차단작업 승인 내역 통합 관리 웹 앱.  
14개 조직(지역본부 12 + 사업단 2), 전국 51개 노선을 단일 시스템에서 관리한다.

---

## 문서 구조 정책

- 이 파일은 **핵심 개념 + 개발 규칙 전체**를 담는다. 루트 CLAUDE.md 하나로 관리한다.
- 구현 세부사항(DB 스키마 전체, GIS 파이프라인)은 `docs/` 참조 문서에 위임한다.
- 코드 수정 후 → 이 파일만 업데이트한다.

---

## 개발 환경 및 포트

| 항목 | 값 |
|---|---|
| 서버 | MacBook M2 14 (arm64, macOS 15, 사내망 LAN) |
| Python | 3.12 |
| Node.js | 22 |
| 백엔드 포트 | **7000** |
| 프론트엔드 포트 | **7001** |
| DB | `backend/db.sqlite3` (SQLite, Phase 1) |

---

## 프로젝트 구조

```
track-block-management/
├── backend/        ← FastAPI API 서버
├── frontend/       ← React SPA
├── maps/           ← GIS 파이프라인
├── database/       ← DB 시드 데이터
├── scripts/        ← 유틸리티 스크립트
└── docs/           ← 참조 문서 (DATABASE.md, MAPS.md 등)
```

---

## 기술 스택 요약

| 계층 | 기술 |
|---|---|
| 백엔드 | FastAPI + SQLAlchemy 2.x (SQLite) + Alembic + JWT |
| 프론트엔드 | React 18 + TypeScript + Vite + D3.js v7 + Tailwind CSS v4 |
| GIS | `rail_computed_geometry` (KP 보간, 77노선) + 정적 GeoJSON 지도 |

---

## 백엔드 개발

### 서버 실행

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 7000 --reload
```

최초 설치:
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # SECRET_KEY 직접 입력
alembic upgrade head
```

### 환경변수 (.env — git 제외)

```
DATABASE_URL=sqlite:///./db.sqlite3
SECRET_KEY=<랜덤 문자열>
ACCESS_TOKEN_EXPIRE_MINUTES=480
UPLOAD_DIR=./uploads
```

### 새 패키지 추가 — 필수 4단계

```bash
pip install <패키지명>                           # 1. venv 설치
# requirements.txt에 추가 (직접 편집)            # 2. 파일에 기재
python3 -c "import app.main; print('import OK')"  # 3. import 확인
curl -m 5 http://localhost:7000/api/health         # 4. 서버 응답 확인
```

> 누락 시 uvicorn이 import 오류로 멈춰 모든 API가 응답 불가 상태가 된다.

### 주요 API 카테고리

| 카테고리 | 접두사 | 비고 |
|---|---|---|
| 인증 | `/api/v1/auth/` | |
| 조직·관할구간 | `/api/v1/organizations/` | |
| 노선·시설물 | `/api/v1/routes/`, `/api/v1/facilities/` | |
| 차단명령 | `/api/v1/block-orders/` | PDF bulk 파싱 포함 |
| 문서·PDF | `/api/v1/documents/` | |
| 지도·GIS | `/api/v1/map/` | sigungu, rail-routes, org-boundaries, facility-items, depots 등 |
| 시설물 관리·어드민 | `/api/v1/admin/` | org_admin+ / superuser |

---

## 프론트엔드 개발

### 개발 시작

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0   # LAN: http://[맥IP]:5173
```

```bash
# .env.local (git 제외)
VITE_API_URL=http://localhost:7000   # LAN 접속 시 맥 IP로 변경
```

### 주요 파일

| 파일 | 역할 |
|---|---|
| `src/App.tsx` | React Router 라우트 + RequireAuth 가드 |
| `src/pages/BlockMapPage.tsx` | 차단현황도 ★ 메인 (`?date=YYYY-MM-DD`) |
| `src/components/map/RailwayMap.tsx` | D3.js 전국 노선도 |
| `src/components/common/Layout.tsx` | 헤더 네비게이션 (역할별 메뉴) |
| `src/store/authStore.ts` | Zustand 로그인 상태 |
| `src/api/map.ts` | geometry, org-boundaries, block-segments |

### D3 렌더링 — 절대 규칙

**한국 지도 (절대 변경 금지):**
- `GET /api/v1/map/sigungu?level=2` → 시도(17개) + 시군구(255개) 동시 로드
- 시도: `SIDO_FILLS` 4색 채움 (투명도 0.15) + `stroke '#6b8299'` 1.0px
- 시군구: `fill none` + `stroke '#8fa5b8'` 0.5px, zoom ≥ 1.5에서만 표시
- `vector-effect: non-scaling-stroke` 필수

**노선도:**
- `hiddenLineTypes: Set<'고속선'|'일반선'>` — D3 path `display` 속성 직접 갱신 (React 리렌더링 없음)
- 줌 임계값: `ZOOM_STATION=0.8` / `ZOOM_SEGMENT=3` / `ZOOM_DETAIL=8`

| D3 레이어 | 소스 | 색상 |
|---|---|---|
| `routes-computed` | `rail_computed_geometry` (77노선) | 고속선 `#dc2626` / 일반선 `#374151` |
| `org-boundaries` | `OrganizationRouteRange` | 분야별 |
| `danger-zones` | `block-segments` 재사용 | 위험(8px/28%) / 보호(20px/12%) |
| `block-segments` | `/map/block-orders/segments` | UP `#ef4444` / DOWN `#f97316` |
| `block-route-badges` | `block-segments` 집계 | zoom < 1.5에서만 표시 — 노선별 건수 원형 배지 |
| `block-markers` | `block-segments` 중심점 | zoom ≥ 1.5에서만 표시 — 위험등급 색상 ◆ 다이아몬드 |
| `facility-points` (Point) | `rail_baseline_points` station_center + `rail_facilities` is_active=1 | 역종별, 전기설비·구조물 종류별 |
| `facility-points` (LineString) | `rail_facilities` geometry_type='linear' | 터널 `#6b7280` / 교량 `#0891b2` / 과선교 `#dc2626` |

**시설물 분류 필터 (`FacilityFilter`):**  
14개 키: `역관리역`, `역보통역`, `역무인역`, `역신호장`, `역신호소`, `구조물터널`, `구조물교량`, `구조물과선교`, `구조물건널목`, `구조물분기`, `전기변전소`, `전기전기실`, `전기통신실`, `전기신호기계실`

- 기본값: **전체 14개 항목 `true`** (초기 로드 시 모든 시설물 표시)
- 역 5개 항목은 각각 개별 필터 키로 관리 (관리역·보통역·무인역 분리, 신호장·신호소 분리)
- `facilities.type='변전소'` + `station_type`으로 전기설비 세부 구분:  
  `ss/sp/ssp/atp/pp` → 변전소 / `전기실` → 전기실 / `통신실` → 통신실 / `신호기계실` → 신호기계실
- CSV 업로드 헤더: `종류,소분류,이름,시작km,종료km,시작위도,시작경도,방향,역배선도,비고`  
  (`소분류` 열이 2026-05에 추가됨; 미입력 시 `station_type=NULL` 저장)

**줌 임계값 (역 세분화 후):**
- `ZOOM_STATION=0.8`: 관리역 표시 시작 (zoom ≥ 0.8)
- `ZOOM_STATION2=3`: 보통역·무인역·신호장·신호소 표시 시작 (zoom ≥ 3)
- `ZOOM_SEGMENT=3`: 구조물 LineString(터널·교량·과선교) 표시
- `ZOOM_DETAIL=8`: 변전소·건널목·분기 표시

**`rail_facilities` 지도 표시:**  
- `GET /api/v1/map/rail-routes/all/facility-items` — `is_active=1` 시설물 전체 반환 (FacilityCollection GeoJSON)  
- `구조물` 분류: type=`구조물`, station_type=`sub_category` (터널/교량/과선교/건널목/분기)  
- `전기설비` 분류: type=`변전소`, station_type=`detail_category.lower()` (ss/sp/ssp 등)  
- `geometry_type='linear'` + 시작·종료 GPS 모두 있으면 LineString, 아니면 Point  
- `mergedFacilityFeatures`: `railStations`(역 실좌표) + `railFacilitiesData`(rail_facilities) 병합  
- 시설물 create/update/delete 시 `_rebuild_computed_geometry_route()` 자동 호출 → `rail_computed_geometry` 즉시 갱신

**`_rebuild_computed_geometry_route(db, rail_route_id)` — `rail_reference.py` 내부 헬퍼:**  
`rail_baseline_points`(is_interpolation_anchor=1) → 3 LOD(high/mid/low) 선형 보간 → `rail_computed_geometry` 갱신.  
`maps/pipeline/rebuild_computed_geometry.py`의 `rebuild_route()` 와 동일 로직.  
시설물 등록·수정·삭제 직후 자동 호출되므로 스크립트 수동 실행 불필요.

**LineString 시설물 클릭 (터널·교량·과선교):**  
`segLayer` path에 `.on('click', ...)` 핸들러 등록 — 클릭 시 `setPopupRef`로 팝업 표시 (노선명 + KP 범위).  
`cursor: pointer` 설정으로 클릭 가능 표시.

**차단구간 클릭 인터랙션:**
- `path.block-segment-hit` (투명 20px 히트 영역) + `path.block-segment` (색상 선) 구조
- 클릭 시 → `onBlockSegmentClick(id)` prop → `BlockMapPage.handleSelect(id)` → 드래그 가능 상세 팝업
- 팝업에서 위험등급 인라인 수정 (`PATCH /api/v1/block-orders/{id}`) → React Query invalidate

**차단구간 줌 기반 표시 전환:**
- zoom < 1.5 (전국): 선분 숨김 + `block-route-badges` 표시 (노선별 건수 + 최고위험등급 색상 원)
- zoom ≥ 1.5 (지역): 선분 표시 + `block-markers` 표시 (구간 중심점 ◆, 위험등급 색상)
- 배지 건수: 동일 `block_order.id` 중복 제거 후 카운트 (상·하선이 각각 feature로 분리되어도 1건)
- `block-segments` useEffect deps에 `allRailGeo` 포함 — D3 init(레이어 생성) 이후 재실행 보장

**D3 race condition 방지:**  
`facility-points` 렌더링 useEffect와 `block-segments` 렌더링 useEffect의 deps에 `allRailGeo` 포함 — 캐시에서 즉시 로드될 때 D3 레이어 미초기화 상태에서 no-op 후 재실행 불가 문제 방지.

**브라우저 줌 전역 차단:**  
`main.tsx`에서 `document.addEventListener('wheel', e.ctrlKey && e.preventDefault(), {passive:false})` 등록 — Ctrl+스크롤 / 트랙패드 핀치로 인한 브라우저 레벨 줌 전체 차단.

### 메뉴 구조

| 메뉴 | 경로 | 접근 |
|---|---|---|
| 차단현황도 | `/block-map` | 전체 |
| 차단명령 | `/block-orders` | 전체 |
| 캘린더 | `/calendar` | 전체 |
| 시설물 관리 | `/admin/facilities` | org_admin+ |
| 담당구역 관리 | `/admin/org-ranges` | superuser |
| 사용자 관리 | `/admin/users` | superuser |

---

## 도메인 핵심 개념

### 조직 구조

- 지역본부 12개 + 사업단 2개 (고속시설·고속전기) = **14개 조직**
- 동일 고속선 구간에 지역본부(행정)와 사업단(분야 유지보수)이 **중복 공존**한다.

### 권한 체계

| role | 설명 |
|---|---|
| `system_superuser` | 전체 CRUD, 크로스-org 등록, organization_id=NULL |
| `org_admin` | 자기 조직 관할 구간 내 등록 (field로 분야 제한) |
| `user` | 전국 차단명령 조회 전용 |

- **role 판단은 string 비교만 사용한다.** 불리언 플래그(`isAdmin` 등) 사용 금지.
- **분야(field) 코드:** `all` / `시설` / `전기` / `건축` — 신호·궤도·토목·통신은 사용하지 않는다.

```typescript
// 역할 판단 패턴 (TypeScript)
const canRegister = user?.role === 'org_admin' || user?.role === 'system_superuser';
const isSuperuser = user?.role === 'system_superuser';
```

### 위험등급 (danger_level)

`block_orders.danger_level` — 차단작업의 위험 수준 분류.

| 값 | 표시 | 색상 |
|---|---|---|
| `'A'` | A 위험 | `#ef4444` (적색) |
| `'B'` | B 주의 | `#f59e0b` (황색) |
| `'C'` | C 일반 | `#10b981` (녹색) |
| `null` | 미지정 | `#6b7280` (회색) |

- 차단명령 등록 시 설정하거나 차단현황도 팝업에서 사후 등록 가능
- 차단현황도·차단명령·캘린더 3개 페이지에서 등급별 필터 지원
- 지도 마커(◆)와 노선 집계 배지 색상으로 시각화

### 철도 좌표계

- 기준: **노선코드 + 거리정(KP/km)**, 단위 Float, 소수점 1자리 (예: `325.4`)
- 방향: `UP` (상선, 기점 방향) / `DOWN` (하선, 종점 방향) / `BOTH` (기지 전체 작업)
- `km`과 `KP`는 같은 의미이다.

### 기지 노선 (line_type = '기지')

차량기지·보수기지는 `rail_routes`에 `line_type='기지'`로 별도 등록. KP는 인출선 분기점 기산(0.0).  
차단명령 등록 시: `BlockOrderForm`의 **기지 작업 탭** → `rail_route_id`(기지 ID) + `track_name`(선로명) 사용.  
`GET /api/v1/map/rail-routes/depots` — 기지 목록 반환 (폼 드롭다운용).  
기지 작업은 KP 관할구간 검증 생략, org_admin 권한이면 등록 가능.

### 노선도 GIS

- 모든 노선 GIS는 `rail_computed_geometry` 단일 SOT (77노선, 16,295점, KP 보간).
- `rail_baseline_points`: KP + GPS anchor 원천 (station_center 833개 등 2,409점).
- `rail_facilities` (`use_as_baseline_anchor=1`, `is_active=1`): 시설물 GPS가 자동으로 baseline anchor 등록 → 시설물 저장 시 해당 노선 geometry 자동 재계산.
- **대한민국 지도** (`korea_map_level*.geojson`, `sigungu-background` D3 레이어,  
  `/map/sigungu` API) **절대 삭제·변경 금지.**

---

## 코드 컨벤션

| 항목 | 규칙 |
|---|---|
| Python | snake_case |
| TypeScript | camelCase |
| API 경로 | `/api/v1/...` |
| DB 테이블명 | 복수형 snake_case (`block_orders`, `facilities`) |
| 거리정 | Float, 소수점 1자리, km 단위 |
| 비밀번호 | bcrypt 해시만 저장. `bcrypt==4.0.1` 고정 (5.x 비호환) |
| 파일 경로 | 절대경로 금지 — `pathlib.Path(__file__).parent` 기준 상대경로 |

---

## 절대 커밋 금지

`backend/.env` · `backend/db.sqlite3` · `frontend/.env.local`

---

## 참조 문서

| 문서 | 내용 |
|---|---|
| [plan.md](plan.md) | 개발 로드맵, Phase 현황 |
| [docs/DATABASE.md](docs/DATABASE.md) | DB 스키마 상세, ORM 모델, Alembic |
| [docs/MAPS.md](docs/MAPS.md) | GIS 파이프라인, LOD, KP 보간, 지도 배경 |
| [docs/block_order_pdf_parsing.md](docs/block_order_pdf_parsing.md) | PDF 파싱 명세 |
| [frontend/UI_UX.md](frontend/UI_UX.md) | UI 설계 원칙, 컬러 팔레트, UX 규칙 |
