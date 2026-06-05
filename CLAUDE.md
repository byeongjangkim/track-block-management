# 선로차단작업 관리 프로그램

KORAIL 전국 선로차단작업 승인 내역 통합 관리 웹 앱.  
14개 조직(지역본부 12 + 사업단 2), 전국 153개 노선을 단일 시스템에서 관리한다.

---

## 개발 환경

| 항목 | 값 |
|---|---|
| 서버 | MacBook M2 14 (arm64, macOS 15, 사내망 LAN) |
| Python | 3.12 / Node.js 22 |
| 백엔드 포트 | **7000** |
| 프론트엔드 포트 | **7001** |
| DB | **PostgreSQL 16** (`track_block`) |

```bash
# 백엔드
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 7000 --reload

# 프론트엔드
cd frontend && npm run dev

# PostgreSQL 서버 상태 확인
brew services list | grep postgresql
```

---

## 프로젝트 구조

```
track-block-management/
├── backend/        ← FastAPI API 서버
├── frontend/       ← React SPA
├── maps/           ← GIS 파이프라인
├── database/       ← DB 시드 데이터
└── docs/           ← 참조 문서
```

---

## 기술 스택

| 계층 | 기술 |
|---|---|
| 백엔드 | FastAPI + SQLAlchemy 2.x (**PostgreSQL 16**) + Alembic + JWT |
| 프론트엔드 | React 18 + TypeScript + Vite + D3.js v7 + Tailwind CSS v4 |
| GIS | D3 geoMercator + rail_baseline_points KP 보간 |

---

## 주요 API

| 카테고리 | 접두사 |
|---|---|
| 인증 | `/api/v1/auth/` |
| 조직 | `/api/v1/organizations/` |
| 노선 | `/api/v1/routes/` (default_track_count 포함) |
| 차단명령 | `/api/v1/block-orders/` |
| 지도·GIS | `/api/v1/map/` |
| 기준정보 | `/api/v1/rail-reference/` |
| 기준정보 집계 | `/api/v1/rail-reference/routes/route-summaries` (노선별 역/시설물 수·오류) |
| 시스템 설정 | `/api/v1/settings/` |
| 어드민 | `/api/v1/admin/` |

---

## 프론트엔드 주요 파일

| 파일 | 역할 |
|---|---|
| `src/pages/BlockMapPage.tsx` | 차단현황도 메인 (`?date=YYYY-MM-DD&block_id=N`) |
| `src/components/map/RailwayMap.tsx` | D3.js 지도 렌더링 (SVG 월드 단위 기반) |
| `src/store/settingsStore.ts` | 색상·stationPointsMode·strokeCapZoom 전역 상태 |
| `src/pages/SystemSettingsPage.tsx` | 시스템 설정 (superuser 전용) |

### 메뉴 구조

| 메뉴 | 경로 | 접근 |
|---|---|---|
| 차단현황도 | `/block-map` | 전체 |
| 차단명령 | `/block-orders` | 전체 |
| 캘린더 | `/calendar` | 전체 |
| 기준정보 관리 | `/admin/reference` | org_admin+ |
| 시스템 관리 → 사용자·설정 | `/admin/users`, `/admin/settings` | superuser |

---

## D3 렌더링 아키텍처

### ❶ SVG 월드 단위 렌더링 원칙

**핵심**: 지도(시군구) + 철도노선 + 차단구간이 **하나의 SVG 좌표계**에서 D3 zoom transform과 함께 자연스럽게 스케일링.

```
D3 geoMercator scale=12180 (Korea 기준):
  1 SVG unit ≈ 418m
  화면 픽셀 = SVG unit × zoom.k
```

**SVG 단위 상수** (`RailwayMap.tsx`):
```typescript
TRACK_HALF_GAP_SVG  = 1.0               // 선로 반간격
ROUTE_STROKE_SVG    = 0.4               // 노선 중심선 두께
BLOCK_STROKE_SVG    = ROUTE_STROKE_SVG * 2  // 차단구간 = 노선의 2배 (0.8)
CATENARY_STROKE_SVG = 1.0               // 전차선단전
LANE_GAP_SVG        = 0.3               // 병행 레인 간격
DANGER_ZONE_SVG     = 8.0               // 위험지구
PROTECT_ZONE_SVG    = 16.0              // 보호지구
ORG_BOUNDARY_SVG    = 3.0               // 관할구간
```

### ❷ Stroke Soft Cap (`strokeCapZoom`)

