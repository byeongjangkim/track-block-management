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

### 새 패키지 추가 — 필수 4단계

```bash
pip install <패키지명>
# requirements.txt에 추가 (직접 편집)
python3 -c "import app.main; print('import OK')"
curl -m 5 http://localhost:7000/api/health
```

### 주요 API 카테고리

| 카테고리 | 접두사 |
|---|---|
| 인증 | `/api/v1/auth/` |
| 조직·관할구간 | `/api/v1/organizations/` |
| 노선·시설물 | `/api/v1/routes/`, `/api/v1/facilities/` |
| 차단명령 | `/api/v1/block-orders/` |
| 문서·PDF | `/api/v1/documents/` |
| 지도·GIS | `/api/v1/map/` |
| 기준정보 | `/api/v1/rail-reference/` |
| 시설물 관리·어드민 | `/api/v1/admin/` |
| **시스템 설정** | `/api/v1/settings/` |

---

## 프론트엔드 개발

### 주요 파일

| 파일 | 역할 |
|---|---|
| `src/App.tsx` | React Router 라우트 + RequireAuth 가드 |
| `src/pages/BlockMapPage.tsx` | 차단현황도 ★ 메인 (`?date=YYYY-MM-DD&block_id=N`) |
| `src/components/map/RailwayMap.tsx` | D3.js 전국 노선도 |
| `src/components/common/Layout.tsx` | 헤더 네비게이션 (역할별 메뉴) |
| `src/store/authStore.ts` | Zustand 로그인 상태 |
| `src/store/settingsStore.ts` | Zustand 시스템 설정 (색상 + `stationPointsMode`) |
| `src/api/map.ts` | geometry(`station_mode` 파라미터), org-boundaries, block-segments |
| `src/api/settings.ts` | 시스템 설정 CRUD API |
| `src/pages/SystemSettingsPage.tsx` | 색상 + 지도 설정 관리 페이지 (superuser) |

### 메뉴 구조

| 메뉴 | 경로 | 접근 |
|---|---|---|
| 차단현황도 | `/block-map` | 전체 |
| 차단명령 | `/block-orders` | 전체 |
| 캘린더 | `/calendar` | 전체 |
| 기준정보 관리 | `/admin/reference` | org_admin+ |
| 시스템 관리 (드롭다운) | — | superuser |
| &nbsp;&nbsp;└ 사용자 관리 | `/admin/users` | superuser |
| &nbsp;&nbsp;└ 시스템 설정 | `/admin/settings` | superuser |

---

## D3 렌더링 — 절대 규칙

**한국 지도 (절대 변경 금지):**
- `GET /api/v1/map/sigungu?level=2` → 시도(17개) + 시군구(255개) 동시 로드
- 시도: `SIDO_FILLS` 4색 채움 (투명도 0.15) + `stroke '#6b8299'` 1.0px
- `vector-effect: non-scaling-stroke` 필수

### D3 레이어 순서 (아래→위)

```
sigungu-background  (배경 지도)
sigungu-labels      (시군구 경계)
tunnel-bridge       (터널·교량 심볼 — routes 위에 표시)
routes-computed     (노선선)
org-boundaries      (관할 구간)
danger-zones        (위험/보호구간)
catenary-cuts       (전차선단전 녹색)
block-bands         (병행작업 집합 밴드 LOD2)
block-segments      (선로차단 노란)
block-route-badges  (zoom<1.5 배지)
block-markers       (◆ 위험등급 마커)
facility-segments   (시설물 LineString 히트 영역)
facility-points     (역·시설물 Point)
```

### 노선 색상 체계

| 구분 | 색상 | 코드 |
|---|---|---|
| 고속선 (전차선 있음) | 적색 | `#dc2626` |
| 일반선 + 전철화 | 주황 | `#f97316` |
| 일반선 + 비전철 | 회색 | `#9ca3af` |
| **전차선단전** 구간 오버레이 | **녹색** | `#16a34a` |
| **선로차단** | **앰버-노란** | `#ca8a04` |

노선 색상은 `rail_routes.default_has_catenary` + `rail_track_sections.has_catenary` (구간별 예외) 양쪽으로 결정됨.
- zoom < 1.5 포함 모든 줌에서 구간별 `has_catenary` 반영 (단일 선이지만 구간별 색상 분리)

**색상 커스터마이징**: `system_settings` 테이블 값 → `settingsStore` → D3 렌더링
- 변경 후 새로고침 시 반영 (실시간 아님)
- 기본값 복원: `POST /api/v1/settings/{category}/{key}/reset`
- 전체 복원: `POST /api/v1/settings/reset-all`

### 복선 상·하선 간격 (TRACK_HALF_GAP)

zoom 배율별 전체 간격 (상선↔하선 중심 간):

