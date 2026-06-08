#!/bin/bash
# 선로차단작업 관리 — 전체 배포 스크립트
# 사용: bash scripts/deploy.sh [--mode a|b] [--seed]
#
#   --mode a  : 독립 포트 8080 (기본)
#   --mode b  : 경로 통합 /track (기존 nginx에 통합 필요)
#   --seed    : 기준데이터 복원도 함께 수행
#   --update  : 코드 업데이트 (이미지 재빌드, 무중단)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$SCRIPT_DIR/.."
PROJECT_DIR="$INSTALL_DIR/.."

MODE="a"
DO_SEED=false
DO_UPDATE=false

# 인수 파싱
while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode) MODE="$2"; shift 2 ;;
        --seed) DO_SEED=true; shift ;;
        --update) DO_UPDATE=true; shift ;;
        *) echo "알 수 없는 옵션: $1"; exit 1 ;;
    esac
done

echo "============================================"
echo " 선로차단작업 관리 — 배포 스크립트"
echo " 모드: $([ "$MODE" = "a" ] && echo "A (독립 포트 8080)" || echo "B (nginx /track 통합)")"
echo "============================================"
echo ""

cd "$INSTALL_DIR"

# .env 확인
if [ ! -f ".env" ]; then
    echo "[초기 설정] .env 파일이 없습니다. 템플릿에서 생성..."
    cp .env.template .env
    echo ""
    echo "*** .env 파일을 열어 필수값을 설정하세요 ***"
    echo "    - DB_PASSWORD"
    echo "    - SECRET_KEY (openssl rand -hex 32)"
    if [ "$MODE" = "a" ]; then
        echo "    - VITE_API_URL=http://<서버IP>:8080"
    else
        echo "    - VITE_BASE_PATH=/track/"
        echo "    - EXPOSE_PORT= (빈값)"
    fi
    echo ""
    echo "설정 후 다시 실행하세요: bash scripts/deploy.sh --mode $MODE"
    exit 0
fi

source .env

# 모드별 .env 검증
if [ "$MODE" = "a" ]; then
    if [ -z "$VITE_API_URL" ] || [ "$VITE_API_URL" = "http://10.10.10.10:8080" ]; then
        echo "경고: VITE_API_URL이 실제 서버 IP로 설정되지 않았습니다."
        echo "     현재값: ${VITE_API_URL:-<빈값>}"
        read -p "계속하시겠습니까? [y/N] " -n1 -r; echo
        [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
    fi
fi

if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" = "CHANGE_THIS_DB_PASSWORD" ]; then
    echo "ERROR: .env의 DB_PASSWORD를 설정하세요."
    exit 1
fi

if [ -z "$SECRET_KEY" ] || [ "$SECRET_KEY" = "CHANGE_THIS_SECRET_KEY_32CHARS_MIN" ]; then
    echo "ERROR: .env의 SECRET_KEY를 설정하세요 (openssl rand -hex 32)."
    exit 1
fi

echo "[1/4] Docker 이미지 빌드..."
docker compose -f docker-compose.yml build

echo ""
echo "[2/4] 컨테이너 시작..."
if $DO_UPDATE; then
    # 무중단 업데이트: backend/frontend 순서로 재시작
    docker compose -f docker-compose.yml up -d --no-deps db
    sleep 3
    docker compose -f docker-compose.yml up -d --no-deps backend
    sleep 5
    docker compose -f docker-compose.yml up -d --no-deps frontend
else
    docker compose -f docker-compose.yml up -d
fi

echo ""
echo "[3/4] 백엔드 준비 대기..."
ATTEMPTS=0
until docker compose -f docker-compose.yml exec -T backend python -c "
import sys, psycopg2, os
try:
    psycopg2.connect(os.environ['DATABASE_URL'].replace('+psycopg2',''))
    sys.exit(0)
except: sys.exit(1)
" 2>/dev/null; do
    ATTEMPTS=$((ATTEMPTS+1))
    if [ $ATTEMPTS -gt 30 ]; then
        echo "ERROR: 백엔드가 30초 내에 준비되지 않았습니다."
        docker compose -f docker-compose.yml logs backend
        exit 1
    fi
    echo "  대기 중... ($ATTEMPTS/30)"
    sleep 2
done

echo ""
if $DO_SEED; then
    echo "[4/4] 기준데이터 복원..."
    bash "$SCRIPT_DIR/restore-seed.sh"
else
    echo "[4/4] (기준데이터 복원 건너뜀 — --seed 옵션으로 실행)"
fi

echo ""
echo "============================================"
echo " 배포 완료!"
if [ "$MODE" = "a" ]; then
    echo " 접속 주소: http://$(hostname -I | awk '{print $1}'):${EXPOSE_PORT:-8080}"
else
    echo " 접속 주소: http://$(hostname -I | awk '{print $1}')/track"
    echo ""
    echo " !! 추가 작업 필요 !!"
    echo "    nginx/integrated.conf 내용을 team-work-manager의"
    echo "    nginx 설정에 추가한 뒤 nginx를 reload 하세요."
fi
echo "============================================"
