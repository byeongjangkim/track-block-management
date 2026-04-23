# backend — API 서버

Python FastAPI 기반 REST API 서버. 인증, 차단명령 CRUD, 노선·시설물 조회, 파일 업로드를 담당한다.

---

## 환경

- **Python:** 3.12 (M2 MacBook, arm64)
- **DB:** SQLite (Phase 1) → PostgreSQL 15 (Phase 2)
- **실행:** Uvicorn (개발: `--reload`, 운영: systemd 또는 PM2)

---

## 기술 스택

| 구분 | 라이브러리 | 비고 |
|---|---|---|
| 웹 프레임워크 | FastAPI | |
| ORM | SQLAlchemy 2.x (sync) | SQLite는 async 드라이버 불필요 |
| DB | sqlite3 내장 → asyncpg (Phase 2) | |
| 마이그레이션 | Alembic | |
| 인증 | python-jose + passlib[bcrypt] | bcrypt==4.0.1 고정 (5.x 비호환) |
| 파일 처리 | python-multipart | PDF 업로드 |
| 유효성 검사 | Pydantic v2 | |
| 서버 | Uvicorn | |

> **SQLite 선택 이유:** 서버 없이 파일 하나(`db.sqlite3`)로 동작. Phase 2에서 `.env`의 `DATABASE_URL`만 변경해 PostgreSQL로 전환.

---

## 디렉토리 구조

```
backend/
├── app/
│   ├── main.py             # FastAPI 앱 진입점, CORS 설정
│   ├── core/
│   │   ├── config.py       # 환경변수 (pydantic BaseSettings)
│   │   ├── security.py     # JWT 발급/검증
│   │   ├── database.py     # SQLAlchemy 엔진/세션
│   │   └── deps.py         # 의존성 주입 (get_db, get_current_user, require_*)
│   ├── models/             # SQLAlchemy ORM 모델
│   │   ├── organization.py # organizations + organization_route_ranges
│   │   ├── user.py         # users (organization_id + role 포함)
│   │   ├── route.py
│   │   ├── facility.py
│   │   └── block_order.py  # organization_id, section_note(단전구간명) 포함
│   ├── schemas/            # Pydantic 요청/응답 스키마
│   ├── api/
│   │   └── v1/
│   │       ├── auth.py
│   │       ├── organizations.py  # 조직 CRUD (system_superuser only)
│   │       ├── routes.py
│   │       ├── facilities.py
│   │       ├── block_orders.py   # 권한 검증 포함
│   │       ├── documents.py
│   │       ├── map.py            # 지도 API (GeoJSON, 시설물, 차단구간, viewport)
│   │       └── admin.py          # 시설물·geometry 관리 (org_admin+/superuser)
│   └── services/           # 비즈니스 로직
│       ├── facility_service.py   # CSV → anchors + facilities JSON
│       ├── geometry_service.py   # CSV 파싱, user geometry 저장, LOD 생성
│       ├── shp_service.py        # SHP → route_geometry (source='shp')
│       ├── auth_service.py       # 권한 검증 헬퍼 (km 범위 + 분야 + 조직)
│       └── pdf_parser_service.py # PDF → 차단명령 필드 추출 (pdfplumber + pikepdf) → docs/block_order_pdf_parsing.md 참조
├── alembic/                # 마이그레이션 파일 (git 포함)
├── alembic.ini
├── uploads/                # PDF 저장 (.gitignore)
├── db.sqlite3              # SQLite DB (.gitignore)
├── .env                    # 환경변수 (.gitignore)
├── .env.example            # 환경변수 목록 — 값 없이 (git 포함)
└── requirements.txt
```

---

## 개발 시작

```bash
cd backend

# 가상환경 생성 (최초 1회)
python3 -m venv .venv
source .venv/bin/activate

# 패키지 설치
pip install -r requirements.txt

# 환경변수 설정 (최초 1회)
cp .env.example .env
# .env 편집: SECRET_KEY에 랜덤 문자열 입력

# DB 초기화
alembic upgrade head

# 서버 실행 (LAN 접속 가능)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 환경변수

### `.env.example` (git 커밋 대상)

```
# Phase 1 — SQLite (설치 불필요)
DATABASE_URL=sqlite:///./db.sqlite3

