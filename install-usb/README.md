# 선로차단작업 관리 — Ubuntu 서버 배포 가이드

> **대상 환경**: Ubuntu 서버, Docker Compose, team-work-manager 동일 IP 공존

---

## 0. 사전 요구사항 (서버)

```bash
# Docker 엔진 설치 (Ubuntu 22.04/24.04)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 재로그인 필요

# Docker Compose V2 확인
docker compose version   # v2.x 이상

# 포트 방화벽 (모드 A만 필요)
sudo ufw allow 8080/tcp
```

---

## 1. 배포 모드 선택

| 항목 | 모드 A (독립 포트 / 권장) | 모드 B (nginx 경로 통합) |
|---|---|---|
| **접속 주소** | `http://10.10.10.10:8080` | `http://10.10.10.10/track` |
| **포트 충돌** | 없음 (8080 사용) | 없음 (80 공유, 경로 구분) |
| **team-work-manager 수정** | **불필요** | nginx 설정 추가 필요 |
| **설정 난이도** | ★☆☆ 단순 | ★★☆ 중간 |
| **HTTPS** | 별도 SSL 설정 필요 | 기존 nginx SSL 공유 가능 |
| **권장 상황** | 초기 배포 / 빠른 테스트 | HTTPS URL 통일 필요 시 |

---

## 2. USB 준비 (Mac에서)

```bash
cd <프로젝트루트>

# 기준데이터 최신 덤프 생성
bash backend/scripts/dump_reference_data.sh

# 최신 덤프를 seed 폴더로 복사
LATEST=$(ls -t backend/scripts/dumps/reference_data_*.sql | head -1)
cp "$LATEST" install-usb/seed/

# USB로 전체 프로젝트 복사 (node_modules 제외)
rsync -av --exclude='node_modules' --exclude='__pycache__' \
          --exclude='.git' --exclude='*.pyc' \
          . /Volumes/<USB드라이브>/track-block-management/
```

---

## 3. 서버 설치 절차

### 3-1. USB에서 서버로 복사

```bash
# USB를 서버에 마운트 후
sudo mkdir -p /opt/track-block-management
sudo cp -r /media/<USB마운트>/track-block-management/. /opt/track-block-management/
sudo chown -R $USER:$USER /opt/track-block-management

cd /opt/track-block-management/install-usb
```

### 3-2. 환경변수 설정

```bash
cp .env.template .env
nano .env    # 또는 vi .env
```

**반드시 변경할 값**:

```bash
DB_PASSWORD=안전한비밀번호입력       # DB 비밀번호
SECRET_KEY=$(openssl rand -hex 32)  # JWT 서명키

# 모드 A:
EXPOSE_PORT=8080
VITE_API_URL=http://10.10.10.10:8080   # 실제 서버 IP로 변경!

# 모드 B:
# EXPOSE_PORT=                          # 비워두기
# VITE_BASE_PATH=/track/
# VITE_API_URL=                         # 비워두기 (상대경로 사용)
```

### 3-3. 배포 실행

```bash
# 모드 A (독립 포트)
bash scripts/deploy.sh --mode a --seed

# 모드 B (nginx 통합)
bash scripts/deploy.sh --mode b --seed
```

---

## 4. 기준데이터 복원 (--seed 포함 시 자동)

```bash
# 수동 실행 시
bash scripts/restore-seed.sh
```

복원 내용:
- 시군구 배경 지도 (rail_computed_geometry)
- 전국 153개 노선 + 역/KP/시설물
- 14개 조직 + 관할구간
- 시스템 설정 (색상 22개 + 지도설정 2개)

> **사용자 데이터는 복원하지 않습니다.** 배포 완료 후 관리자 계정으로 로그인하면 됩니다.
>
> 기본 계정: `admin@korail.com` / `korail7788!` (배포 후 반드시 변경)

---

## 5. 모드 B 추가 작업 (nginx 통합)

모드 B 선택 시 기존 team-work-manager nginx에 설정을 추가해야 합니다.