`k ≤ capZoom`: 자연 성장, `k > capZoom`: 화면 픽셀 고정.

```typescript
function capStrokeSvg(svgVal, k, capZoom) {
  return svgVal * Math.min(1, capZoom / k);
}
```

- 기본 capZoom = **5** (시스템 설정에서 2~20 조정 가능)
- **적용 대상**: zoom handler + 각 useEffect 렌더링 양쪽 모두 적용 필수
- **⚠️ useEffect에서 누락하면**: selectedBlockId 변경 시(클릭/선택해제) 두께가 달라짐
- **⚠️ 새 레이어 추가 시**: zoom handler AND useEffect 양쪽에 capStrokeSvg 추가 필수

zoom k=5 기준 화면 픽셀:

| 요소 | SVG 단위 | 고정 픽셀 |
|---|---|---|
| 노선 중심선 | 0.4 | 2px |
| 차단구간 | 0.8 | 4px |
| 전차선단전 | 1.0 | 5px |

### ❸ 레이어 순서 (아래→위)

```
sigungu-background    배경 지도
sigungu-labels        시군구 경계
routes-computed       노선선
tunnel-bridge         터널·교량 심볼
org-boundaries        관할 구간
danger-zones          위험/보호구간
catenary-cuts         전차선단전 녹색
block-bands           병행작업 집합 밴드 (LOD2)
protection-zone-works 보호지구작업 사각형+해칭
block-segments        선로차단 노란
block-route-badges    zoom<1.5 집계 배지
block-markers         ◆ 분야별 마커
facility-segments     시설물 LineString 히트 영역
facility-points       역·시설물 Point
```

### ❹ 차단작업 표시 규칙

| block_type | 표시 위치 | 표시 방법 |
|---|---|---|
| `전차선단전` | 노선 위 직접 | 녹색 실선 |
| `선로차단` | 노선 위 직접 | 노란 실선, BLOCK_STROKE_SVG |
| `작업구간설정` | 최외방 선로 +0.5×gap 외방 | 노란 실선 (차단 없는 인력/기계) |
| `보호지구작업` | 최외방 선로 +1.0×gap 외방 | 사각형 + 45도 사선 해칭 (높이=2×gap) |
| `임시완속`, `속도제한` | 노선 위 직접 | 노란 점선 |

**선 끝 처리**: `stroke-linecap='butt'` (직사각형, KP 범위와 정확히 일치)

**레인 배정 원칙**: KP 범위가 실제로 겹치는 블록만 다른 레인으로 분리.  
KP가 겹치지 않는 블록은 항상 lane=0 (선로 위 직접 표시).
```
// kpOverlaps(a, b): start_kp/end_kp 겹침 여부로 레인 배정 결정
```

### ❺ ◆ 분야 마커

| 분야 | 색상 |
|---|---|
| 시설 | `#ca8a04` 노란 |
| 전기 | `#16a34a` 녹색 |
| 건축 | `#7c3aed` 보라 |

- 위치: 해당 선로에서 **1.0×TRACK_HALF_GAP 외방**
- 크기: s=10 (미선택), s=14 (선택) — `scale(1/k)` 화면 고정

### ❻ KP 보간 법선 방향 오차 방지

`_rail_kp_range_coords`는 블록 KP 범위 앞뒤로 맥락 앵커 1개씩 포함하여 반환.  
`buildOffsetPath`는 전체 좌표로 법선을 계산하되 맥락 앵커(첫·마지막 점)는 렌더링 제외.

```
// 이유: 블록 시작점의 "이전 이웃" 앵커가 없으면 노선 경로와 법선 방향이 달라
//       동일 +1.0 SVG 오프셋을 적용해도 선로 밖으로 이탈함.
```

### ❼ 줌 배율별 레이어 전환

| zoom | 표시 |
|---|---|
| < 1.5 | 배지만 (클릭 시 zoom=2.5 fly-to) |
| 1.5 ~ 4 | 선분 + 밴드 |
| ≥ 4 | 선분 + ◆ 마커 |

### ❽ 색상 체계

| 구분 | 기본값 | 설정 키 |
|---|---|---|
| 고속선 | `#dc2626` | `route_colors.highway` |
| 일반선 전철화 | `#f97316` | `route_colors.electrified` |
| 일반선 비전철 | `#9ca3af` | `route_colors.non_electrified` |
| 전차선단전 | `#16a34a` | `route_colors.catenary_cut` |
| 선로차단 | `#ca8a04` | `block_colors.track_block` |

