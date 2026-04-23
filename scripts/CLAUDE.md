# scripts — 유틸리티 스크립트

데이터 백업, 개발용 샘플 데이터 생성, GIS 데이터 변환 스크립트 모음.
M2 MacBook 네이티브 환경 기준.

---

## 디렉토리 구조 (현재)

```
scripts/
├── CLAUDE.md
├── gyeongbu_shp_to_user.py     # 경부선 SHP → source='user' geometry 변환
└── honam_shp_to_user.py        # 호남선 SHP → source='user' geometry 변환
```

## 디렉토리 구조 (계획)

```
scripts/
├── maintenance/
│   └── backup_db.py            # SQLite 백업 (Phase 1) / pg_dump 래퍼 (Phase 2)
└── dev/
    ├── seed_sample_data.py     # 개발용 샘플 차단명령 생성
    └── reset_db.py             # 개발 DB 초기화 (개발 환경 전용)
```

---

## 데이터 입력 방식

현재 아키텍처에서 데이터는 스크립트가 아닌 **웹 UI** 또는 **시드 스크립트**로 입력한다.

| 데이터 종류 | 입력 방법 |
|---|---|
| 조직·노선·관할구간·초기 관리자 | `database/seeds/` 스크립트 (최초 1회) |
| 노선도 geometry (source='shp') | 웹 UI → 노선도 관리 → SHP import |
| 노선도 geometry (source='user') | 웹 UI → 노선도 관리 → CSV 업로드 |
| 시설물 | 웹 UI → 시설물 관리 → CSV 업로드 |
| 차단명령 | 웹 UI → 차단명령 등록 |

---

## 기존 스크립트

### gyeongbu_shp_to_user.py

경부선의 `source='shp'` geometry 데이터를 읽어 `source='user'` geometry로 변환한다.
KORAIL 공식 선로제원표 없이 테스트용으로 km를 추정하는 **임시 방법**이다.

**변환 방식:**
1. DB에서 경부선 `source='shp', lod='high'` 데이터 조회
2. 각 segment를 평균 위도 기준 내림차순 정렬 (서울 북쪽→부산 남쪽)
3. segment 내 좌표를 Haversine 거리 누적 계산
4. 노선 km 범위(0~451.8) 비율로 km 값 할당
5. `save_geometry_user()` 호출 → DB 저장 + LOD 자동 생성

**실행:**

```bash
cd backend && source .venv/bin/activate && cd ..
python scripts/gyeongbu_shp_to_user.py
```

**결과:** 경부선 12,738 pts, km 0.0~451.8 저장

> **주의:** km 값은 추정값 (Haversine 비율 계산). 추후 KORAIL 공식 선로제원표 데이터로 교체 필요.

---

## 주요 스크립트 (예정)

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

## 실행 방법

```bash
# backend 가상환경 활성화 (SQLAlchemy 등 의존)
cd backend && source .venv/bin/activate
cd ..

python scripts/maintenance/backup_db.py
python scripts/dev/seed_sample_data.py
```

---

## 주의사항

- `reset_db.py` 는 개발 전용 스크립트 — 운영 DB에서 실행 시 데이터 전량 손실
- 임포트 전 반드시 `backup_db.py` 먼저 실행
- 모든 스크립트는 `backend/.venv` 가상환경 활성화 상태에서 실행
