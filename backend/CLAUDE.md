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
| 인증 | python-jose + passlib[bcrypt] | |
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
│   │   └── deps.py         # 의존성 주입 (get_db, get_current_user)
│   ├── models/             # SQLAlchemy ORM 모델
│   │   ├── user.py
│   │   ├── route.py
│   │   ├── facility.py
│   │   └── block_order.py
│   ├── schemas/            # Pydantic 요청/응답 스키마
│   ├── api/
│   │   └── v1/
│   │       ├── auth.py
│   │       ├── routes.py
│   │       ├── facilities.py
│   │       ├── block_orders.py
│   │       └── documents.py
│   └── services/           # 비즈니스 로직
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
python-multipart
pydantic-settings
```

> Phase 2 PostgreSQL 전환 시 추가: `psycopg2-binary`
> M2(arm64)에서 `psycopg2` 소스 빌드 오류 발생 가능 — 반드시 `psycopg2-binary` 사용.

---

## 주요 API 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/v1/auth/login` | JWT 로그인 |
| GET | `/api/v1/routes` | 노선 목록 |
| GET | `/api/v1/facilities` | 시설물 목록 (노선ID·종류 필터) |
| GET | `/api/v1/block-orders` | 차단명령 목록 (날짜·노선 필터) |
| POST | `/api/v1/block-orders` | 차단명령 등록 |
| PUT | `/api/v1/block-orders/{id}` | 차단명령 수정 |
| DELETE | `/api/v1/block-orders/{id}` | 차단명령 삭제 |
| POST | `/api/v1/documents/upload` | PDF 업로드 |
| GET | `/api/v1/stats/daily` | 일자별 집계 |

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

- **거리정:** Float, 소수점 1자리, 단위 km
- **방향:** `"UP"` (상선) / `"DOWN"` (하선)
- **파일 저장:** PDF는 `uploads/` 에 저장, DB에는 상대 경로만 저장
- **비밀번호:** bcrypt 해시 저장, 평문 저장 금지
- **인증:** JWT Bearer 토큰, 만료 8시간 (내부망 사용 고려)

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
