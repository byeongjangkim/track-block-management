# UI/UX 설계 문서

선로차단작업 관리 프로그램의 화면 구성, 컴포넌트 패턴, 시각적 규칙을 정의한다.

> **페이지별 UI 명세 (각 화면 레이아웃·필터·폼 상세)** → [UI_UX_pages.md](UI_UX_pages.md)

---

## 1. 설계 원칙

| 원칙 | 내용 |
|---|---|
| **사내망 PC 우선** | 1280px 이상 해상도 기준. 모바일 대응은 Phase 3 이후. |
| **역할 기반 UI** | 권한 없는 기능은 노출하지 않는다. |
| **단순한 데이터 표시** | 통계·그래프보다 날것의 데이터를 테이블로 표시. |
| **한국어 인터페이스** | 메뉴·레이블·메시지 전부 한국어. 코드값만 영문. |
| **최소 클릭** | 조회·등록·수정 흐름에서 불필요한 페이지 전환 배제. |

---

## 2. 기술 스택 (UI 관련)

| 항목 | 선택 |
|---|---|
| CSS | Tailwind CSS v4 |
| 컴포넌트 | shadcn/ui (필요한 것만) |
| 지도 시각화 | D3.js v7 |
| 라우팅 | React Router v6 |
| 서버 상태 | TanStack Query v5 |
| 클라이언트 상태 | Zustand |

---

## 3. 레이아웃 구조

```
┌──────────────────────────────────────────────────────┐
│ Header (고정, bg-blue-700)                            │
│  로고 · 네비게이션 · 사용자 이름 · 로그아웃           │
├──────────────────────────────────────────────────────┤
│ main (flex-1, overflow-hidden)                        │
│  ┌────────────┬─────────────────────────────────────┐ │
│  │ sidebar    │ content (각 페이지)                  │ │
│  │ (MapPage)  │                                     │ │
│  └────────────┴─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

- 사이드바: BlockMapPage 전용, 너비 `w-52` 고정

---

## 4. 컬러 팔레트

### 브랜드 색상

| 용도 | 클래스 |
|---|---|
| 헤더 배경 | `bg-blue-700` |
| 기본 버튼 | `bg-blue-600 hover:bg-blue-700` |
| 링크 | `text-blue-600 hover:underline` |
| 위험(삭제) | `text-red-500` |

### 배경 지도 — 시도·시군구 경계 (D3.js)

| 항목 | Level 1 (시도) | Level 2 (시군구) |
|---|---|---|
| 채움 | 시도별 연한 색 (불투명도 0.15) | 없음 |
| 선 색 | `#6b8299` | `#8fa5b8` |
| 선 굵기 | 1.0 px | 0.5 px |
| 표시 조건 | 항상 | zoom ≥ 1.5 |

시도별 채움색 (`SIDO_FILLS`) — 4색 배분 원칙 (인접 시도 구분):

| 색상 | 시도 |
|---|---|
| `rgba(248,113,113,0.15)` 연장밋빛 | 서울·세종·경남·강원 |
| `rgba(96,165,250,0.15)` 연파랑 | 부산·충북·전남·제주 |
| `rgba(167,139,250,0.15)` 연보라 | 대구·울산·전북 |
| `rgba(52,211,153,0.15)` 연에메랄드 | 인천·충남·경북 |
| `rgba(251,191,36,0.15)` 연노랑 | 광주·대전·경기 |

지도 컨테이너 배경색: `bg-[#e8edf2]` (연한 청회색)

### 노선 색상 (D3.js) — 전차선·선종 기반

| 구분 | 색상 | 조건 |
|---|---|---|
| 고속선 | `#dc2626` 적색 | `line_type='고속선'` |
| 일반선 + 전철화 | `#f97316` 주황 | `line_type='일반선'` + `has_catenary=true` |
| 일반선 + 비전철 | `#9ca3af` 회색 | `line_type='일반선'` + `has_catenary=false` |

전차선 유무는 `rail_routes.default_has_catenary` 와 `rail_track_sections.has_catenary` (구간별 예외) 조합으로 결정됨.

