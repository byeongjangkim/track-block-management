# database — DB 스키마 및 시드 데이터

ORM 모델 정의와 시드 데이터를 관리한다.
Alembic 마이그레이션은 모델 파일이 있는 `backend/`에서 실행한다.

---

## Phase별 DB 구성

| Phase | DB | 설치 방법 |
|---|---|---|
| Phase 1 | SQLite | 설치 불필요 (Python 내장) |
| Phase 2+ | PostgreSQL 15 | `brew install postgresql@15` |

---

## SQLite → PostgreSQL 호환 주의사항

SQLAlchemy ORM을 사용하므로 대부분 동일하나, 아래는 주의:

| 항목 | SQLite | PostgreSQL |
|---|---|---|
| Boolean | 0/1 저장 | 네이티브 BOOLEAN |
| 날짜/시간 | TEXT 저장 | DATE, TIME, TIMESTAMPTZ |
| AUTO_INCREMENT | `INTEGER PRIMARY KEY` | `SERIAL` or `IDENTITY` |
| URL | `sqlite:///./db.sqlite3` | `postgresql://localhost/track_block` |

> ORM 모델을 표준적으로 작성하면 `DATABASE_URL`만 바꿔도 대부분 동작.
> SQLite 비호환 기능(full-text search, JSON 연산자 등) 사용 금지.

---

## 디렉토리 구조

```
database/
├── seeds/
│   ├── routes.py            # 노선 초기 데이터 (Python 스크립트)
│   ├── facilities.py        # 시설물 초기 데이터
│   └── admin_user.py        # 초기 관리자 계정 생성
└── schema_reference.sql     # 참조용 DDL (자동 생성 금지, 수동 유지)
```

> Alembic 마이그레이션 파일(`alembic/`, `alembic.ini`)은 `backend/` 에 위치.
> 모델 파일(`backend/app/models/`)에 접근해야 하기 때문.

> 시드 데이터는 SQL 파일 대신 Python 스크립트 사용 — SQLite/PostgreSQL 모두 호환.

---

## ORM 모델 (테이블 설계)

ORM 모델 실제 파일 위치: `backend/app/models/`

### users
```python
class User(Base):
    __tablename__ = "users"
    id         = Column(Integer, primary_key=True)
    username   = Column(String(50), unique=True, nullable=False)
    password   = Column(String(255), nullable=False)   # bcrypt 해시
    name       = Column(String(100))
    role       = Column(String(20), default="viewer")  # admin | editor | viewer
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

### routes (노선)
```python
class Route(Base):
    __tablename__ = "routes"
    id             = Column(Integer, primary_key=True)
    code           = Column(String(20), unique=True)    # 예: 'gyeongbu'
    name           = Column(String(50), nullable=False) # 예: '경부선'
    start_km       = Column(Float, nullable=False)
    end_km         = Column(Float, nullable=False)
    up_direction   = Column(String(50))                 # 예: '서울 방향'
    down_direction = Column(String(50))                 # 예: '부산 방향'
```

### facilities (시설물)
```python
class Facility(Base):
    __tablename__ = "facilities"
    id              = Column(Integer, primary_key=True)
    route_id        = Column(Integer, ForeignKey("routes.id"), nullable=False)
    type            = Column(String(20), nullable=False)
      # STATION | CROSSING | OVERPASS | SUBSTATION | TUNNEL | BRIDGE
    km              = Column(Float, nullable=False)
    name            = Column(String(100), nullable=False)
    has_station_map = Column(Boolean, default=False)
```

### block_orders (차단명령)
```python
class BlockOrder(Base):
    __tablename__ = "block_orders"
    id               = Column(Integer, primary_key=True)
    route_id         = Column(Integer, ForeignKey("routes.id"), nullable=False)
    direction        = Column(String(4), nullable=False)   # 'UP' | 'DOWN'
    start_km         = Column(Float, nullable=False)
    end_km           = Column(Float, nullable=False)
    work_date        = Column(Date, nullable=False)
    start_time       = Column(Time, nullable=False)
    end_time         = Column(Time, nullable=False)
    field            = Column(String(50))                  # 분야 (토목, 전기, 신호 등)
    block_type       = Column(String(50))                  # 차단종류
    has_equipment    = Column(Boolean, default=False)      # 장비작업
    has_manpower     = Column(Boolean, default=False)      # 인력작업
    is_external      = Column(Boolean, default=False)      # 외부공사 여부
    work_manager     = Column(String(100))                 # 작업책임자
    safety_manager   = Column(String(100))                 # 안전관리자
    operation_safety = Column(String(100))                 # 운행안전협의자
    train_watcher    = Column(String(100))                 # 열차감시원
    safety_items     = Column(Text)                        # 안전관리항목
    document_path    = Column(String(500))                 # PDF 상대경로
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

### route_anchors (거리정 앵커 포인트)
```python
class RouteAnchor(Base):
    __tablename__ = "route_anchors"
    id       = Column(Integer, primary_key=True)
    route_id = Column(Integer, ForeignKey("routes.id"), nullable=False)
    km       = Column(Float, nullable=False)
    svg_x    = Column(Float, nullable=False)
    svg_y    = Column(Float, nullable=False)
```

---

## Alembic 마이그레이션

Alembic은 `backend/`에서 실행한다 (모델 파일 위치 기준).

```bash
cd backend
source .venv/bin/activate

# 최초 테이블 생성
alembic upgrade head

# 모델 변경 후 마이그레이션 파일 자동 생성
alembic revision --autogenerate -m "add_xxx_column"
alembic upgrade head
```

---

## 시드 데이터 실행

```bash
# 프로젝트 루트에서, backend 가상환경 활성화 후
cd backend && source .venv/bin/activate
cd ..
python database/seeds/routes.py
python database/seeds/admin_user.py
```

---

## Phase 2: PostgreSQL 전환

```bash
# 1. Homebrew로 설치
brew install postgresql@15
brew services start postgresql@15
echo 'export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 2. DB 생성
createdb track_block

# 3. backend/.env 수정
DATABASE_URL=postgresql://localhost/track_block

# 4. 드라이버 추가 (sync용)
pip install psycopg2-binary

# 5. 마이그레이션 재실행
cd backend && alembic upgrade head
```

---

## 주의사항

- `db.sqlite3` 파일은 `backend/.gitignore` 처리 (데이터 포함)
- `direction` 컬럼은 반드시 `'UP'` 또는 `'DOWN'` 만 저장
- `km` 관련 컬럼은 Float — ORM 레벨에서 소수점 1자리로 반올림 처리
- 비밀번호는 bcrypt 해시값만 저장, 평문 저장 절대 금지
