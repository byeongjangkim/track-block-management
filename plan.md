# 개발 계획

> 마지막 갱신: 2026-06-08 (4-role 체계 도입 · PDF 일괄등록 조직 자동감지 · 개발 계정 비밀번호 통일)

---

## 개발 환경 접속 계정

> 아래 계정은 **개발/테스트 전용**입니다. 프로덕션 배포 전 반드시 변경하세요.

| 역할 | 아이디 | 비밀번호 | 용도 |
|---|---|---|---|
| 시스템 관리자 (`system_superuser`) | `admin@korail.com` | `korail7788!` | 사용자·시스템 설정 관리 (차단명령 등록 불가) |
| 차단명령 관리자 (`block_manager`) | `block_manager` | `korail7788!` | 전국 차단명령 등록·수정 (조직 제한 없음) |

---

## 현재 완료 상태

| 구분 | 내용 |
|---|---|
| **DB** | PostgreSQL 16 (`track_block`) |
| DB 스키마 | tc01~tc16 마이그레이션 완료 |
| **권한 체계** | 4-role 체계 (system_superuser / block_manager / org_admin / user) |
| 사용자 관리 | system_superuser: 전체; org_admin: 소속 org_admin+user 관리 |
| can_register | user 역할에 등록 권한 플래그 (tc14) |
| 차단명령 CRUD | 등록/수정/삭제, PDF 일괄 파싱, 연속작업 감지 |
| **PDF 일괄등록** | 노선+KP+분야로 담당 조직 자동 감지 → 행별 조직 배정 (전국 다중 조직 지원) |
| 차단명령 확장 | 대표명령 계층(parent_id), T1~T8 고속선 선로, 투입장비, 열차서행, 양단접지, ZEP/ZCP/CPT/TZEP, 작업자 수 |
| 차단명령 확장 2 | 승인원문 PDF(block_order_documents) · 열차감시원 복수(block_order_monitors) · 승인일자/사업명/차단방법/시공사전화/역명 · 작업내용 |
| 공사/사업 관리 | projects 테이블 신설, block_orders.project_id FK, 사업명 검색·등록 UI |
| 지도 렌더링 | SVG 월드 단위, station_points_mode, strokeCapZoom, 노선 필터 하이라이트 |
| 시설물 | rail_facilities 지도 표시, 터널/교량 심볼 |
| 시스템 설정 | 색상 22개 + map_settings 2개 |
| 선로 모델 | tracks JSON (상선/하선/상1~하3/T1~T8) |
| 차단작업 표시 | 선로차단·작업구간설정·보호지구작업·전차선단전·분야 마커 |
| 기준정보 관리 | 역/KP 인라인 수정, 지역본부 담당구역 155개 노선 검색형 셀렉터 |
| 노선 정리 | 수서평택고속선(H3) 명칭 변경, 동해선(경주-영덕/8B) 삭제, 서해선+서해남부선 통합 |
| 관할구역 | org_route_ranges → rail_route_id 전환, 조직 sort_order, HQ 역 기준 뷰포트 |
| 지도 렌더링 개선 | TRACK_HALF_GAP_SVG 0.5, 복선 분리 k≥3, routeStrokeWidthSvg 동적 선 두께, 색상 설정 즉시 반영 |
| 기준정보 자동 동기화 | 역/KP 관리 저장 시 rail_baseline_points station_center 자동 UPSERT + geometry 재계산 |
| 전기시설물 오프셋 표시 | GPS 방향 벡터 기반 facilityOffsetPoint — 최외방 선로 1간격 외방 배치, 2복선·3복선 getTrackCountAtKp 적용, 레이블 name+station_type 대문자 표시 |
| **차단명령 등록 폼 전면 개선** | 5개 섹션(기본정보·작업구간및일시·투입장비·작업관계자·안전관리), 인라인 1행 레이아웃, SearchableSelect(노선·변전소), 작업선로 단순 버튼, 전차선단전 상시 표시 |
| **역구내 route type 추가** | routeType: 'line'\|'yard'\|'depot' (역간/역구내/기지 3선택), 역구내 선택 시 역/구역명 텍스트입력 + TrackMultiSelect, KP 선택사항 |
| **전차선 단전 KP 범위 수정** | `_rail_kp_range_coords` context anchor `kp <= start` → `kp < start` (시작점 자신이 context로 들어가 렌더링에서 소실되는 버그 수정) |
| **T번호 상하선 판정 수정** | `isUpTrack`/`trackNameToIndex`에 T-트랙 처리 추가 — T1·T3 하선, T2·T4 상선, 중심→외측 배치 |
| **팝업 전차선 단전 표시** | 블록 상세팝업에 `전차선 단전` 행 추가 (start_rail_facility_id 있는 경우, 초록색) |