### 차단 색상 (D3.js)

| 구분 | 색상 |
|---|---|
| 전차선단전 (catenary-cuts 레이어) | `#16a34a` 녹색, 중간 두께, 노선 위 표시 |
| 선로차단 (block-segments 레이어) | `#ca8a04` 앰버-노란, 가장 두꺼움 |
| 선로 구분 | **색상 제거** — `tracks` 선로 이름 → 물리 위치로 구분 |

### 관할 구간 강조 색상

| 분야 | 색상 |
|---|---|
| all | `#2563eb` |
| 시설 | `#7c3aed` |
| 전기 | `#d97706` |
| 건축 | `#dc2626` |

### 배지 색상

| 항목 | 배경 | 텍스트 |
|---|---|---|
| 상선 계열 (상선/상1/상2/상3) | `bg-blue-100` | `text-blue-700` |
| 하선 계열 (하선/하1/하2/하3) | `bg-orange-100` | `text-orange-700` |
| 시설 분야 | `bg-indigo-100` | `text-indigo-700` |
| 전기 분야 | `bg-yellow-100` | `text-yellow-700` |
| 건축 분야 | `bg-emerald-100` | `text-emerald-700` |
| 외부 작업 | `bg-yellow-100` | `text-yellow-700` |
| 최상위 관리자 | `bg-red-100` | `text-red-700` |
| 조직 관리자 | `bg-blue-100` | `text-blue-700` |
| 일반 사용자 | `bg-gray-100` | `text-gray-600` |

---

## 5. 역할별 메뉴 표시 규칙

| 메뉴 | 경로 | user | org_admin | superuser |
|---|---|---|---|---|
| 차단현황도 | `/block-map` | ✅ | ✅ | ✅ |
| 차단명령 | `/block-orders` | ✅ | ✅ | ✅ |
| 캘린더 | `/calendar` | ✅ | ✅ | ✅ |
| 기준정보 관리 | `/admin/reference` | ❌ | ✅ | ✅ |
| 시스템 관리 (드롭다운) | — | ❌ | ❌ | ✅ |
| └ 사용자 관리 | `/admin/users` | ❌ | ❌ | ✅ |
| └ 시스템 설정 | `/admin/settings` | ❌ | ❌ | ✅ |

- 시스템 관리: 헤더 드롭다운 메뉴 (hover 아닌 click 방식, 외부 클릭 시 닫힘)
- 활성 페이지: `bg-white text-blue-700`
- 어드민 메뉴: 구분선(`|`) 이후 배치, `text-blue-200`

---

## 7. 공통 컴포넌트 패턴

### 7.1 테이블

- `border rounded-lg overflow-auto` 외곽
- 헤더: `bg-gray-50 sticky top-0`, `text-xs font-medium text-gray-500`
- 행: `border-b hover:bg-gray-50 transition-colors`
- 비어있을 때: `text-center py-12 text-gray-400`

### 7.2 필터/폼 컨트롤

- `<select>`: `h-9 w-32 border rounded-lg pl-3 pr-8 text-sm focus:ring-2 focus:ring-blue-400 bg-white appearance-none cursor-pointer`
- `<input type="date">`: `h-9 border rounded-lg px-3 text-sm focus:ring-2 focus:ring-blue-400 bg-white`
- 커스텀 화살표: `relative div` 래퍼 + `▾` span (`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2`)

### 7.3 버튼 종류

| 종류 | 클래스 패턴 |
|---|---|
| 주 액션 | `px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700` |
| 보조 (수정) | `text-xs text-blue-600 hover:underline` |
| 위험 (삭제) | `text-xs text-red-500 hover:underline` |
| 아웃라인 소형 | `px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-100` |
| 비활성 | `disabled:opacity-40 disabled:cursor-not-allowed` |

### 7.4 알림/피드백 배너