# Phase 2 — PostgreSQL (brew install postgresql@15 후 사용)
# DATABASE_URL=postgresql://localhost/track_block

SECRET_KEY=여기에_랜덤_문자열_입력
ACCESS_TOKEN_EXPIRE_MINUTES=480
UPLOAD_DIR=./uploads
```

### `.env` (git 제외 — 실제 실행값)

| 항목 | MacBook (개발) | Linux 서버 (운영) |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./db.sqlite3` | `postgresql://localhost/track_block` |
| `UPLOAD_DIR` | `./uploads` | `/var/data/track-block/uploads` |
| `SECRET_KEY` | 임시값 | 강력한 랜덤값 |

---

## 코드 수정 후 필수 검증 절차

> **⚠️ 중요:** 코드 수정 시 새로운 패키지를 import하면 반드시 venv에 설치하고 requirements.txt에 추가해야 한다.
> 누락 시 uvicorn --reload가 import 오류로 멈추고 모든 API가 응답 불가 상태가 된다.

### 새 패키지 추가 시 필수 체크리스트

1. **venv에 설치 확인**
   ```bash
   source .venv/bin/activate
   pip install <패키지명>
   ```

2. **requirements.txt에 추가** — 설치 후 반드시 파일에도 기재

3. **import 정상 여부 확인**
   ```bash
   source .venv/bin/activate
   python3 -c "import app.main; print('import OK')"
   ```

4. **서버 응답 확인**
   ```bash
   curl -m 5 http://localhost:8000/api/health
   # → {"status":"ok"} 가 반환되어야 정상
   ```

> 위 4단계를 모두 통과한 후에만 작업 완료로 간주한다.

---

## 코드 작성 규칙 (서버 이전 대비)

### 절대경로 사용 금지

```python
# 금지 — Mac 경로는 Linux에서 동작하지 않음
UPLOAD_DIR = "/Users/byeongjangkim/MyProjects/.../uploads"

# 올바름 — pathlib으로 소스 파일 기준 상대경로
from pathlib import Path
BASE_DIR = Path(__file__).parent.parent   # backend/ 루트
UPLOAD_DIR = BASE_DIR / "uploads"

# 올바름 — 환경변수 우선 (app/core/config.py 패턴)
import os
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))
```

### `.gitignore` (backend/)

```
.venv/
.env
db.sqlite3
uploads/
__pycache__/
*.pyc
.pytest_cache/
```

---

## requirements.txt

```
fastapi
uvicorn[standard]
sqlalchemy
alembic
python-jose[cryptography]
passlib[bcrypt]
bcrypt==4.0.1          # 5.x는 passlib 1.7.4와 비호환 — 고정 필수
python-multipart
pydantic-settings
pyproj                 # SHP 좌표 변환 (EPSG:5179 → WGS84)
pdfplumber             # PDF 텍스트·테이블 추출 (시행문·세부내역 파싱)
pikepdf                # 손상·선형화 PDF 복구 후 pdfplumber에 전달
```

> Phase 2 PostgreSQL 전환 시 추가: `psycopg2-binary`
> M2(arm64)에서 `psycopg2` 소스 빌드 오류 발생 가능 — 반드시 `psycopg2-binary` 사용.

---

## 주요 API 엔드포인트

### 인증
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/v1/auth/login` | 공개 | JWT 로그인 |
| GET | `/api/v1/auth/me` | 로그인 | 내 정보 조회 |

### 조직 (organizations)
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/v1/organizations` | 로그인 | 전체 조직 목록 |
| POST | `/api/v1/organizations` | system_superuser | 조직 생성 |
| PUT | `/api/v1/organizations/{id}` | system_superuser | 조직 수정 |
| GET | `/api/v1/organizations/{id}/route-ranges` | 로그인 | 조직 관할 구간 목록 |
| PUT | `/api/v1/organizations/{id}/route-ranges` | system_superuser | 관할 구간 전체 교체 |
| POST | `/api/v1/organizations/{id}/route-ranges` | system_superuser | 관할 구간 단건 추가 |
| PUT | `/api/v1/organizations/{id}/route-ranges/{range_id}` | system_superuser | 관할 구간 단건 수정 |
| DELETE | `/api/v1/organizations/{id}/route-ranges/{range_id}` | system_superuser | 관할 구간 단건 삭제 |