모든 색상은 `system_settings` → `settingsStore` → D3 렌더링 (새로고침 후 반영).

---

## ⚠️ 터널·교량 심볼 — 반복 실수 방지

터널·교량은 SVG 단위 기반으로 렌더링 (`buildTBSymbol` 함수, `zoomK` 파라미터 없음).

### bore_type 의미

| bore_type | 심볼 위치 |
|---|---|
| `복선` (기본) | 양쪽 선로 감싸는 하나의 심볼 |
| `단선_상선` | 상선 위치에만 |
| `단선_하선` | 하선 위치에만 |

### 심볼 형태

| 구분 | 형태 |
|---|---|
| 터널 | 닫힌 사각 윤곽선 □ — `.attr('fill', 'none')` 필수 |
| 교량·과선교 | 양 끝 브래킷 `] [` — cap이 **바깥쪽**으로 꺾임 |

### ❌ 절대 금지

1. **터널/교량에 `vector-effect: non-scaling-stroke` 사용** → SVG 단위 렌더링과 충돌
2. **교량 cap 방향 반대** → `[  ]` 모양이 됨 (올바름: `]  [`)
3. **레이블 위치를 useEffect에서 고정 계산** → `_updateFacilityVisibility(k)`에서만 계산
4. **닫힌 path에 fill='none' 누락** → 검은 박스로 채워짐
5. **`buildTBSymbol` / `buildOffsetPath` / `blockSegmentOffsetSvg`에 `zoomK` 재추가** → SVG 단위 일관성 파괴

---

## 노선도 GIS — 역 좌표 모드

`system_settings.map_settings.station_points_mode` 제어 (기본: `center_only`).

| 모드 | 노선도 + KP 보간 앵커 |
|---|---|
| `center_only` | station_center + facility_point/start/end (역 진입로 굴곡 방지) |
| `all_points` | rail_computed_geometry 전체 (시점·종점 포함, 굴곡 발생 가능) |

**facility_start/end(터널·교량 경계)는 center_only에서도 반드시 포함** — 누락 시 경부고속선 등에서 KP 보간 오류 발생.

**노선도 렌더링 ↔ 차단명령 KP 보간 반드시 동일 앵커 사용** — 불일치 시 차단구간이 선로에서 이탈함.

```python
# backend/app/api/v1/map.py
_CENTER_ONLY_POINT_TYPES = "('station_center', 'facility_point', 'facility_start', 'facility_end')"
```

**KP 범위 경계 법선 오차**: `_rail_kp_range_coords`는 start 직전·end 직후 앵커 1개씩 포함.  
프론트엔드 `buildOffsetPath`에서 맥락 앵커 제거 후 렌더링 (4점 이상일 때 slice(1,-1)).

---

## 도메인 핵심 개념

### 조직·권한

- 지역본부 12개 + 사업단 2개 = **14개 조직**
- **role 판단은 string 비교만** — 불리언 플래그 사용 금지
- `field` 코드: `all` / `시설` / `전기` / `건축`

| role | 권한 |
|---|---|
| `system_superuser` | 전체 CRUD, 크로스-org |
| `org_admin` | 자기 조직 관할 구간 내 등록 |
| `user` | 전국 조회 전용 |

### 선로(tracks) 명명

| default_track_count | 선로 이름 |
|---|---|
| 1 단선 | 상선 |
| 2 복선 | 상선, 하선 |
| 4 2복선 | 상1, 상2, 하1, 하2 |
| 6 3복선 | 상1, 상2, 상3, 하1, 하2, 하3 |

- `block_orders.tracks`: JSON 배열 텍스트 (`'["상선"]'`, `'["상1","하1"]'` 등)
- `direction` 컬럼은 **tc05에서 삭제** — `tracks`로 대체
- `block_type`: 단선차단/복선차단 → **선로차단** 통합

### 차단작업 분류

| work_type | 의미 | 렌더링 |
|---|---|---|
| `인력` | 밀차 등 인력·공기구류 | 실선 얇음 |
| `장비` | 보선장비·전철장비 등 | 실선 두꺼움 |
| `기계` | 건설기계관리법상 건설기계 | 점선 두꺼움 |

| implementer | 의미 |
|---|---|
| `철도공사` | 기본값 |
| `철도공단` | 한국철도시설공단 |
| `외부` | → `is_external=true` 자동 동기화 |

### 위험등급