| 줌 | 전체 간격 | 상선 위치 | 하선 위치 |
|---|---|---|---|
| 1.5 | 4px | -2px | +2px |
| 3 | 6px | -3px | +3px |
| 6 | 8px | -4px | +4px |
| 10 | 10px | -5px | +5px |
| 20 | 12px | -6px | +6px |
| 30 | 14px | -7px | +7px |

- `trackHalfGapPx(zoomK)` 함수가 로그 보간으로 계산
- 선로차단선은 `blockSegmentOffsetSvg()` 가 선로 이름 → 물리 위치 변환 → 선로 위에 정확히 겹침

### 차단구간 선 두께 (zoom 반응)

`laneWidthPx(k) = min(10, max(3, 3 + log₂(k)))`  
zoom 증가에 따라 로그적으로 두꺼워짐:

| zoom | 두께 |
|---|---|
| 1.5 | ~3.6px |
| 4 | 5px |
| 9 | ~6.2px |
| 20 | ~7.3px |

### 다복선(2복선·3복선) 선로 간격 — LOD 확장

- zoom ≤ 5.8: 압축 모드 — 복선과 동일 스팬 (지도 산만함 방지)
- zoom 5.8→20: 선형 보간으로 점진적 확장
- zoom ≥ 20: **완전 확장** — 선로 간 간격 = 복선 상하선 간격(2×half)과 동일

| zoom | 복선 스팬 | 2복선 스팬 | 3복선 스팬 |
|---|---|---|---|
| ≤ 5.8 | 기준 | 동일 | 동일 |
| ~10 | 기준 | 30% 확장 | 30% 확장 |
| ≥ 20 | 기준 | **3× 기준** | **5× 기준** |

### 차단 유형별 시각화

| block_type | 유형 | 렌더링 |
|---|---|---|
| **선로차단** | 선로차단 | 앰버-노란, 해당 선로(tracks) 위, 실선 두꺼움 |
| 임시완속, 속도제한 | 선로차단(부분) | 앰버-노란, 장대시 대시 |
| 작업구간설정 | 선로변 작업 | 앰버-노란, 단대시 대시 |
| 전차선단전 | 전차선 차단 | **녹색, 노선 위 직접 표시** (별도 catenary-cuts 레이어) |

**두께 위계**: 선로차단(노란) > 전차선단전(녹색) > 노선도

### 분야별 다중 레인

같은 선로에 여러 분야 차단이 겹치면 레인을 나눔:
- 우선순위: 시설(0) → 전기(1) → 건축(2)
- 선로 구분: `tracks` 필드의 선로 이름으로 물리 위치 결정 (복선 좌=상선, 우=하선)

### 줌 배율별 레이어 전환

| zoom | 표시 |
|---|---|
| < 1.5 | 노선별 집계 배지 (건수 원) — **클릭 시 zoom=2.5로 fly-to** |
| 1.5 ~ 4 | 개별 레인 선분 + 집합 밴드 |
| ≥ 4 | 개별 레인 선분 + ◆ 마커 (분야 약자) |

**배지 클릭**: D3 이벤트에서 `zoomRef.current.transform`으로 zoom=2.5, 배지 중심 700ms 애니메이션

### 시설물 표시 기준

**역 (zoom 기준):**
- `ZOOM_STATION=0.8`: 관리역
- `ZOOM_STATION2=3`: 보통역·무인역·신호장·신호소

**구조물 LineString:**
- `ZOOM_SEGMENT=3`: 표시 시작

**전기설비·건널목·분기:**
- `ZOOM_DETAIL=8`: 표시 시작

---

## ⚠️ 터널·교량 심볼 렌더링 규칙 (반복 실수 금지)

### 관점

터널·교량은 **지리 정보가 아닌 철도 시설물**로 다룬다.  
각 선로(상선/하선) 위에 표시하며, 해당 구간의 선로가 터널/교량에 있음을 나타낸다.

### bore_type 의미

| bore_type | 적용 | 심볼 위치 |
|---|---|---|
| `복선` (기본) | 상·하선이 하나의 구조물 안에 있음 | 양쪽 선로를 감싸는 하나의 심볼 |
| `단선_상선` | 상선 전용 단선 터널/교량 | 상선 위치에만 |
| `단선_하선` | 하선 전용 단선 터널/교량 | 하선 위치에만 |

### 심볼 형태

| 구분 | 형태 | 설명 |
|---|---|---|
| **터널** | 닫힌 사각 윤곽선 □ | `M c1 L c4 L c3 L c2 Z` — 채움(fill) 없음 |
| **교량·과선교** | 양 끝 브래킷 `] [` | 시작=`]`, 끝=`[`, 갈고리가 **바깥쪽**으로 꺾임 |

### ❌ 절대 하지 말 것

