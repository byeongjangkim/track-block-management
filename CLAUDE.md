# 선로차단작업 관리 프로그램

한국철도공사(KORAIL) 전국 선로차단작업 승인 내역을 통합 관리하는 웹 기반 프로그램.
12개 지역본부 + 2개 사업단(고속시설·고속전기), 전국 51개 노선을 단일 시스템에서 관리한다.

---

## 문서 구조 정책

> **이 파일(루트 CLAUDE.md)은 프로젝트 전체 개요와 도메인 핵심 개념만 다룬다.**
> 구현 세부사항(API, 스키마, 컴포넌트, GIS 파이프라인 등)은 각 파트 문서에 위임한다.
>
> - **코드 수정 후 문서 업데이트:** 해당 파트의 CLAUDE.md만 수정한다. 루트는 건드리지 않는다.
> - **루트 CLAUDE.md 업데이트:** 프로젝트 전체에 영향을 주는 변경(Phase 전환, 조직 추가, 도메인 개념 변경)이 있을 때만 수정한다.

---

## 개발/운영 환경

- **서버:** MacBook M2 14 (arm64, macOS 15, 사내망 LAN 연결)
- **개발 도구:** Claude Code + VSCode
- **Python:** 3.12 · **Node.js:** 22 · **패키지 관리:** Homebrew · **Docker:** 미사용

---

## 프로젝트 구조

```
track-block-management/
├── backend/        ← FastAPI API 서버          → backend/CLAUDE.md
├── frontend/       ← React SPA                → frontend/CLAUDE.md, frontend/UI_UX.md
├── maps/           ← GIS 파이프라인            → maps/CLAUDE.md, maps/ROUTE_MANAGEMENT.md
├── database/       ← DB 스키마·시드 데이터     → database/CLAUDE.md
├── scripts/        ← 유틸리티 스크립트         → scripts/CLAUDE.md
└── docs/           ← 기타 문서
```

---

## 기술 스택 (요약)

| 구분 | Phase 1 (현재, SQLite) | Phase 2+ (운영, PostgreSQL) |
|---|---|---|
| 백엔드 | FastAPI + Uvicorn | 동일 |
| 프론트엔드 | React 18 + TypeScript + Vite + D3.js v7 | 빌드 후 Nginx/Caddy 정적 서빙 |
| 데이터베이스 | SQLite (파일 기반) | PostgreSQL 15 |
| 인증 | JWT (python-jose + passlib) | 동일 |
| 노선도 GIS | route_geometry 테이블 (DB SOT) | 동일 |
| 리버스 프록시 | 없음 (직접 포트 접속) | Caddy 또는 Nginx |

> 라이브러리 버전, 서버 실행 명령, 환경변수 → [backend/CLAUDE.md](backend/CLAUDE.md), [frontend/CLAUDE.md](frontend/CLAUDE.md)

---

## 로컬 서비스 포트

| 서비스 | 포트 |
|---|---|
| 백엔드 API | 8000 |
| 프론트엔드 | 5173 |

> 실행 명령 → [backend/CLAUDE.md](backend/CLAUDE.md) · [frontend/CLAUDE.md](frontend/CLAUDE.md)

---

## 개발 단계 (Phase)

| Phase | 주요 내용 | DB | 상태 |
|---|---|---|---|
| Phase 1 | DB 스키마, 권한, 노선도 geometry, 차단명령 CRUD | SQLite | **진행 중** |
| Phase 2 | 관할구간 km 슬라이싱, LOD 자동 전환, PostgreSQL 전환 | PostgreSQL | 대기 |
| Phase 3 | 역구내 배선도, 통계, 모바일 | PostgreSQL | 대기 |
| Phase 4 | Linux 서버 이전, 알림, 보고서 | PostgreSQL | 검토 |

---

## 도메인 핵심 개념

### 조직 구조

전국 **14개 조직** (지역본부 12 + 사업단 2)이 노선별·분야별로 관할 구간을 나눠 관리한다.

- 지역본부 12개 + 사업단 2개 (highspeed_facility, highspeed_electric)
- 동일 고속선 구간에 지역본부(행정)와 사업단(분야 유지보수)이 **중복 공존**한다.

> 조직 코드 목록·관할구간 스키마 → [database/CLAUDE.md](database/CLAUDE.md)

### 권한 체계

| 역할 코드 | 설명 |
|---|---|
| `system_superuser` | 전체 CRUD, 크로스-org 등록 가능 |
| `org_admin` | 자기 조직 관할 구간 내 등록 (field로 분야 제한) |
| `user` | 전국 차단명령 조회 전용 |

- **분야(field) 코드:** `all` / `시설` / `전기` / `건축`

> 권한 검증 로직, API 의존성 주입 → [backend/CLAUDE.md](backend/CLAUDE.md)

### 철도 좌표계

- 기준: **노선코드 + 거리정(km)**, 단위 Float, 소수점 1자리 (예: `325.4`)
- 방향: `UP` (상선, 기점 방향) / `DOWN` (하선, 종점 방향)

### 노선도 GIS

모든 노선 GIS 데이터는 `route_geometry` 테이블에 저장 (DB SOT).

| source | 입력 | km | 표시 |
|---|---|---|---|
| `shp` | SHP import (형태 참조용) | NULL | 점선·연한 색 |
| `user` | 관리자 CSV 업로드 (공식) | 필수 | 실선·진한 색 |

> 파이프라인, LOD, 노선 현황 → [maps/CLAUDE.md](maps/CLAUDE.md), [maps/ROUTE_MANAGEMENT.md](maps/ROUTE_MANAGEMENT.md)

---

## 코드 컨벤션

| 항목 | 규칙 |
|---|---|
| Python 변수/함수 | snake_case |
| TypeScript 변수/함수 | camelCase |
| API 경로 | `/api/v1/...` |
| DB 테이블명 | 복수형 snake_case (`block_orders`, `facilities`) |
| 거리정 | Float, 소수점 1자리, km 단위 |
| 조직 코드 | 영문 소문자 snake_case |

---

## 서브프로젝트 문서

| 문서 | 담당 내용 |
|---|---|
| [backend/CLAUDE.md](backend/CLAUDE.md) | FastAPI 서버, API 엔드포인트, 환경변수, 패키지 관리, 검증 체크리스트 |
| [frontend/CLAUDE.md](frontend/CLAUDE.md) | React SPA, 컴포넌트 구조, 빌드, 상태관리 |
| [frontend/UI_UX.md](frontend/UI_UX.md) | 설계 원칙, 컬러 팔레트, 공통 컴포넌트 패턴, UX 규칙 |
| [frontend/UI_UX_pages.md](frontend/UI_UX_pages.md) | 페이지별 UI 명세 (레이아웃·필터·폼 상세) |
| [database/CLAUDE.md](database/CLAUDE.md) | DB 스키마, ORM 모델, 권한 검증 로직, seed 스크립트, Alembic |
| [maps/CLAUDE.md](maps/CLAUDE.md) | route_geometry 구조, GIS 파이프라인, source 운영 방침 |
| [maps/ROUTE_MANAGEMENT.md](maps/ROUTE_MANAGEMENT.md) | 51개 노선 등록 현황, SHP→user 전환 절차 |
| [scripts/CLAUDE.md](scripts/CLAUDE.md) | 유틸리티 스크립트, 백업, 개발용 샘플 데이터 |
| [docs/block_order_pdf_parsing.md](docs/block_order_pdf_parsing.md) | 차단명령 PDF 파싱 명세 (파싱 항목·DB 컬럼·연락처·Alembic 이력) |
