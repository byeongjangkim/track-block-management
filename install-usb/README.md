# 선로차단작업 관리 — Ubuntu 서버 배포 가이드

> **대상 환경**: Ubuntu 서버, Docker Compose, team-work-manager 동일 IP 공존  
> **최종 갱신**: 2026-06-08 | Alembic 버전: `tc16_dev_accounts_pw`

---

## ★ AI에게 최신화 요청 시 수행 절차 ★

> 사용자가 **"install-usb 파일을 현재 작업중인 파일과 같이 최신화 하세요"** 라고 요청하면
> AI는 아래 체크리스트를 **순서대로 자동 수행**합니다.

### [AI 자동 수행] 최신화 체크리스트

```
Step 1. 기준데이터 덤프 생성 (로컬 PostgreSQL 실행 필요)
        cd <프로젝트루트>
        bash backend/scripts/dump_reference_data.sh
        → backend/scripts/dumps/reference_data_<날짜>.sql 생성
        
        포함 데이터: rail_routes(153개 노선), rail_stations(역), rail_facilities(시설물),
                    rail_baseline_points, rail_computed_geometry(노선 GeoJSON),
                    rail_track_sections, organizations(14개 조직),
                    organization_route_ranges(관할구간), system_settings,
                    facilities(레거시 역 정보 565개), routes, org_viewport 등

Step 2. 최신 덤프를 install-usb/seed/ 로 복사
        rm -f install-usb/seed/reference_data_*.sql
        cp backend/scripts/dumps/reference_data_<최신>.sql install-usb/seed/

Step 3. [자동포함] 시군구 지도 GeoJSON — DB가 아닌 파일
        maps/data/korea_map_level1.geojson (316KB, 시도 경계)
        maps/data/korea_map_level2.geojson (1.2MB, 시군구 경계)
        → Dockerfile.backend에서 /maps/data/ 로 자동 COPY 됨 (별도 작업 불필요)

Step 4. [자동생성] 사용자 기본 계정 — Alembic 마이그레이션이 처리
        tc15: block_manager 계정 생성
        tc16: admin@korail.com / block_manager 비밀번호 korail7788! 설정
        → entrypoint.sh에서 'alembic upgrade head' 자동 실행 (seed 불필요)

Step 5. README.md 상단 "최종 갱신" 날짜 및 Alembic 버전 갱신
        cd backend && source .venv/bin/activate && alembic current
        → 결과값으로 README 최상단 업데이트

Step 6. .env.template 동기화
        app/core/config.py에 새 환경변수 추가 시 .env.template에 반영

Step 7. Dockerfile 의존성 확인
        backend/requirements.txt 변경 → Dockerfile.backend 자동 반영 (COPY 방식)
        frontend/package.json 변경  → Dockerfile.frontend 자동 반영 (COPY 방식)
        → 변경 없으면 패스

Step 8. install-usb 변경 커밋 제안 (seed/*.sql 제외 — .gitignore 대상)
```

### [사용자 수동] USB 최종 복사

```bash
# Mac 터미널에서 실행
cd <프로젝트루트>
bash install-usb/scripts/prepare-usb.sh /Volumes/<USB드라이브이름>
```

---

## 1. 배포 모드 선택

| 항목 | **모드 A** (독립 포트 / 권장) | **모드 B** (nginx 경로 통합) |
|---|---|---|
| **접속 주소** | `http://서버IP:8080` | `http://서버IP/track` |
| **포트 충돌** | 없음 (8080 신규 사용) | 없음 (경로 분기) |
| **team-work-manager 수정** | **불필요** | nginx location 블록 추가 필요 |
| **설정 난이도** | ★☆☆ | ★★☆ |
| **HTTPS** | 별도 처리 | 기존 nginx SSL 공유 가능 |

---

## 2. USB 준비 (Mac에서)

> AI 최신화 후 아래 스크립트 한 번 실행으로 완료됩니다.

```bash
cd <프로젝트루트>
bash install-usb/scripts/prepare-usb.sh /Volumes/<USB드라이브이름>
```

`prepare-usb.sh`가 수행하는 작업:
1. 기준데이터 최신 덤프 생성 (`dump_reference_data.sh`)
2. 덤프를 `install-usb/seed/`에 복사
3. 프로젝트 전체를 USB로 rsync (node_modules, .git, *.pyc 제외)

---

## 3. 서버 설치 — 원클릭 (install.sh)

### 3-1. USB에서 서버로 복사

```bash
# USB 마운트 후 서버에 복사
sudo mkdir -p /opt/track-block-management
sudo rsync -av /media/<사용자>/<USB이름>/track-block-management/. \
               /opt/track-block-management/
sudo chown -R $USER:$USER /opt/track-block-management
```

### 3-2. 원클릭 설치

```bash
cd /opt/track-block-management/install-usb
bash install.sh
```