### 노선·시설물
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/v1/routes` | 로그인 | 노선 목록 |
| GET | `/api/v1/facilities` | 로그인 | 시설물 목록 (노선ID·종류 필터) |

### 차단명령
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/v1/block-orders` | 로그인 | 목록 (필터: `route_id`, `date_from`, `date_to`, `organization_id`, `field`, `start_km_from`, `end_km_to`) |
| POST | `/api/v1/block-orders` | org_admin+ | 단건 등록 (관할 구간 검증) |
| POST | `/api/v1/block-orders/bulk` | org_admin+ | PDF 파싱 결과 일괄 저장 (배치, 실패 행 skip) |
| PUT | `/api/v1/block-orders/{id}` | org_admin+ | 수정 |
| DELETE | `/api/v1/block-orders/{id}` | org_admin+ | 삭제 |

### 문서 / PDF 파싱
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/v1/documents/parse-pdf` | org_admin+ | 시행문 PDF 업로드 → 차단명령 필드 추출 (DB 저장 없음, 단건 자동채움용) |
| POST | `/api/v1/documents/bulk-parse` | org_admin+ | 세부내역 PDF 업로드 → 다중 차단명령 행 파싱 (DB 저장 없음, 일괄등록 검토용) |
| POST | `/api/v1/documents/upload/{order_id}` | org_admin+ | 차단명령에 PDF 문서 첨부 |
| GET | `/api/v1/documents/{filename}` | 로그인 | 첨부 PDF 다운로드 |

### 시설물 관리 (어드민)
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/v1/admin/routes/{code}/facilities` | org_admin+ | 시설물 관리 목록 |
| POST | `/api/v1/admin/routes/{code}/facilities` | org_admin+ | 시설물 추가 |
| PUT | `/api/v1/admin/facilities/{id}` | org_admin+ | 시설물 수정 |
| DELETE | `/api/v1/admin/facilities/{id}` | org_admin+ | 시설물 삭제 |
| POST | `/api/v1/admin/routes/{code}/upload-csv` | org_admin+ | 시설물 CSV 일괄 업로드 |
| POST | `/api/v1/admin/routes/{code}/deploy` | org_admin+ | 노선도 배포 |

### 지도 API (map.py)
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/v1/map/routes/all/geometry` | 로그인 | 전 노선 GeoJSON (lod 파라미터) |
| GET | `/api/v1/map/routes/{code}/geometry` | 로그인 | 단일 노선 GeoJSON |
| GET | `/api/v1/map/routes/{code}/facilities` | 로그인 | 노선 시설물 GeoJSON (km→좌표 보간) |
| GET | `/api/v1/map/organizations/{id}/boundaries` | 로그인 | 조직 관할 구간 GeoJSON 오버레이 |
| GET | `/api/v1/map/organizations/{id}/viewport` | 로그인 | 조직 초기 viewport (center_lat/lon, zoom) |
| GET | `/api/v1/map/block-orders/segments` | 로그인 | 날짜별 차단명령 구간 GeoJSON (user geometry 있는 것만) |

> **중요:** `map/routes/{code}/facilities` 및 `map/block-orders/segments` 는 `source='user'` geometry에서만 km 보간한다. `source='shp'`(km=NULL) 기반 보간은 없다.

### 노선도 geometry 관리 (system_superuser 전용)
| Method | Path | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/v1/admin/routes/geometry-status` | superuser | 전 노선 geometry 현황 (source별 segments/pts/km범위) |
| GET | `/api/v1/admin/routes/{code}/geometry-template` | superuser | 노선도 CSV 템플릿 다운로드 (segment,seq,lat,lon,km) |
| GET | `/api/v1/admin/routes/{code}/geometry-download` | superuser | 등록된 user geometry CSV 다운로드 (검증용) |
| POST | `/api/v1/admin/routes/{code}/geometry-upload` | superuser | 노선도 CSV 업로드 (source='user', LOD 자동 생성) |
| DELETE | `/api/v1/admin/routes/{code}/geometry-shp` | superuser | SHP 참조 데이터 삭제 (source='shp') |
| GET | `/api/v1/admin/shp/routes` | superuser | SHP 내 노선 목록 |
| POST | `/api/v1/admin/shp/import` | superuser | SHP → route_geometry (source='shp') |