---

## 현재 운영 환경

| 항목 | 값 |
|---|---|
| 서버 | MacBook M2 14 (arm64, macOS 15, 사내망 LAN) |
| Python | 3.12 / Node.js 22 |
| 백엔드 포트 | 7000 |
| 프론트엔드 포트 | 7001 |
| **DB** | **PostgreSQL 16 (`track_block`)** |
| 활성 노선 수 | 153개 |
| 역/KP 포인트 | 1,066개 |
| 시스템 설정 항목 | 24개 |
| Alembic 버전 | tc16_dev_accounts_pw |

---

## Alembic 마이그레이션 이력

| revision | 내용 |
|---|---|
| `tc01` | rail_routes.default_track_count/has_catenary + rail_track_sections |
| `tc02` | block_orders.work_type + implementer |
| `tc03` | rail_facilities.bore_type |
| `tc04` | system_settings 테이블 + 색상 시드 24건 |
| `tc05` | direction → tracks TEXT(JSON), 단선차단→선로차단 통합 |
| `tc06` | organization_route_ranges: route_id(legacy 53개) → rail_route_id(155개) |
| `tc07` | organizations.sort_order 추가 (서울→수도권서부→…→고속전기 순서) |
| `tc08` | block_orders: catenary_protection / ZEP·ZCP·CPT·TZEP / worker_count |
| `tc09` | block_orders: parent_id / equipment_name / speed_restriction |
| `tc10` | rail_facility_management_offices.region_name 컬럼 제거 |
| `tc11` | block_order_documents(PDF BYTEA) · block_order_monitors(열차감시원 복수) · block_orders: document_id / project_name / approved_date / block_method / contractor_phone |
| `tc12` | block_orders: start_station_name / end_station_name (차단구간 시작·종료역명) |
| `tc13` | projects 테이블 신설 · block_orders.project_id FK · GET/POST /api/v1/projects/ |
| `tc14` | users.can_register BOOLEAN 추가 · 기존 org_admin → can_register=TRUE |
| `tc15` | block_manager 역할 추가 · block_manager 기본 계정 생성 |
| `tc16` | 개발 계정 비밀번호 통일 (admin@korail.com, block_manager → korail7788!) |

---

## 사용자 역할(Role) 체계

| role | 이름 | 차단명령 | 조직 제한 | 사용자 관리 | 시스템 설정 |
|---|---|---|---|---|---|
| `system_superuser` | 시스템 관리자 | **불가** | 없음 | 전체 | ✓ |
| `block_manager` | 차단명령 관리자 | ✓ (전국) | **없음** | 불가 | ✗ |
| `org_admin` | 소속 관리자 | ✓ (관할구간) | 자기 조직 | 소속 org_admin·user | ✗ |
| `user` | 소속 사용자 | can_register 여부 | 자기 조직 | 불가 | ✗ |

### block_manager 특이사항

- `organization_id = NULL` (어느 조직에도 소속되지 않음)
- 차단명령 등록 시 `block_orders.organization_id`는 행별 자동 감지 또는 수동 지정
- PDF 일괄 등록: `bulk-parse` 응답의 각 행에 `organization_id`/`organization_name` 자동 포함
  - 자동감지 기준: `organization_route_ranges` (rail_route_id + start_km + field 매칭)
  - 감지 우선순위: 분야 일치 → `'all'` 범위
  - 감지 실패 행: Step 2 테이블에서 빨간 셀로 표시, 직접 선택 필요
- `can_register = TRUE` 고정