1. **`stroke-width`에 `vector-effect: non-scaling-stroke` 없이 고정값 지정 금지**  
   → zoom에 비례해 두꺼워져 내부가 채워진 검은 박스가 됨
   
2. **교량 브래킷 cap 방향 반대 금지**  
   - ❌ 잘못: cap이 **안쪽(내부)**으로 꺾임 → `[   ]` 모양
   - ✅ 올바름: cap이 **바깥쪽(외부)**으로 꺾임 → `]   [` 모양
   - 시작 브래킷 path: `M(c1 - fwd) L c1 L c2 L(c2 - fwd)` ← **-fwd(뒤쪽)**
   - 끝 브래킷 path: `M(c4 + fwd) L c4 L c3 L(c3 + fwd)` ← **+fwd(앞쪽)**

3. **레이블 위치를 useEffect에서 고정 계산 금지**  
   → useEffect 실행 시 zoom이 초기값(~0.5)이면 SVG 단위가 과도하게 커져 
     실제 zoom 시 레이블이 시설물에서 매우 멀리 표시됨  
   → 반드시 `_updateFacilityVisibility(k)`에서 현재 zoom으로 재계산

4. **`fill` 속성 기본값 주의**  
   → 닫힌 SVG 경로(`Z`)는 `fill` 기본값이 `black` → 반드시 `.attr('fill', 'none')` 명시

### 올바른 구현 요약

```typescript
// 터널 심볼 (닫힌 사각 윤곽선)
`M${c1} L${c4} L${c3} L${c2} Z`

// 교량 심볼 (] [ — cap이 바깥쪽으로)
// 시작 ]: cap이 -fwd(뒤쪽/시작방향)으로 꺾임
`M${c1-fwd} L${c1} L${c2} L${c2-fwd}`
// 끝 [: cap이 +fwd(앞쪽/끝방향)으로 꺾임  
`M${c4+fwd} L${c4} L${c3} L${c3+fwd}`

// stroke 설정 — non-scaling-stroke 필수
.attr('fill', 'none')
.attr('stroke', '#111111')
.attr('stroke-width', 1.5)
.attr('vector-effect', 'non-scaling-stroke')  // ← 없으면 zoom에 비례해 두꺼워짐
```

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
- **분야(field) 코드:** `all` / `시설` / `전기` / `건축`

### 위험등급 (danger_level)

| 값 | 표시 | 색상 |
|---|---|---|
| `'A'` | A 위험 | `#ef4444` (적색) |
| `'B'` | B 주의 | `#f59e0b` (황색) |
| `'C'` | C 일반 | `#10b981` (녹색) |
| `null` | 미지정 | `#6b7280` (회색) |

### 선로(tracks) 명명 규칙

| default_track_count | 선로 이름 |
|---|---|
| 1 (단선) | 상선 |
| 2 (복선) | 상선, 하선 |
| 4 (2복선) | 상1, 상2, 하1, 하2 |
| 6 (3복선) | 상1, 상2, 상3, 하1, 하2, 하3 |

- `block_orders.tracks`: JSON 배열 텍스트 `'["상선"]'`, `'["상선","하선"]'`
- 복수 선택 가능 (예: 상선+하선 동시 차단, 상1+상2 등)
- `direction` 컬럼은 tc05 마이그레이션에서 삭제 → `tracks`로 대체
- `block_type`: 단선차단/복선차단 → **선로차단**으로 통합
- 기지(기지 노선) 선로는 추후 구현 예정

### 차단작업 분류

**작업형태 (work_type):**

| 값 | 의미 | 지도 표시 |
|---|---|---|
| `인력` | 밀차 등 인력·공기구류 | 실선 얇음 |
| `장비` | 보선장비·전철장비 등 철도차량 | 실선 두꺼움 |
| `기계` | 건설기계관리법상 건설기계 | 점선 두꺼움 |

**시행주체 (implementer):**

| 값 | 의미 |
|---|---|
| `철도공사` | 한국철도공사 (기본값) |
| `철도공단` | 한국철도시설공단 |
| `외부` | 외부 시공사·지자체 등 |

- `implementer='외부'`이면 `is_external=true` 자동 동기화 (레거시 호환)
- 전차선단전 등록 시 `has_catenary` 자동 검증 → 비전철 구간 등록 거부

### 선로 구성

**`rail_routes` 기본값:**
- `default_track_count INTEGER DEFAULT 2`: 단선(1)/복선(2)/복복선(4)/삼복선(6)
- `default_has_catenary BOOLEAN DEFAULT 1`: 전차선 유무

**`rail_track_sections`**: 구간별 예외 정의 (KP 범위 + track_count + has_catenary)  
→ 조회 시 `rail_track_sections` 우선, 없으면 `rail_routes` 기본값

### 철도 좌표계