| 값 | 색상 |
|---|---|
| `A` | `#ef4444` |
| `B` | `#f59e0b` |
| `C` | `#10b981` |
| null | `#6b7280` |

### 철도 좌표계

- 기준: 노선코드 + 거리정(KP/km, Float)
- km = KP (동일 의미)
- `UP` = 상선, `DOWN` = 하선, `BOTH` = 기지 전체 (block_orders에서는 tracks JSON으로 대체)

### 기지 노선

`rail_routes.line_type='기지'` — KP 관할구간 검증 생략, org_admin이면 등록 가능.

---

## 시스템 설정 (`system_settings`)

| category | key | 기본값 | 타입 |
|---|---|---|---|
| route_colors | highway / electrified / non_electrified / catenary_cut | 색상코드 | #RRGGBB |
| block_colors | track_block / danger_zone | 색상코드 | #RRGGBB |
| danger_colors | level_a / level_b / level_c / none | 색상코드 | #RRGGBB |
| facility_colors | station_master 등 12개 | 색상코드 | #RRGGBB |
| map_settings | station_points_mode | center_only | center_only \| all_points |
| map_settings | stroke_cap_zoom | 5 | 숫자 2~20 |

API: `GET/PATCH /api/v1/settings/{category}/{key}`, `POST /api/v1/settings/reset-all`

---

## Alembic 마이그레이션

| revision | 내용 |
|---|---|
| `tc01_rail_track_sections` | rail_routes.default_track_count/has_catenary + rail_track_sections |
| `tc02_work_type_implementer` | block_orders.work_type + implementer |
| `tc03_bore_type` | rail_facilities.bore_type (터널·교량 선로 방식) |
| `tc04_system_settings` | system_settings 테이블 + 색상 시드 |
| `tc05_tracks_field` | direction → tracks TEXT(JSON), 단선차단/복선차단 → 선로차단 |
| `tc06_org_ranges_rail_route` | org_route_ranges: route_id(legacy) → rail_route_id(153개 노선) |
| `tc07_org_sort_order` | organizations.sort_order 추가 |
| `tc08_block_order_protection_fields` | catenary_protection / ZEP·ZCP·CPT·TZEP / worker_count |
| `tc09_block_order_parent` | parent_id / equipment_name / speed_restriction |

---

## 코드 컨벤션

| 항목 | 규칙 |
|---|---|
| Python | snake_case |
| TypeScript | camelCase |
| API 경로 | `/api/v1/...` |
| DB 테이블명 | 복수형 snake_case |
| 거리정 | Float, km 단위 |
| 비밀번호 | bcrypt 해시만. `bcrypt==4.0.1` 고정 (5.x 비호환) |
| 파일 경로 | 절대경로 금지 — `pathlib.Path(__file__).parent` 기준 |

## 절대 커밋 금지

`backend/.env` · `frontend/.env.local` · `backend/scripts/dumps/*.sql`

---

## 고속선 선로 번호 체계

고속선(line_type='고속선')은 일반선과 선로 명칭이 다르다.

| T번호 | 방향 | 일반선 대응 | 위치 |
|---|---|---|---|
| T1 | 하선 | 하1 | 중심에서 1번째 |
| T2 | 상선 | 상1 | 중심에서 1번째 |
| T3 | 하선 | 하2 | 중심에서 2번째 |
| T4 | 상선 | 상2 | 중심에서 2번째 |
| T5 | 하선 | 하3 | 중심에서 3번째 |
| T6 | 상선 | 상3 | 중심에서 3번째 |
| T7 | 하선 | 하4 | 중심에서 4번째 |
| T8 | 상선 | 상4 | 중심에서 4번째 |

홀수=하선, 짝수=상선, 중심에서 외측 방향으로 번호 증가.  
일반선/고속선 구분 없이 동일 필드에 저장, 입력 폼은 고속선 선택 시 T번호 표시.

---

## 참조 문서

| 문서 | 내용 |
|---|---|
| [plan.md](plan.md) | 현재 상태, 미구현 항목 |
| [docs/DATABASE.md](docs/DATABASE.md) | DB 스키마 상세 |
| [docs/MAPS.md](docs/MAPS.md) | GIS 파이프라인, KP 보간 |
| [docs/block_order_pdf_parsing.md](docs/block_order_pdf_parsing.md) | PDF 파싱 명세 |
| [frontend/UI_UX.md](frontend/UI_UX.md) | UI/UX 원칙 |