```tsx
// 성공
<div className="bg-green-50 text-green-700 border border-green-200 rounded px-4 py-2 text-sm">
// 오류
<div className="bg-red-50 text-red-700 border border-red-200 rounded px-4 py-2 text-sm">
// 경고
<div className="bg-yellow-50 text-yellow-700 border border-yellow-200 rounded p-4 text-sm">
// 정보
<div className="bg-blue-50 text-blue-700 border border-blue-200 rounded p-3 text-sm">
```

### 7.5 모달 오버레이

```tsx
<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
    ...
  </div>
</div>
```

### 7.6 배지

```tsx
<span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
  상선
</span>
```

### 7.7 로딩 상태

- 데이터 로딩 중: `text-gray-400` 또는 "불러오는 중..." 텍스트
- 버튼 처리 중: `disabled` + 텍스트 변경
- 지도 데이터 없음: `absolute inset-0 flex items-center justify-center text-gray-400`

---

## 8. 차단현황도 (BlockMapPage) 사이드바 구조

```
[조직  선택 드롭다운]  ← 1줄 인라인 (superuser) / 조직명 텍스트 (일반)
[일자  날짜 선택]      ← 1줄 인라인
[시행주체 필터]        ← 전체/공사/공단/외부
[작업형태 필터]        ← 전체/인력/장비/기계
[분야 필터]           ← 전체/시설/전기/건축
[위험등급 필터]       ← 전체/A위험/B주의/C일반/미지정
[지도 설정 ▼ / ▲]   ← 접기/펼치기
  ├ 관할 구간 표시
  ├ 노선 그룹: 레이어(고속선/일반선) + 노선 필터
  ├ 시설물 그룹 (accordion)
  └ 위험/보호구간
[차단명령 목록]        ← 스크롤
```

- 조직/날짜는 `조직 [select]` / `일자 [date]` 형태의 **인라인 1줄** 레이아웃
- 시행주체 필터: 기존 내부/외부 2단계 → 철도공사/철도공단/외부 **3분류**
- 작업형태 필터: 신규 (인력/장비/기계)

### FacilityFilter 인터페이스 (14개 키)

```typescript
interface FacilityFilter {
  역관리역: boolean;       // 관리역
  역보통역: boolean;       // 보통역
  역무인역: boolean;       // 무인역
  역신호장: boolean;       // 신호장
  역신호소: boolean;       // 신호소
  구조물터널: boolean;
  구조물교량: boolean;
  구조물과선교: boolean;
  구조물건널목: boolean;
  구조물분기: boolean;
  전기변전소: boolean;     // ss/sp/ssp/atp/pp
  전기전기실: boolean;     // station_type='전기실'
  전기통신실: boolean;     // station_type='통신실'
  전기신호기계실: boolean; // station_type='신호기계실'
}
```

기본값: **전체 14개 항목 `true`** — 초기 로드 시 모든 시설물 표시.

역 줌 임계값:
- `ZOOM_STATION=0.8`: 관리역 (zoom ≥ 0.8)
- `ZOOM_STATION2=3`: 보통역·무인역·신호장·신호소 (zoom ≥ 3)

### FacilityGroup 컴포넌트

- 상위 체크박스: indeterminate 지원 (일부 활성화 시)
- 화살표 버튼으로 하위 항목 accordion 열기/닫기
- 전기설비 4개 항목 전부 활성 (`hasData=false` 항목 없음)

### 시설물 D3 레이어 (`RailwayMap.tsx`)

데이터 소스: `rail_baseline_points`(역 실좌표) + `rail_facilities` is_active=1(등록 시설물) 병합