### PDF 일괄등록 프로세스 (block_manager)

```
Step 1: 파일 선택 (시행문 PDF / 세부내역 PDF)
        → 조직 선택 없음 (이 단계에서 조직 결정 불필요)

Step 2: 파싱 결과 확인
        → 각 행에 "등록 조직" 컬럼 표시
        → 노선+KP 기준 자동 감지된 조직 드롭다운에 표시
        → 감지 실패(빨간 셀): 직접 선택 필요
        → 조직 미지정 행 있으면 저장 버튼 비활성화

Step 3: 저장 결과 확인
```

---

## 미구현 / 예정

### 우선 검토 필요
- **Ubuntu 서버 배포** — pg_dump 기준데이터 + Alembic 마이그레이션 배포 절차 수립
- **노선 KP 다이어그램 뷰** — 단일 노선 KP 축 기반 차단현황 시각화 (x=KP, y=시간/선로)

### 향후 개선 검토
- **대표명령 UI** — 차단명령 목록에서 대표명령/하위작업 계층 시각화
- **투입 장비 심볼** — 노선도에 장비 위치 표시
- **기준정보 관리 — 시설물 탭** — FacilitiesAdminPage 2단계 뷰 (현재 1단계)
- **block_type 통일** — `'보호지구 작업'`(폼) ↔ `'보호지구작업'`(렌더링) 공백 불일치 해소
- **열차사이 차단** — VALID_BLOCK_TYPES 및 렌더링 규칙 추가 필요

### 추후 구현
- 기지 노선 선로 다중 선택
- 차단명령 PDF 자동 주기 파싱/알림
- 모바일 반응형 (Phase 3)

---

## 주요 아키텍처 결정 이력

### 4-role 체계 도입 (2026-06-08, tc14/tc15)

- **결정**: 기존 3-role(system_superuser / org_admin / user) → 4-role (block_manager 신설)
- **근거**: system_superuser가 차단명령 등록·전국 PDF 일괄등록을 겸하는 구조는 역할 분리 원칙 위반
  - system_superuser: 시스템 관리 전용 (차단명령 등록 불가)
  - block_manager: 전국 차단명령 등록·관리 전용 (조직 소속 없음)
- **DB 변경**: `users.can_register BOOLEAN` 추가 (tc14), block_manager 계정 생성 (tc15)
- **프론트 변경**: 역할별 메뉴·버튼 가시성, UsersAdminPage 4-role 지원

### PDF 일괄등록 조직 자동감지 (2026-06-08)

- **결정**: block_manager의 PDF 일괄등록 시 Step 1에서 단일 조직 선택 → 폐기
- **근거**: 시행문서 한 장에 전국 여러 조직 관할 구간의 차단명령이 혼재 가능
- **구현**:
  - `bulk-parse` 엔드포인트에 DB 조회 추가: 파싱 후 각 행에 `organization_id`/`organization_name` 주입
  - 조회 기준: `organization_route_ranges` 테이블 (rail_route_id + start_km + field)
  - Step 2 테이블에 "등록 조직" 컬럼 추가, 자동감지값 표시, 수정 가능
  - 저장 시 행별 `organization_id` 전송 (기존: 전체 공용 1개)
- **주의**: `organization_route_ranges.field = 'all'`인 행정 경계는 모든 분야에 매칭됨 (우선순위 낮음)

### DB: PostgreSQL 16 (2026-06-05)
- **결정**: PostgreSQL 16 (Homebrew) 단독 운영
- **마이그레이션**: tc01~tc09 → `v1_initial_schema` 단일 파일로 통합
- **Boolean**: 컬럼 비교는 반드시 `= TRUE` / `= FALSE`
- **배포 전략**: `dump_reference_data.sh` + `restore_reference_data.sh` + seed 스크립트 3개

### 고속선 선로 번호 체계 (2026-06-05, tc09)
- **결정**: T1~T8 선로명 추가 (기존 상선/하선/상1~하3에 추가)
- **매핑**: T1(하1)·T3(하2)·T5(하3)·T7(하4) / T2(상1)·T4(상2)·T6(상3)·T8(상4)
- **근거**: 고속선 선로 중심에서 외측으로 홀수=하선, 짝수=상선

