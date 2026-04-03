# scripts — 유틸리티 스크립트

데이터 임포트, 백업, 개발용 샘플 데이터 생성 스크립트 모음.
M2 MacBook 네이티브 환경 기준.

---

## 디렉토리 구조

```
scripts/
├── import/
│   ├── import_routes.py        # 노선 기본 정보 일괄 등록
│   ├── import_facilities.py    # maps/facilities/*.json → DB 임포트
│   └── import_anchors.py       # maps/anchors/*.json → DB 임포트
├── maintenance/
│   └── backup_db.py            # SQLite 백업 (Phase 1) / pg_dump 래퍼 (Phase 2)
└── dev/
    ├── seed_sample_data.py     # 개발용 샘플 차단명령 생성
    └── reset_db.py             # 개발 DB 초기화 (개발 환경 전용)
```

---

## 실행 방법

```bash
# backend 가상환경 활성화 (SQLAlchemy 등 의존)
cd backend && source .venv/bin/activate
cd ..

# 예시
python scripts/import/import_facilities.py --json maps/facilities/gyeongbu.json
python scripts/import/import_anchors.py --json maps/anchors/gyeongbu.json
python scripts/dev/seed_sample_data.py
```

---

## 주요 스크립트

### import_facilities.py
`maps/facilities/[노선코드].json` 을 읽어 `facilities` 테이블에 일괄 등록.
실행 전 해당 노선이 `routes` 테이블에 먼저 등록되어 있어야 함.

```bash
python scripts/import/import_facilities.py --json maps/facilities/gyeongbu.json
```

### import_anchors.py
`maps/anchors/[노선코드].json` 을 읽어 `route_anchors` 테이블에 등록.
기존 데이터가 있으면 덮어씀.

```bash
python scripts/import/import_anchors.py --json maps/anchors/gyeongbu.json
```

### backup_db.py
- **Phase 1 (SQLite):** `backend/db.sqlite3` 파일을 타임스탬프 붙여 복사
- **Phase 2 (PostgreSQL):** `pg_dump` 실행

```python
# Phase 1 백업 예시
import shutil, datetime
shutil.copy('backend/db.sqlite3', f'backup_{datetime.date.today()}.sqlite3')
```

### seed_sample_data.py
개발 및 시연용 샘플 차단명령 데이터 자동 생성.
**운영 환경에서 절대 실행 금지.**

### reset_db.py
`backend/db.sqlite3` 삭제 후 Alembic 재실행으로 빈 DB 재생성.
**개발 환경 전용 — 모든 데이터 삭제됨.**

---

## 주의사항

- `reset_db.py` 는 개발 전용 스크립트 — 운영 DB에서 실행 시 데이터 전량 손실
- 임포트 전 반드시 `backup_db.py` 먼저 실행
- 모든 스크립트는 `backend/.venv` 가상환경 활성화 상태에서 실행
- 임포트 스크립트 입력 파일 형식은 JSON (`maps/facilities/`, `maps/anchors/` 산출물)
