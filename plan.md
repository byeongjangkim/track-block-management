# 개발 계획

> 마지막 갱신: 2026-06-05 (PostgreSQL 전환 완료)

---

## 현재 완료 상태

| 구분 | 내용 |
|---|---|
| **DB** | PostgreSQL 16 전환 완료 (SQLite → pg 22,438건 이전) |
| DB 스키마 | tc01~tc09 마이그레이션 완료 |
| 권한/조직 | 14개 조직, 3단계 role, sort_order 정렬, 관할구간 검증 |
| 차단명령 CRUD | 등록/수정/삭제, PDF 일괄 파싱, 연속작업 감지 |
| 차단명령 확장 | 대표명령 계층(parent_id), T1~T8 고속선 선로, 투입장비, 열차서행, 양단접지, ZEP/ZCP/CPT/TZEP, 작업자 수 |
| 지도 렌더링 | SVG 월드 단위, station_points_mode, strokeCapZoom, 노선 필터 하이라이트 |
| 시설물 | rail_facilities 지도 표시, 터널/교량 심볼 |
| 시스템 설정 | 색상 22개 + map_settings 2개 |
| 선로 모델 | tracks JSON (상선/하선/상1~하3/T1~T8) |
| 차단작업 표시 | 선로차단·작업구간설정·보호지구작업·전차선단전·분야 마커 |
| 기준정보 관리 | 역/KP 인라인 수정, 지역본부 담당구역 155개 노선 검색형 셀렉터 |
| 노선 정리 | 수서평택고속선(H3) 명칭 변경, 동해선(경주-영덕/8B) 삭제, 서해선+서해남부선 통합 |
| 관할구역 | org_route_ranges → rail_route_id 전환, 조직 sort_order, HQ 역 기준 뷰포트 |

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
| Alembic 버전 | tc09_block_order_parent |

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

---

## 미구현 / 예정

### 우선 검토 필요
- **Ubuntu 서버 배포** — pg_dump 기준데이터 + Alembic 마이그레이션 배포 절차 수립
- **노선 KP 다이어그램 뷰** — 단일 노선 KP 축 기반 차단현황 시각화 (x=KP, y=시간/선로)

### 향후 개선 검토
- **대표명령 UI** — 차단명령 목록에서 대표명령/하위작업 계층 시각화
- **투입 장비 심볼** — 노선도에 장비 위치 표시
- **기준정보 관리 — 시설물 탭** — FacilitiesAdminPage 2단계 뷰 (현재 1단계)

### 추후 구현
- 기지 노선 선로 다중 선택
- 차단명령 PDF 자동 주기 파싱/알림
- 모바일 반응형 (Phase 3)

---

## 주요 아키텍처 결정 이력

### PostgreSQL 전환 (2026-06-05)
- **결정**: SQLite → PostgreSQL 16 (Homebrew)
- **근거**: 개발 초기 단계에서 전환하는 것이 이후 마이그레이션보다 효율적
- **방법**: `Base.metadata.create_all(engine)` + `alembic stamp head` + 데이터 이전 스크립트
- **주의**: Boolean 컬럼 비교는 `= TRUE` (SQLite `= 1` 불가), SERIAL 시퀀스 갱신 필수
- **배포 전략**: pg_dump 선별 덤프(기준데이터) + Alembic 마이그레이션(스키마) + seed 스크립트(사용자)

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

### SVG 월드 단위 렌더링 (2026-06-03)
- **결정**: 모든 railway 요소를 SVG world unit으로 표현, non-scaling-stroke 제거
- **strokeCapZoom**: k≤capZoom 자연 성장, k>capZoom 픽셀 고정 (기본 5, 설정 가능)
- **⚠️ 주의**: capStrokeSvg를 zoom handler AND 각 useEffect 양쪽 적용 필수

### station_points_mode (2026-06-03)
- **결정**: center_only(기본) / all_points
- **⚠️ 주의**: facility_start/end는 center_only에서도 포함 필수
- **⚠️ 주의**: 노선 렌더링과 KP 보간이 동일 앵커 사용 — 불일치 시 차단구간 이탈

### 차단작업 표시 원칙 (2026-06-03)
- 선로차단: 노선 위 직접, 노란 실선, `stroke-linecap=butt`
- 작업구간설정: 최외방 +0.5×gap 외방
- 보호지구작업: 최외방 +1.0×gap 외방, 사각형+해칭
- 분야 마커: 시설=노란, 전기=녹색, 건축=보라, 1.0×gap 위치

### 노선 필터 하이라이트 (2026-06-04)
- **결정**: 노선 선택 시 해당 노선 강조, 나머지 opacity 0.15
- **구현**: TrackPath에 routeName 추가, `_updateFacilityVisibility`에서 opacity 갱신