### 대표명령 계층 (2026-06-05, tc09)
- **결정**: `block_orders.parent_id` 자기참조 FK
- **구조**: parent_id=NULL → 대표명령(작업계획), parent_id=N → 하위작업(선로차단/전차선단전 등)
- **API**: `GET /block-orders/{id}/children` 하위작업 목록 조회
- **블록타입**: '대표명령' 추가 → VALID_BLOCK_TYPES 에 포함

### 차단명령 확장 필드 (2026-06-05, tc08/tc09)
- **전차선 보호장치**: catenary_protection (양단접지/단접지) — 고속선·일반선 공통
- **관제사 보호조치**: ZEP, ZCP — 고속선 전용 코드
- **작업자 보호조치**: CPT, TZEP — 고속선 전용 코드
- **기타**: equipment_name(투입장비), speed_restriction(열차서행), worker_count(작업자 수)

### 지역본부 관할구역 전환 (2026-06-04, tc06)
- **결정**: organization_route_ranges.route_id(legacy routes, 53개) → rail_route_id(rail_routes, 153개)
- **근거**: 기존 53개 노선만 선택 가능 → 155개 전체 노선으로 확대
- **프론트**: `RouteSearchSelect` 검색형 드롭다운 컴포넌트, 가나다 정렬

### 조직 sort_order (2026-06-04, tc07)
- **순서**: 서울→수도권서부→수도권동부→강원→충북→대전충남→전북→광주→전남→경북→대구→부산경남→고속시설→고속전기
- **적용**: `GET /organizations` API가 sort_order, id 순 반환

### 선로 간격·두께 체계 (2026-06-07)
- **TRACK_HALF_GAP_SVG**: 1.0 → **0.5** (복선 상하선 중심간격 = 1.0×k px)
- **복선 분리 시작**: `showMultiTrack = k >= 3` (전국 조망 k<3에서 단일 중심선)
- **노선 선 두께**: `routeStrokeWidthSvg(k) = min(1.6, 0.4+0.2k)/k` (capStrokeSvg 미적용)
  - k=2: 0.8px | k=3: 1.0px | k=4: 1.2px | k=5: 1.4px | k≥6: 1.6px 고정
- **색상 설정 반영**: `routeColors`를 useEffect 의존성 배열에 추가 — 설정 로드 후 즉시 반영

### SVG 월드 단위 렌더링 (2026-06-03)
- **결정**: 모든 railway 요소를 SVG world unit으로 표현, non-scaling-stroke 제거
- **strokeCapZoom**: k≤capZoom 자연 성장, k>capZoom 픽셀 고정 (기본 5, 설정 가능)
- **⚠️ 주의**: capStrokeSvg를 zoom handler AND 각 useEffect 양쪽 적용 필수
- **⚠️ 노선 선로 예외**: `routeStrokeWidthSvg(k)` 사용, capStrokeSvg 미적용

### station_points_mode (2026-06-03)
- **결정**: center_only(기본) / all_points
- **⚠️ 주의**: facility_start/end는 center_only에서도 포함 필수
- **⚠️ 주의**: 노선 렌더링과 KP 보간이 동일 앵커 사용 — 불일치 시 차단구간 이탈

### rail_baseline_points 자동 동기화 (2026-06-07)
- **결정**: 역/KP 관리에서 GPS+KP+is_baseline_anchor=True 저장 시 station_center 자동 UPSERT
- **구현**: `update_station_point()` 내 UPSERT/재정렬/geometry 재계산 일괄 처리
- **근거**: 기존 코드는 rail_route_station_points 저장 후 rail_baseline_points에 미반영 → 노선도 미표시
- **동작**: INSERT(없을 때) / UPDATE(있을 때) / 플래그 해제(anchor=False) → seq 재정렬 → geometry 재계산

### 차단작업 표시 원칙 (2026-06-03)
- 선로차단: 노선 위 직접, 노란 실선, `stroke-linecap=butt`
- 작업구간설정: 최외방 +0.5×gap 외방
- 보호지구작업: 최외방 +1.0×gap 외방, 사각형+해칭
- 분야 마커: 시설=노란, 전기=녹색, 건축=보라, 1.0×gap 위치

