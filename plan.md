# 개발 계획 (plan.md)

> 프로젝트: 선로차단작업 관리 프로그램 (Track-Block-Management)  
> 마지막 갱신: 2026-06-02 (Phase H 완료)

---

## Phase 완료 현황

| Phase | 주요 내용 | 상태 |
|---|---|---|
| **Phase 1** | DB 스키마, 권한·조직, 노선도 geometry, 차단명령 CRUD, PDF 파싱, 시설물 관리 | ✅ 완료 |
| **Phase A~C+** | rail_computed_geometry 구축, 노선 커버리지 확대 (77노선) | ✅ 완료 |
| **Phase D~D+** | 기지 차단작업, rail_facilities 지도 표시, geometry 자동 재계산 | ✅ 완료 |
| **Phase E** | 위험등급 분류·시각화, 차단현황도 인터랙션 | ✅ 완료 |
| **Phase F** | 노선 색상 체계, 선로 구성(복선·단선), 전차선 유무, 작업형태·시행주체 | ✅ 완료 |
| **Phase G** | 터널·교량 심볼, 다중 레인 차단구간, fly-to 포커스 | ✅ 완료 |
| **Phase H** | 시스템 설정(색상 관리), 사업건별 지도 강조, 연속 작업 감지 | ✅ 완료 |

---

## Phase H 완료 내역 (2026-06-02)

### 1. 시스템 설정 (System Settings) ✅

**목적**: 지도에 표시되는 색상을 DB에 저장하여 관리자가 UI에서 직접 변경

**DB**: `system_settings` 테이블 (Alembic `tc04_system_settings`)
```
category / key / value / default_value / label / description / sort_order
카테고리: route_colors | block_colors | danger_colors | facility_colors
```

**초기 색상 시드 (22개)**:
- route_colors: highway, electrified, non_electrified, catenary_cut
- block_colors: track_block, danger_zone
- danger_colors: level_a, level_b, level_c, none
- facility_colors: station_master, station_general, ... (12개)

**백엔드 API** (`/api/v1/settings`):
- `GET /settings` — 전체 조회
- `PATCH /settings/{category}/{key}` — 값 변경 (superuser)
- `POST /settings/{category}/{key}/reset` — 단일 기본값 복원
- `POST /settings/reset-all` — 전체 기본값 복원

**프론트엔드**:
- `src/store/settingsStore.ts` — Zustand 전역 상태 (앱 시작 시 로드)
- `src/api/settings.ts` — API 클라이언트
- `src/pages/SystemSettingsPage.tsx` — 색상 피커 UI (superuser 전용)

**색상 적용 방식**: 새로고침 후 반영 (settingsStore → D3 rendering)
- RailwayMap.tsx의 하드코딩 색상 상수 → settingsStore 파생값으로 교체
- `TRACK_BLOCK_COLOR_S`, `CATENARY_CUT_COLOR_S`, `DANGER_MARKER_COLORS_S` 등

### 2. 메뉴 구조 변경 ✅

```
변경 전: [사용자 관리] (superuser 단일 메뉴)
변경 후: [시스템 관리 ▼] (드롭다운)
          ├─ 사용자 관리  (/admin/users)
          └─ 시스템 설정 (/admin/settings)
```

### 3. 사업건별 지도 강조 ✅

**같은 doc_no = 같은 사업 묶음** 시각화:
- 차단명령 카드 클릭 → 같은 doc_no 건들은 밝게, 나머지는 opacity × 0.25로 흐리게
- `RailwayMap`에 `highlightedBlockIds?: Set<number>` prop 추가
- 상세 패널에 "📋 사업 묶음 문서 XXX — N건" 표시

### 4. 연속 작업 감지 ✅

**±45일 확장 쿼리**로 같은 노선·방향·구간·분야의 연속 날짜 자동 탐지:
- 상세 패널에 "📅 연속 작업 YYYY-MM-DD ~ YYYY-MM-DD  [N일]" 표시
- 선택된 건이 있을 때만 확장 쿼리 실행 (`enabled: !!selectedId`)

### 5. 차단명령 목록 문서번호 필터 ✅

- BlockOrdersPage에 `doc_no` 텍스트 검색 입력란 추가
- 같은 사업 문서의 날짜별 전체 건 조회 가능

### 6. 기타 버그 수정 ✅

- **팝업 닫기 버튼**: `data-panel-close` 속성으로 드래그 핸들러에서 완전 분리
  - 이전: 헤더 전체 `onMouseDown`에 drag 핸들러 → 닫기 버튼 click 간섭
  - 수정: `closest('[data-panel-close]')` 체크로 닫기 버튼 영역 제외
- **선로수 옵션 레이블**: `"N선 — 이름"` → `"이름 (N선)"` 형식으로 통일

---

## 현재 운영 환경

| 항목 | 값 |
|---|---|
| 백엔드 포트 | 7000 |
| 프론트엔드 포트 | 7001 |
| DB | `backend/db.sqlite3` (SQLite) |
| 노선 수 | 156개 (본선 143 + 기지 13) |
| Baseline 보유 노선 | 77개 |
| Computed geometry | 77개 노선, 16,295점 |
| 시스템 설정 항목 | 22개 색상 설정 |

---

## Alembic 마이그레이션 이력

| revision | 내용 |
|---|---|
| `tc01_rail_track_sections` | rail_routes 선로수·전차선 + rail_track_sections 테이블 |
| `tc02_work_type_implementer` | block_orders.work_type + implementer |
| `tc03_bore_type` | rail_facilities.bore_type (터널·교량 선로 적용 방식) |
| `tc04_system_settings` | system_settings 테이블 + 22개 색상 시드 |

---

## 향후 개발 계획

| Phase | 주요 내용 | 우선도 |
|---|---|---|
| **Phase I** | 선로차단 ON-TRACK 직접 표시, 선로변 작업 오프셋 분리 | 높음 |
| **Phase J** | 노선 hover/click → 노선 정보 팝업 | 중 |
| **Phase K** | 시설물 아이콘 이미지 교체 (Phase 2 예정) | 낮음 |
| Phase 2 | PostgreSQL 전환, LOD 자동 전환 | 높음 |
| Phase 3 | 통계 대시보드, 모바일 반응형 | 중 |
| Phase 4 | Linux 서버 이전, 알림·보고서 기능 | 낮음 |
