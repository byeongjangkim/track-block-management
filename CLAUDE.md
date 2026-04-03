# 선로차단작업 관리 프로그램

한국철도공사 부산경남본부 관내의 선로차단작업 승인 내역을 통합 관리하는 웹 기반 프로그램.

---

## 개발/운영 환경

- **서버:** MacBook M2 14 (arm64, macOS 15, 사내망 LAN 연결)
- **개발 도구:** Claude Code + VSCode
- **Python:** 3.12 (시스템 설치)
- **Node.js:** 22 (시스템 설치)
- **패키지 관리:** Homebrew (macOS)
- **Docker:** 미사용

---

## 프로젝트 구조

코드는 아래 구조 그대로 작성한다. 별도 하위 디렉토리를 추가하지 않는다.

```
track-block-management/          ← git 저장소 루트
├── backend/
│   ├── app/                     ← FastAPI 소스코드 (git 포함)
│   ├── alembic/                 ← 마이그레이션 (git 포함)
│   ├── uploads/                 ← PDF 저장 (.gitignore)
│   ├── db.sqlite3               ← SQLite DB (.gitignore)
│   ├── .env                     ← 환경변수 (.gitignore)
│   ├── .env.example             ← 환경변수 목록 (git 포함)
│   └── requirements.txt
├── frontend/
│   ├── src/                     ← React 소스코드 (git 포함)
│   ├── public/maps/             ← SVG 노선도 (git 포함)
│   ├── dist/                    ← 빌드 산출물 (.gitignore)
│   ├── node_modules/            ← (.gitignore)
│   └── .env.local               ← API URL 설정 (.gitignore)
├── maps/
│   ├── pipeline/                ← GIS 파이프라인 스크립트 (git 포함)
│   ├── svg/                     ← 완성된 SVG (git 포함)
│   ├── anchors/                 ← 앵커 포인트 JSON (git 포함)
│   ├── facilities/              ← 시설물 JSON (git 포함)
│   ├── raw/                     ← 원본 GIS 데이터 (.gitignore)
│   └── processed/               ← 중간 산출물 (.gitignore)
├── database/
│   ├── seeds/                   ← 초기 데이터 스크립트 (git 포함)
│   └── schema_reference.sql     ← 참조용 DDL (git 포함)
├── scripts/                     ← 유틸리티 스크립트 (git 포함)
└── docs/                        ← 문서 (git 포함)
```

각 서브프로젝트 세부사항은 해당 디렉토리의 `CLAUDE.md` 참고.

---

## 기술 스택

| 구분 | Phase 1 (로컬 테스트) | Phase 2+ (운영) |
|---|---|---|
| 백엔드 | Python FastAPI + Uvicorn | 동일 |
| 프론트엔드 | React 18 + TypeScript + Vite | 빌드 후 정적 서빙 (Nginx/Caddy) |
| 상태관리 | TanStack Query v5 + Zustand | 동일 |
| UI | shadcn/ui + Tailwind CSS v4 | 동일 |
| 데이터베이스 | **SQLite** (파일 기반, 설치 불필요) | PostgreSQL 15 |
| ORM / 마이그레이션 | SQLAlchemy 2.x + Alembic | 동일 (URL만 변경) |
| 인증 | JWT — python-jose + passlib[bcrypt] | 동일 |
| 지도 시각화 | D3.js v7 + 커스텀 SVG 맵 | 동일 |
| GIS 데이터 소스 | OpenStreetMap Overpass API / VWORLD WFS | 동일 |
| GIS 처리 | Python + geopandas + shapely | 동일 |
| GIS 변환 | GDAL (`brew install gdal`) | 동일 |
| SVG 변환 | mapshaper (`npm install -g mapshaper`) | 동일 |
| 리버스 프록시 | 없음 (직접 포트 접속) | Caddy 또는 Nginx |

---

## 로컬 서버 구성 (M2 MacBook)

### 포트 구성

| 서비스 | 포트 | 접속 주소 |
|---|---|---|
| 백엔드 API | 8000 | `http://[맥IP]:8000` |
| 프론트엔드 | 5173 | `http://[맥IP]:5173` |

### 맥 로컬 IP 확인

```bash
ipconfig getifaddr en0
# 예: 192.168.0.10
```