### 노선 필터 하이라이트 (2026-06-04)
- **결정**: 노선 선택 시 해당 노선 강조, 나머지 opacity 0.15
- **구현**: TrackPath에 routeName 추가, `_updateFacilityVisibility`에서 opacity 갱신

### 공사/사업(projects) 테이블 신설 (2026-06-07, tc13)
- **결정**: block_orders에 직접 기입하던 project_name을 별도 테이블로 분리
- **구조**: projects(id, name, project_type, implementer, status 등) ← block_orders.project_id FK (ON DELETE SET NULL)
- **API**: `GET /api/v1/projects/`, `POST /api/v1/projects/`, `GET /api/v1/projects/lookup/by-name`
- **⚠️ 주의**: FastAPI 라우터에서 `/lookup/by-name`(static)은 반드시 `/{project_id}`(parameterized) 앞에 등록

### 차단명령 등록 폼 전면 개선 (2026-06-07)
- **5개 섹션**: 기본정보 / 작업구간및일시 / 투입장비 / 작업관계자 / 안전관리
- **인라인 레이아웃**: `[라벨][입력창]` 1행 배치로 세로 높이 최소화 (Row/L/SI 헬퍼 패턴)
- **SearchableSelect**: 노선·변전소 등 항목이 많은 셀렉터에 텍스트 검색 기본 적용 (드롭다운 보조)
- **BLOCK_TYPES 변경**: `['선로차단', '선로일시사용중지', '열차사이 차단', '보호지구 작업']`
  - ⚠️ `'보호지구 작업'`(공백 포함) ↔ 렌더링 코드 `'보호지구작업'`(공백 없음) 불일치 → 추후 통일 필요
  - ⚠️ `'열차사이 차단'`은 백엔드 VALID_BLOCK_TYPES 및 렌더링 규칙에 없는 신규 값 → 추후 추가 필요
- **작업선로**: 일반선 역간 = [상선][하선][상하선] 버튼, 역구내·고속선·2복선+ = TrackMultiSelect
- **전차선 단전**: 역간·역구내·기지 모두 표시, 노선 선택 시 변전소 목록 자동 로드

### 역구내 route type 추가 (2026-06-08)
- **결정**: `RouteType = 'line' | 'yard' | 'depot'` (역간/역구내/기지)
- **역구내 UI**: 역/구역명 텍스트입력 + TrackMultiSelect 다중선택 + KP 선택사항 (없으면 지도 미표시)
- **저장**: `route_id` 유지 (노선 소속), `track_name` = 역/구역명, `tracks` = 선택 선로
- **기존 데이터 감지**: `track_name && route_id` → 역구내, `rail_route_id && !route_id` → 기지

### 전차선 단전 KP 범위 버그 수정 (2026-06-08)
- **원인**: `_rail_kp_range_coords`에서 context anchor 조건 `kp <= start` → 시작 KP가 정확히 anchor와 일치하면 anchor 자체가 context로 등록 → frontend `buildOffsetPath` slice(1,-1) 처리 시 실제 시작점 소실
- **수정**: `kp < start` (strictly less than) — context anchor는 반드시 시작점 직전 anchor
- **영향**: 모든 block type(선로차단·전차선단전 등)에 동일 적용

### T번호 상하선 판정 수정 (2026-06-08)
- **원인**: `isUpTrack` 함수가 'T'로 시작하는 이름을 처리하지 못해 T2(상1)가 하선으로 판정 → T1, T2 모두 동일 하선 위치에 겹쳐 렌더링
- **수정**: `isUpTrack`: T-트랙이면 짝수=상선(true), 홀수=하선(false)
- **수정**: `trackNameToIndex`: T번호→배열 인덱스 공식 = 상선 `half-pos`, 하선 `half+pos-1` (half=trackCount/2, pos=ceil(n/2))
- **검증**: T1(tc=2)→idx1(하선✓), T2(tc=2)→idx0(상선✓), T1(tc=4)→idx2(하1✓), T4(tc=4)→idx0(상2✓)