### 5-1. Docker 네트워크 연결

```bash
# tbm-net과 기존 nginx가 통신할 수 있도록 연결
docker network connect tbm-net <기존_nginx_컨테이너명>

# 컨테이너명 확인 방법
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
```

### 5-2. nginx 설정 추가

```bash
# 방법 1: 기존 nginx 컨테이너에 직접 복사
docker cp nginx/integrated.conf <nginx_컨테이너명>:/etc/nginx/conf.d/track.conf
docker exec <nginx_컨테이너명> nginx -t
docker exec <nginx_컨테이너명> nginx -s reload

# 방법 2: volume mount 방식 (nginx conf.d 폴더에 직접 복사)
# nginx 컨테이너의 conf.d 볼륨 경로 확인 후 복사
```

---

## 6. 업데이트 배포 (코드 변경 시)

```bash
cd /opt/track-block-management/install-usb

# 코드 업데이트 후 재빌드
git pull   # 또는 USB에서 새 버전 복사

# 무중단 업데이트 (데이터 보존, Alembic 자동 마이그레이션)
bash scripts/deploy.sh --mode a --update
```

---

## 7. PostgreSQL 데이터 충돌 방지

team-work-manager와 PostgreSQL DB가 **같은 컨테이너**인 경우:

```bash
# 두 앱의 DB명이 다른지 확인
# track-block: track_block
# team-work-manager: 해당 앱의 DB명 (충돌 없음)

# alembic_version 테이블은 각 DB에 독립적으로 존재 → 버전 충돌 없음
```

team-work-manager와 **포트 5432가 겹치는 경우**:

```bash
# docker-compose.yml에서 db 서비스 포트 외부 노출 없음 (내부 네트워크만)
# → 포트 충돌 없음 (tbm-db는 외부 5432 사용 안 함)
```

---

## 8. 운영 데이터 백업 (정기 실행 권장)

```bash
# 운영 데이터 백업 (block_orders, users, projects 포함)
docker exec tbm-db pg_dump -U ${DB_USER:-tbm} track_block \
    > backup_$(date +%Y%m%d_%H%M%S).sql

# 기준데이터만 백업
docker exec tbm-db pg_dump -U ${DB_USER:-tbm} track_block \
    --data-only \
    --table=organizations --table=rail_routes --table=rail_stations \
    --table=organization_route_ranges --table=system_settings \
    > ref_backup_$(date +%Y%m%d).sql
```

---

## 9. 문제 해결

```bash
# 컨테이너 상태 확인
docker compose -f docker-compose.yml ps

# 백엔드 로그
docker compose -f docker-compose.yml logs -f backend

# DB 로그
docker compose -f docker-compose.yml logs -f db

# 마이그레이션 상태 확인
docker compose -f docker-compose.yml exec backend alembic current

# 마이그레이션 수동 실행
docker compose -f docker-compose.yml exec backend alembic upgrade head

# 컨테이너 전체 재시작
docker compose -f docker-compose.yml restart

# 완전 초기화 (데이터 삭제 주의!)
docker compose -f docker-compose.yml down -v
bash scripts/deploy.sh --mode a --seed
```

---

## 10. 파일 구조

```
install-usb/
├── README.md                 ← 이 문서
├── .env.template             ← 환경변수 템플릿
├── docker-compose.yml        ← Docker 서비스 정의
├── Dockerfile.backend        ← FastAPI + Alembic
├── Dockerfile.frontend       ← React 빌드 + nginx
├── nginx/
│   ├── app.conf              ← 내부 nginx 설정 (API 프록시 + SPA)
│   └── integrated.conf       ← 기존 nginx에 추가할 location 블록
├── scripts/
│   ├── deploy.sh             ← 전체 배포 자동화
│   ├── restore-seed.sh       ← 기준데이터 복원
│   └── entrypoint.sh         ← 백엔드 컨테이너 시작스크립트
└── seed/
    ├── README.md             ← 시드 파일 안내
    └── reference_data_*.sql  ← (USB 준비 시 직접 복사)
```