---

## 권한 의존성 주입 (deps.py)

```python
def get_current_user(token: str = Depends(oauth2_scheme), db = Depends(get_db)) -> User:
    # JWT 검증 후 User 반환

def require_org_admin(user: User = Depends(get_current_user)) -> User:
    """org_admin 이상 (분야 무관 — 엔드포인트 레벨 체크)"""
    if user.role not in ("org_admin", "system_superuser"):
        raise HTTPException(status_code=403)
    return user

def require_superuser(user: User = Depends(get_current_user)) -> User:
    """system_superuser 전용"""
    if user.role != "system_superuser":
        raise HTTPException(status_code=403)
    return user
```

> 세부 분야·구간 검증은 `app/services/auth_service.py`의 `can_register_block_order()`에서 수행.
> deps.py는 역할 레벨만 체크, 분야·km 범위 검증은 서비스 레이어 담당.

---

## CORS 설정 (app/main.py)

LAN에서 프론트엔드가 API를 호출할 수 있도록 설정한다.

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 개발 시. 운영 시 특정 IP로 제한
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 핵심 비즈니스 규칙

- **거리정:** Float, 소수점 1자리, 단위 km — `start_km` / `end_km` 모두 nullable
- **전차선 단전:** km 대신 `section_note` (예: `"청도SP~밀양SS"`) 사용. SP=급전구분소, SS=변전소, SSP=보조급전구분소
- **방향:** `"UP"` (상선/구내/상하선) / `"DOWN"` (하선)
- **파일 저장:** PDF는 `uploads/` 에 저장, DB에는 상대 경로만 저장
- **비밀번호:** bcrypt 해시 저장, 평문 저장 금지
- **인증:** JWT Bearer 토큰, 만료 8시간 (내부망 사용 고려)
- **차단명령 등록 권한:** 조직 + 분야 + km 범위 세 조건을 모두 만족해야 등록 가능
  - `system_superuser`: 제한 없음
  - `org_admin` + `field=NULL/'all'` (조직 superuser): 자기 조직 관할 km 범위 내 모든 분야
  - `org_admin` + `field='시설'` 등 (분야 담당): 자기 조직 관할 km 범위 내 해당 분야만
- **크로스-org 차단명령:** `system_superuser`만 등록 가능 (여러 조직 관할 구간에 걸친 작업)
- **조회:** 모든 로그인 사용자는 전국 차단명령 조회 가능 (`user` 포함)

---

## Phase 2: PostgreSQL 전환

```bash
# 1. Homebrew로 설치
brew install postgresql@15
brew services start postgresql@15

# 2. DB 생성
createdb track_block

# 3. .env 수정
DATABASE_URL=postgresql://localhost/track_block

# 4. 드라이버 추가
pip install psycopg2-binary

# 5. 마이그레이션 재실행
alembic upgrade head
```

---

## 관련 문서

| 문서 | 내용 |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | 프로젝트 전체 개요, 조직·권한·노선 구조 |
| [../database/CLAUDE.md](../database/CLAUDE.md) | DB 스키마, ORM 모델, seed 스크립트 |
| [../frontend/UI_UX.md](../frontend/UI_UX.md) | 화면 설계, 역할별 UI 제어, API 응답 활용 패턴 |
| [../maps/CLAUDE.md](../maps/CLAUDE.md) | route_geometry 아키텍처, source 구분 |
| [../docs/block_order_pdf_parsing.md](../docs/block_order_pdf_parsing.md) | PDF 파싱 항목·DB 스키마·연락처 필드·Alembic 이력 |