| station_type | 색상 | 모양 | 클릭 |
|---|---|---|---|
| 관리역 | `#1d4ed8` | 원(r=4) + 역명 | 팝업 |
| 보통역 | `#3b82f6` | 원(r=2.5) + 역명 | 팝업 |
| 무인역 | `#60a5fa` | 원(r=2.5) + 역명 | 팝업 |
| 신호장 | `#818cf8` | 다이아몬드 | — |
| 신호소 | `#a78bfa` | 다이아몬드 | — |
| 변전소 (ss/sp 등) | `#7c3aed` | 사각형 | 팝업 |
| 전기실 | `#0284c7` | 사각형 | 팝업 |
| 통신실 | `#16a34a` | 사각형 | 팝업 |
| 신호기계실 | `#b45309` | 사각형 | 팝업 |
| 터널 | `#111111` 검은 | 닫힌 사각 윤곽선 □ (fill=none) | 팝업 |
| 교량 | `#111111` 검은 | 양 끝 브래킷 `] [` | 팝업 |
| 과선교 | `#111111` 검은 | 양 끝 브래킷 `] [` | 팝업 |
| 건널목 | `#f59e0b` | × 마커 | 팝업 |
| 분기 | `#059669` | 다이아몬드 | 팝업 |

**FacilityPopup 인터페이스:** `{ x, y, name, type, info }` — `info`는 `노선명  KP~KP_end km` 형식

---

## 10. 시스템 설정 페이지 (SystemSettingsPage)

**경로**: `/admin/settings` (superuser 전용)

**구성**:
- 카테고리별 색상 설정 테이블 (route_colors / block_colors / danger_colors / facility_colors)
- 각 항목: 색상 피커 `<input type="color">` + HEX 코드 직접 입력
- [저장] 버튼: DB에 저장 (변경 사항 있을 때만 활성화)
- [복원] 버튼 (항목별): 해당 항목만 기본값으로 복원
- [전체 기본값 복원] 버튼: 전체 초기화
- [새로고침 (지도 반영)] 버튼: 저장 후 페이지 새로고침 → 지도에 색상 적용

**UX 원칙**:
- 색상 변경은 저장 후 새로고침 시 적용 (실시간 아님)
- 페이지 상단 안내문으로 명시: "설정 저장 후 새로고침해야 지도에 반영됩니다"
- 시설물 아이콘 이미지 섹션: Phase 2 예정 배지로 표시

---

## 11. 차단현황도 상세 패널 (BlockMapPage)

**사업건별 정보 표시 조건**: 선택된 건의 `doc_no`가 있고 같은 문서 건이 2건 이상일 때
```
📋 사업 묶음  문서 TEST-001 — 3건  (지도에서 강조됨)
```

**연속 작업 표시 조건**: 선택된 건과 같은 노선·방향·구간·분야가 연속 날짜에 존재할 때
```
📅 연속 작업  2026-06-02 ~ 2026-06-06  [5일]
```

**패널 닫기 버튼 구현 원칙**:
- 헤더 `<div onMouseDown={drag}>` 안에 닫기 버튼이 있을 때 drag 핸들러가 클릭을 방해하는 문제 방지
- `data-panel-close` 속성 + `target.closest('[data-panel-close]')` 체크로 분리
- 닫기 버튼: `onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}`

---

## 12. 권한별 UI 제어 요약

| 기능 | user | org_admin | superuser |
|---|---|---|---|
| 차단현황도·차단명령·캘린더 조회 | ✅ | ✅ | ✅ |
| 차단명령 등록 | ❌ | ✅ (관할 내) | ✅ |
| 차단명령 수정·삭제 | ❌ | ✅ (자기 조직) | ✅ |
| 시설물 관리 | ❌ | ✅ | ✅ |
| 노선도·사용자 관리 | ❌ | ❌ | ✅ |
| **시스템 설정 (색상)** | ❌ | ❌ | ✅ |
| 조직 선택 드롭다운 | ❌ | ❌ | ✅ |

```typescript
const canRegister = user?.role === 'org_admin' || user?.role === 'system_superuser';
const isSuperuser = user?.role === 'system_superuser';
```

---

## 9. UX 규칙

- **삭제 확인:** `window.confirm()` + 대상 명시
- **폼 검증:** 클라이언트(필수 항목 빈값) + 서버(권한·범위·중복)
- **파일 업로드:** 숨겨진 `<input type="file">` + 버튼 트리거, 업로드 중 비활성화
- **인라인 편집 (FacilitiesAdminPage):** `editingId: number | 'new' | null` 상태로 관리