`install.sh`는 대화형으로 진행됩니다:
- Docker / Docker Compose 설치 여부 자동 감지
- `.env` 없으면 템플릿 기반 대화형 설정
- 이미지 빌드 → 컨테이너 시작 → Alembic 자동 마이그레이션
- seed/*.sql 존재 시 기준데이터 자동 복원
- 완료 후 접속 주소 안내

### 3-3. 비대화형 설치 (자동화 배포)

```bash
# .env 먼저 작성 후 실행
bash install.sh --yes --mode a
```

---

## 4. 업데이트 배포

```bash
cd /opt/track-block-management/install-usb

# USB에서 최신 소스 복사 후
bash install.sh --update
```

업데이트 시 수행 작업:
- 이미지 재빌드 (소스 변경 반영)
- db 컨테이너 유지 (데이터 보존)
- backend → frontend 순서 교체 (무중단)
- Alembic 자동 마이그레이션 (새 revision 적용)
- 기준데이터 덮어쓰지 않음 (운영 데이터 보존)

---

## 5. 모드 B 추가 작업 (nginx 경로 통합)

```bash
# 1. tbm-net과 기존 nginx 컨테이너 연결
docker network connect tbm-net <기존_nginx_컨테이너명>

# 2. nginx location 블록 추가
docker cp nginx/integrated.conf <nginx_컨테이너명>:/etc/nginx/conf.d/track.conf
docker exec <nginx_컨테이너명> nginx -t && \
docker exec <nginx_컨테이너명> nginx -s reload

# 컨테이너 목록 확인
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
```

---

## 6. 기본 계정 (배포 후 변경 필수)

| 역할 | 아이디 | 비밀번호 |
|---|---|---|
| 시스템 관리자 | `admin@korail.com` | `korail7788!` |
| 차단명령 관리자 | `block_manager` | `korail7788!` |

> Alembic 마이그레이션(tc16)에서 자동 생성됩니다. 배포 직후 반드시 변경하세요.

---

## 7. 데이터 처리 원칙

| 데이터 종류 | 저장 위치 | 처리 방법 |
|---|---|---|
| 시군구 지도·노선·역·시설물 | seed/*.sql | AI 최신화 → USB → restore-seed.sh |
| 조직·관할구간·시스템설정 | seed/*.sql | 동일 |
| 사용자 정보 | Docker volume (tbm-db-data) | 마이그레이션으로 기본계정 자동 생성, 추가는 관리자 UI |
| 차단명령 운영 데이터 | Docker volume (tbm-db-data) | 업데이트 시 보존, 별도 백업 권장 |
| PDF 업로드 파일 | Docker volume (tbm-uploads) | 업데이트 시 보존 |
| Alembic 마이그레이션 | 소스코드 포함 | 엔트리포인트에서 `upgrade head` 자동 실행 |

---

## 8. PostgreSQL 충돌 방지

```
team-work-manager DB: 해당 앱의 DB명 (예: teamwork)
track-block DB:       track_block
→ 동일 PostgreSQL 컨테이너라도 DB명이 달라 충돌 없음

alembic_version 테이블: 각 DB에 독립 존재 → 마이그레이션 버전 충돌 없음

외부 포트: tbm-db는 외부 5432 미노출 (Docker 내부망만 사용)
→ team-work-manager postgres와 포트 충돌 없음
```

---

## 9. 운영 데이터 백업

```bash
# 전체 백업 (차단명령 포함)
docker exec tbm-db pg_dump -U tbm track_block \
    > /backup/tbm_full_$(date +%Y%m%d_%H%M%S).sql

# 기준데이터만 백업
docker exec tbm-db pg_dump -U tbm track_block --data-only \
    --table=organizations --table=rail_routes --table=rail_stations \
    --table=organization_route_ranges --table=system_settings \
    > /backup/tbm_ref_$(date +%Y%m%d).sql
```

---

## 10. 문제 해결

```bash
cd /opt/track-block-management/install-usb

# 컨테이너 상태
docker compose ps

# 백엔드 로그 (실시간)
docker compose logs -f backend

# 마이그레이션 현재 버전 확인
docker compose exec backend alembic current

# 마이그레이션 수동 실행
docker compose exec backend alembic upgrade head

# 전체 재시작
docker compose restart

# 완전 초기화 (운영 데이터 삭제 주의!)
docker compose down -v
bash install.sh --yes --mode a
```

---

## 11. 파일 구조

```
install-usb/
├── README.md                 ← 이 문서 (AI 최신화 절차 포함)
├── install.sh                ← 서버 원클릭 설치 스크립트 ★
├── .env.template             ← 환경변수 템플릿
├── docker-compose.yml        ← Docker 서비스 정의
├── Dockerfile.backend        ← FastAPI + Alembic
├── Dockerfile.frontend       ← React 빌드 + nginx
├── nginx/
│   ├── app.conf              ← 내부 nginx (API 프록시 + SPA fallback)
│   └── integrated.conf       ← 기존 nginx에 추가할 /track location 블록
├── scripts/
│   ├── prepare-usb.sh        ← Mac에서 USB 준비 자동화 ★
│   ├── restore-seed.sh       ← 기준데이터 DB 복원
│   └── entrypoint.sh         ← 백엔드 컨테이너 시작 (migrate→uvicorn)
└── seed/
    ├── README.md             ← 시드 파일 안내
    └── reference_data_*.sql  ← AI 최신화 시 자동 생성 (git 미포함)
```