PC·폰·태블릿 모두 같은 Wi-Fi(또는 유선 LAN)에서 위 IP로 접속 가능.

### 서비스 시작 순서

```bash
# 터미널 1 — 백엔드
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 터미널 2 — 프론트엔드
cd frontend
npm run dev -- --host 0.0.0.0
```

---

## 도메인 핵심 개념

### 철도 좌표계
- 기준: **노선명 + 거리정(km)**
- 방향: 시점(기점) → 종점 방향으로 km 단위 표시
- 상선/하선 구분: SVG y 오프셋으로 분리 표현
- 예시: `경부선 KP 325.4` → 경부선 325.4km 지점
- 방향 코드: `UP` (상선) / `DOWN` (하선)

### 차단명령 데이터 구조
- 노선 / 방향(UP·DOWN) / 시작·종료 거리정(km)
- 작업일자, 시작·종료 시각
- 분야 / 차단종류 / 장비·인력작업 여부 / 외부·내부 구분
- 작업책임자, 안전관리자, 운행안전협의자, 열차감시원
- 안전관리항목 / 승인문서(PDF) 파일경로

### 주요 시설물 종류

| 종류 | 코드 |
|---|---|
| 기차역 (역구내 배선도 연결) | `STATION` |
| 철도건널목 | `CROSSING` |
| 과선교 | `OVERPASS` |
| 철도변전소 | `SUBSTATION` |
| 터널 | `TUNNEL` |
| 교량 | `BRIDGE` |

---

## 개발 단계 (Phase)

| Phase | 내용 | DB | 상태 |
|---|---|---|---|
| Phase 1 | 기반 구축 (GIS→SVG, DB 스키마, 기본 뷰어, CRUD) | SQLite | 진행 중 |
| Phase 2 | 핵심 기능 (인증, 노선도 시각화, 캘린더, PDF 뷰어) | SQLite → PostgreSQL | 대기 |
| Phase 3 | 고도화 (역구내 배선도, 통계, 기상API, 모바일) | PostgreSQL | 대기 |
| Phase 4 | 확장 (Linux 서버/클라우드 이전, 알림, 보고서) | PostgreSQL | 검토 |

---

## 서버 이전 규칙 (Mac → Linux)

코드는 동일하게 유지되며, 서버에서는 `.env` 파일만 새로 작성한다.

### 절대경로 금지

```python
# 금지 — Mac 경로는 Linux에서 동작하지 않음
UPLOAD_DIR = "/Users/byeongjangkim/..."

# 올바름 — pathlib 상대경로
from pathlib import Path
BASE_DIR = Path(__file__).parent.parent   # backend/ 루트
UPLOAD_DIR = BASE_DIR / "uploads"

# 올바름 — 환경변수 우선
import os
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))
```

### 환경별 `.env` 값 비교

| 항목 | MacBook (개발) | Linux 서버 (운영) |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./db.sqlite3` | `postgresql://localhost/track_block` |
| `UPLOAD_DIR` | `./uploads` | `/var/data/track-block/uploads` |
| `SECRET_KEY` | 임시값 | 강력한 랜덤값 |
| `VITE_API_URL` | `http://localhost:8000` | `http://서버IP:8000` |

### 서버 이전 시 실제 작업 순서

```bash
# Linux 서버에서
git clone [저장소URL] track-block-management
cd track-block-management

# 백엔드
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && nano .env   # 서버값 입력
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 프론트엔드 (서버에서는 빌드 후 정적 서빙)
cd ../frontend
npm install
VITE_API_URL=http://서버IP:8000 npm run build
# → dist/ 를 Nginx/Caddy로 서빙

# maps SVG 파일은 git에 포함되어 있으므로 별도 작업 불필요
```

---

## 컨벤션

- **언어:** 변수/함수명은 영문 snake_case (Python), camelCase (TypeScript)
- **API 경로:** `/api/v1/...` 형식
- **DB 테이블명:** 복수형 snake_case (예: `block_orders`, `facilities`)
- **거리정 단위:** 항상 km, Float (소수점 1자리, 예: `325.4`)
- **방향 값:** `"UP"` (상선) / `"DOWN"` (하선) 으로 통일