- 기준: **노선코드 + 거리정(KP/km)**, 단위 Float
- 선로: `tracks` JSON 배열 (예: `["상선"]`, `["상1","하1"]`) — tc05 이후 `direction` 컬럼 대체
- `km`과 `KP`는 같은 의미

### 차단명령 관리 원칙

- **건별·날짜별 이중 관리**: 각 `block_order` 1건 = 1일 1구간. `doc_no`로 같은 문서 묶음 조회 가능
- **연속 작업**: 같은 구간 여러 날짜 = 날짜별 별도 건으로 등록 (각 날짜 = 독립 건)
- **전차선단전 + 선로차단 동시**: 같은 문서 내 별도 block_order로 등록, `doc_no`로 연계

### 사업건별 지도 강조

- 차단명령 카드 클릭 시 같은 `doc_no` = 같은 사업 묶음으로 인식
- 해당 사업 건들 → 밝게 표시, 나머지 → opacity × 0.25 흐리게
- `RailwayMap` prop: `highlightedBlockIds?: Set<number>`
- 상세 패널: "📋 사업 묶음 문서 XXX — N건" 표시

### 연속 작업 자동 감지

- 선택된 건의 ±45일 범위 로드 (확장 쿼리, 선택 시만 실행)
- 같은 노선+tracks+구간+분야가 연속 날짜에 등록된 경우 "시리즈" 감지
- 상세 패널: "📅 연속 작업 YYYY-MM-DD ~ YYYY-MM-DD  [N일]" 표시
- `BlockOrdersPage`에 `doc_no` 텍스트 필터 추가로 사업 단위 일괄 조회 가능

### 기지 노선 (line_type = '기지')

차량기지·보수기지는 `rail_routes`에 `line_type='기지'`로 별도 등록.  
기지 작업은 KP 관할구간 검증 생략, org_admin 권한이면 등록 가능.

### 차단현황도 포커스 (fly-to)

- 사이드바 카드 클릭 → 해당 차단구간 위치로 지도 이동 (700ms 애니메이션)
- 캘린더·차단명령 페이지에서 항목 클릭 → `/block-map?date=...&block_id=N` 으로 이동
- `BlockMapPage`가 `block_id` URL 파라미터를 읽어 자동 선택 + fly-to

### 노선도 GIS

- `rail_computed_geometry`: 기본 노선 GIS SOT (77노선, all_points 모드)
- `rail_baseline_points`: KP + GPS anchor 원천 (center_only 모드 직접 사용)
- **대한민국 지도** (`korea_map_level*.geojson`) **절대 삭제·변경 금지**

#### 역 좌표 모드 (station_points_mode)

`system_settings.map_settings.station_points_mode` 로 제어. **기본값: `center_only`**

| 모드 | 노선도 앵커 | KP 보간 앵커 | 특징 |
|---|---|---|---|
| `center_only` | station_center + facility_point/start/end | 동일 | 역 진입로 굴곡 없음, 터널·교량 포함 |
| `all_points` | rail_computed_geometry 전체 | 전체 앵커 | 기존 방식, 역 구내 굴곡 발생 가능 |

**앵커 포함 기준 (center_only):**
- ✅ `station_center`: 역 중심 GPS
- ✅ `facility_point`: 변전소 등 점 시설물
- ✅ `facility_start/end`: 터널·교량 경계점 (본선 위에 있으므로 포함)
- ❌ `station_yard_start/end`: 역 진입로 (곡선 굴곡 유발, 제외)

**중요**: 노선도 렌더링과 차단명령 KP 보간은 **반드시 동일한 앵커 셋**을 사용. 불일치 시 차단구간이 노선에서 이탈함.

---

## Alembic 마이그레이션 이력 (주요)

| revision | 내용 |
|---|---|
| `tc01_rail_track_sections` | `rail_routes.default_track_count/has_catenary` + `rail_track_sections` 신규 |
| `tc02_work_type_implementer` | `block_orders.work_type` + `implementer` 추가, `is_external` 마이그레이션 |
| `tc03_bore_type` | `rail_facilities.bore_type` 추가 (터널·교량 선로 적용 방식) |
| `tc04_system_settings` | `system_settings` 테이블 + 22개 색상 초기값 시드 |
| `tc05_tracks_field` | `block_orders.direction` 삭제 → `tracks` TEXT(JSON) 교체. 단선차단/복선차단 → 선로차단 |

---

## 코드 컨벤션

| 항목 | 규칙 |
|---|---|
| Python | snake_case |
| TypeScript | camelCase |
| API 경로 | `/api/v1/...` |
| DB 테이블명 | 복수형 snake_case |
| 거리정 | Float, 소수점 1자리, km 단위 |
| 비밀번호 | bcrypt 해시만 저장. `bcrypt==4.0.1` 고정 (5.x 비호환) |
| 파일 경로 | 절대경로 금지 — `pathlib.Path(__file__).parent` 기준 |

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
