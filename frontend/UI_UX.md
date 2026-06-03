# UI/UX 설계

---

## 설계 원칙

- **사내망 PC 우선** (1280px 이상), 모바일 미지원
- **역할 기반 UI** — 권한 없는 기능은 노출하지 않음
- **한국어 인터페이스** — 코드값만 영문
- **단순 데이터 표시** — 날것의 테이블 우선

---

## 기술 스택

| 항목 | 선택 |
|---|---|
| CSS | Tailwind CSS v4 |
| 지도 시각화 | D3.js v7 |
| 라우팅 | React Router v6 |
| 서버 상태 | TanStack Query v5 |
| 클라이언트 상태 | Zustand |

---

## 색상 팔레트

### 브랜드

| 용도 | 클래스 |
|---|---|
| 헤더 배경 | `bg-blue-700` |
| 기본 버튼 | `bg-blue-600 hover:bg-blue-700` |
| 위험(삭제) | `text-red-500` |

### 배경 지도 — 시도별 채움

| 색상 | 시도 |
|---|---|
| `rgba(248,113,113,0.15)` | 서울·세종·경남·강원 |
| `rgba(96,165,250,0.15)` | 부산·충북·전남·제주 |
| `rgba(167,139,250,0.15)` | 대구·울산·전북 |
| `rgba(52,211,153,0.15)` | 인천·충남·경북 |
| `rgba(251,191,36,0.15)` | 광주·대전·경기 |

지도 컨테이너 배경: `bg-[#e8edf2]`

### 노선 색상 (system_settings에서 커스터마이징 가능)

| 구분 | 기본값 |
|---|---|
| 고속선 | `#dc2626` |
| 일반선 전철화 | `#f97316` |
| 일반선 비전철 | `#9ca3af` |
| 전차선단전 오버레이 | `#16a34a` |
| 선로차단 | `#ca8a04` |

### 차단 배지 색상

| 항목 | 배경/텍스트 |
|---|---|
| 상선 계열 | `bg-blue-100 / text-blue-700` |
| 하선 계열 | `bg-orange-100 / text-orange-700` |
| 시설 분야 | `bg-indigo-100 / text-indigo-700` |
| 전기 분야 | `bg-yellow-100 / text-yellow-700` |
| 건축 분야 | `bg-emerald-100 / text-emerald-700` |

---

## 기준정보 관리 — 노선 목록+검색 패턴

**노선원장, 역/KP 관리, 시설물 관리** 모두 동일한 2단계 UX 패턴:

```
[1단계] 노선 목록 (검색 + 집계 배지)
  - 검색: 노선명·코드·시종점 텍스트
  - 필터: 고속선/일반선/기지, 오류 있는 노선만
  - 배지: 역 수, GPS 수, 오류 수 (역/KP), 시설물 수 (시설물)
  - 클릭 → 2단계

[2단계] 노선 상세 (기존 상세 화면)
  - 뒤로가기(← 목록) 버튼으로 1단계 복귀
  - 역/KP: 역 목록 + 검증 필터 + KP 편집
  - 시설물: 시설물 목록 + CRUD + CSV 업로드
```

**⚠️ `rail_route_station_points`에 lat/lon 없음** → GPS 집계는 `rail_stations` JOIN 필요

## 역할별 메뉴

| 메뉴 | 경로 | user | org_admin | superuser |
|---|---|---|---|---|
| 차단현황도 | `/block-map` | ✅ | ✅ | ✅ |
| 차단명령 | `/block-orders` | ✅ | ✅ | ✅ |
| 캘린더 | `/calendar` | ✅ | ✅ | ✅ |
| 기준정보 관리 | `/admin/reference` | ❌ | ✅ | ✅ |
| 시스템 관리 | — | ❌ | ❌ | ✅ |
| └ 사용자 관리 | `/admin/users` | ❌ | ❌ | ✅ |
| └ 시스템 설정 | `/admin/settings` | ❌ | ❌ | ✅ |

---

## 공통 컴포넌트 패턴

### 테이블
```
border rounded-lg overflow-auto
헤더: bg-gray-50 sticky top-0, text-xs font-medium text-gray-500
행: border-b hover:bg-gray-50 transition-colors
```

### 입력 컨트롤
```
select: h-9 border rounded-lg pl-3 pr-8 text-sm focus:ring-2 focus:ring-blue-400
input[date]: h-9 border rounded-lg px-3 text-sm
```

### 버튼

| 종류 | 클래스 |
|---|---|
| 주 액션 | `px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700` |
| 보조(수정) | `text-xs text-blue-600 hover:underline` |
| 위험(삭제) | `text-xs text-red-500 hover:underline` |
| 아웃라인 | `px-2 py-1 text-xs rounded border border-gray-300` |

### 피드백 배너
```tsx
성공: bg-green-50 text-green-700 border-green-200
오류: bg-red-50 text-red-700 border-red-200
경고: bg-yellow-50 text-yellow-700
정보: bg-blue-50 text-blue-700
```

---

## 차단작업 노선도 표시 원칙

| block_type | 위치 | 방법 |
|---|---|---|
| `전차선단전` | 노선 위 직접 | 녹색 실선 (가장 긴 구간) |
| `선로차단` | 노선 위 직접 | 노란 실선, 두께=노선의 2배 |
| `작업구간설정` | 최외방 선로 +0.5×gap 외방 | 노란 실선 (차단 없는 작업) |
| `보호지구작업` | 최외방 선로 +1.0×gap 외방 | 사각형+45도 해칭 (높이=2×gap) |

**선 끝**: `stroke-linecap='butt'` — KP 범위와 정확히 일치하는 직사각형 처리

### 분야 마커 (◆)

| 분야 | 색상 |
|---|---|
| 시설 | `#ca8a04` 노란 |
| 전기 | `#16a34a` 녹색 |
| 건축 | `#7c3aed` 보라 |

- 위치: 해당 선로에서 1.0×TRACK_HALF_GAP 외방
- 크기: s=10 (미선택), s=14 (선택)

---

## 차단현황도 (BlockMapPage) 인터랙션

- **배지 클릭** (zoom<1.5) → zoom=2.5로 해당 노선 fly-to (700ms)
- **선분 클릭** → 사이드바 선택 + 상세 패널 표시
- **같은 doc_no** → 사업 묶음으로 강조 (나머지 opacity×0.25)
- **선택된 건의 ±45일** → 연속작업 시리즈 자동 감지
- **fly-to** → `zoomRef.current.transform` + `d3.easeCubicInOut` 700ms

---

## 시스템 설정 (SystemSettingsPage)

- 색상 설정: color picker + hex input, 저장 후 새로고침 시 지도 반영
- 역 좌표 모드: 라디오 버튼 (center_only / all_points)
- 선 두께 포화 배율: 슬라이더 (2~20, 기본 5), 실시간 px 미리보기
