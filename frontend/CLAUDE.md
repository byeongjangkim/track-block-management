# frontend — 웹 클라이언트

React 18 + TypeScript 기반 SPA.

> **UI/UX 설계** (컬러, 패턴, 공통 컴포넌트) → [UI_UX.md](UI_UX.md)  
> **페이지별 UI 명세** (레이아웃, 필터, 폼) → [UI_UX_pages.md](UI_UX_pages.md)

---

## 환경 및 기술 스택

- **Node.js:** 22 · **빌드:** Vite · **CSS:** Tailwind CSS v4
- **라우팅:** React Router v6 · **서버 상태:** TanStack Query v5
- **클라이언트 상태:** Zustand · **지도:** D3.js v7 · **HTTP:** Axios

---

## 개발 시작

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0   # LAN 접속 가능
# 접속: http://[맥IP]:5173   (IP: ipconfig getifaddr en0)
```

---

## API URL 설정

```typescript
// src/api/client.ts
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
export const api = axios.create({ baseURL: `${BASE_URL}/api/v1` });
```

```bash
# .env.local
VITE_API_URL=http://localhost:8000        # 로컬
VITE_API_URL=http://192.168.0.10:8000    # LAN
```

> 폰에서 접속 시 `localhost`는 폰 자신을 가리킴 — 반드시 맥 LAN IP 사용.

---

## 디렉토리 구조

```
frontend/src/
├── App.tsx                       # React Router 라우트 정의 + RequireAuth 가드
├── main.tsx                      # Vite 진입점
├── pages/
│   ├── LoginPage.tsx
│   ├── BlockMapPage.tsx          # 차단현황도 ★ 메인 — ?date=YYYY-MM-DD URL 파라미터 지원
│   ├── BlockOrdersPage.tsx       # 차단명령 목록/CRUD — 행 클릭 → /block-map?date=
│   ├── CalendarPage.tsx
│   ├── FacilitiesAdminPage.tsx   # 시설물 관리 (org_admin+)
│   ├── OrgRangesAdminPage.tsx    # 담당구역 관리 (superuser) — 조직별 관할구간 CRUD
│   ├── UsersAdminPage.tsx        # 사용자 관리 (superuser)
│   ├── RouteGeometryPage.tsx     # 노선도 관리 (superuser)
│   ├── MapPage.tsx               # /map → /block-map 리다이렉트 전용
│   └── ShpImportPage.tsx         # /admin/shp-import → /admin/route-geometry 리다이렉트 전용
├── components/
│   ├── map/RailwayMap.tsx        # D3.js 전국 노선도 (차단구간·시설물·관할구간 오버레이)
│   ├── block/
│   │   ├── BlockOrderForm.tsx    # 차단명령 등록/수정 모달 + 시행문 PDF 불러오기
│   │   └── PdfImportModal.tsx    # PDF 일괄등록 3단계 모달 (업로드→검토→저장)
│   └── common/Layout.tsx         # 헤더 네비게이션 (역할별 3그룹 메뉴)
├── api/
│   ├── client.ts                 # Axios 인스턴스 (BASE_URL 환경변수)
│   ├── auth.ts                   # 로그인, 내 정보
│   ├── blockOrders.ts            # 차단명령 CRUD + 문서 업로드 + parsePdfForBlockOrder() + bulkCreateBlockOrders()
│   ├── map.ts                    # geometry, org boundaries, viewport, block-segments
│   ├── admin.ts                  # 시설물·geometry 관리
│   ├── adminTypes.ts             # admin API 전용 타입
│   ├── routes.ts                 # 노선 목록
│   ├── facilities.ts             # 시설물 목록
│   ├── organizations.ts          # 조직 목록 + 관할구간 CRUD (createRouteRange/updateRouteRange/deleteRouteRange)
│   └── users.ts                  # 사용자 CRUD
├── store/authStore.ts            # 로그인 상태 (Zustand)
├── types/index.ts                # 공통 타입 (BlockOrder, ParsedRow, BulkBlockOrderItem 등)
└── utils/mapCoord.ts             # 거리정 ↔ 좌표 변환
```

---

## 메뉴 구조

| 그룹 | 메뉴 | 경로 | 접근 |
|---|---|---|---|
| 조회·현황 | 차단현황도 | `/block-map` | 전체 |
| 조회·현황 | 차단명령 | `/block-orders` | 전체 |
| 조회·현황 | 캘린더 | `/calendar` | 전체 |
| 기준정보 관리 | 시설물 관리 | `/admin/facilities` | org_admin+ |
| 시스템 관리 | 노선도 관리 | `/admin/route-geometry` | superuser |
| 시스템 관리 | 담당구역 관리 | `/admin/org-ranges` | superuser |
| 시스템 관리 | 사용자 관리 | `/admin/users` | superuser |

리다이렉트: `/map` → `/block-map`, `/admin/shp-import` → `/admin/route-geometry`

---

## 핵심 패턴

### 역할 판단

```typescript
const user = useAuthStore((s) => s.user);
const canRegister = user?.role === 'org_admin' || user?.role === 'system_superuser';
const isSuperuser = user?.role === 'system_superuser';
```

### BlockOrdersPage 두 단계 필터 상태

```typescript
// input* — 편집 중 (UI만 반영)
// applied* — [조회] 버튼 클릭 시 복사 → queryKey로 사용 → API 호출
```

### RailwayMap D3

- `source='user'` 실선 / `source='shp'` 점선 (`stroke-dasharray: 4 3`)
- 줌 임계값: `ZOOM_STATION=0.8` / `ZOOM_SEGMENT=3` / `ZOOM_DETAIL=8`
- `hiddenRoutes: Set<string>` — D3 path `display` 속성 직접 갱신 (React 리렌더링 없음)
- 줌 배율 표시: `zoomDisplayRef` (useRef) → D3 핸들러에서 DOM 직접 갱신

### PDF 관련 두 가지 흐름

| 기능 | 진입점 | API | 목적 |
|---|---|---|---|
| 시행문 PDF 불러오기 | BlockOrderForm 헤더 버튼 (신규 등록 시만) | `POST /documents/parse-pdf` | 시행문 1건 파싱 → 폼 필드 자동채움 |
| PDF 일괄등록 | BlockOrdersPage 상단 버튼 | `POST /documents/bulk-parse` + `POST /block-orders/bulk` | 세부내역 PDF → 다중 차단명령 일괄 저장 |

**일괄등록 3단계 모달 (PdfImportModal)**

1. **PDF 업로드:** 파일 선택 → `bulk-parse` 호출 → 파싱 결과 수신
2. **검토:** 파싱된 행 테이블 표시. `needs_review=true` 행 주황 강조. `section_note`(단전구간) 파란 텍스트로 표시. 행 삭제 가능
3. **저장:** `block-orders/bulk` 호출 → 성공/실패 건수 배너 표시

**section_note (전차선 단전):** km 값 대신 변전소 구간명(예: `청도SP~밀양SS`) 사용.
`start_km=null`, `end_km=null`, `section_note` 유효 시 검증 통과.

> 파싱 항목 상세·DB 컬럼·정규식 패턴 → [docs/block_order_pdf_parsing.md](../docs/block_order_pdf_parsing.md)

---

## 빌드

```bash
npm run build          # dist/ 생성
npm run build 2>&1 | tail -5   # 빌드 결과 확인
```

---

## 주의사항

- 노선도 GIS는 `route_geometry` DB가 SOT — SVG 파일 미사용
- 역할 판단은 `user.role` string으로 — 불리언 플래그 사용 금지
- 분야(field): `시설`, `전기`, `건축` 3개만 (신호·궤도·토목·통신 금지)
- 모바일 반응형은 Phase 3 이후
