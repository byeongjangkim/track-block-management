#!/bin/bash
# ============================================================
#  선로차단작업 관리 — Ubuntu 서버 원클릭 설치 스크립트
#  사용: bash install.sh [옵션]
#
#  옵션:
#    --mode a       독립 포트 8080 (기본)
#    --mode b       nginx 경로 통합 (/track)
#    --yes          모든 확인 자동 동의 (비대화형)
#    --update       소스 변경 후 재배포 (데이터 보존)
#    --with-seed    기준데이터 복원 포함 (최초 설치 시 권장)
#    --no-seed      기준데이터 복원 건너뜀
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 색상 출력 ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}[정보]${NC} $*"; }
success() { echo -e "${GREEN}[완료]${NC} $*"; }
warn()    { echo -e "${YELLOW}[경고]${NC} $*"; }
error()   { echo -e "${RED}[오류]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}$*${NC}"; }

# ── 옵션 파싱 ──────────────────────────────────────────────
MODE=""
AUTO_YES=false
DO_UPDATE=false
SEED_OPT=""   # "yes" | "no" | "" (미지정)

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)      MODE="$2"; shift 2 ;;
        --yes|-y)    AUTO_YES=true; shift ;;
        --update)    DO_UPDATE=true; shift ;;
        --with-seed) SEED_OPT="yes"; shift ;;
        --no-seed)   SEED_OPT="no"; shift ;;
        --help|-h)
            sed -n '2,12p' "$0" | sed 's/^#  \?//'
            exit 0 ;;
        *)
            error "알 수 없는 옵션: $1"
            echo "사용: bash install.sh [--mode a|b] [--yes] [--update] [--with-seed]"
            exit 1 ;;
    esac
done

confirm() {
    # confirm "메시지" → 동의하면 0, 거부하면 1
    if $AUTO_YES; then return 0; fi
    read -rp "$1 [y/N] " ans
    [[ "${ans,,}" == "y" ]]
}

# ── 제목 배너 ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}   선로차단작업 관리 — 서버 설치 스크립트${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""

cd "$SCRIPT_DIR"

# ═══════════════════════════════════════════════════════════
# STEP 0. Docker 설치 확인
# ═══════════════════════════════════════════════════════════
header "STEP 0. Docker 환경 확인"

check_docker() {
    if ! command -v docker &>/dev/null; then
        warn "Docker가 설치되어 있지 않습니다."
        if confirm "지금 Docker를 설치하시겠습니까? (Ubuntu 22.04/24.04 권장)"; then
            info "Docker 설치 중..."
            sudo apt-get update -q
            sudo apt-get install -y -q ca-certificates curl gnupg lsb-release
            sudo install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
                sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            sudo chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
                sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
            sudo apt-get update -q
            sudo apt-get install -y -q docker-ce docker-ce-cli containerd.io \
                docker-buildx-plugin docker-compose-plugin
            sudo usermod -aG docker "$USER"
            success "Docker 설치 완료. 이 스크립트를 다시 실행하세요."
            echo -e "${YELLOW}  → 'newgrp docker' 또는 재로그인 후: bash install.sh${NC}"
            exit 0
        else
            error "Docker 없이는 설치할 수 없습니다. Docker 설치 후 다시 실행하세요."
            echo "  공식 가이드: https://docs.docker.com/engine/install/ubuntu/"
            exit 1
        fi
    fi

    # Docker Compose V2 확인
    if ! docker compose version &>/dev/null; then
        error "Docker Compose (V2) 플러그인이 필요합니다."
        echo "  sudo apt-get install docker-compose-plugin"
        exit 1
    fi

    # 현재 사용자 권한 확인
    if ! docker info &>/dev/null 2>&1; then
        warn "현재 사용자에게 Docker 실행 권한이 없습니다."
        if confirm "sudo로 계속하시겠습니까?"; then
            DOCKER_CMD="sudo docker"
        else
            error "'sudo usermod -aG docker \$USER' 후 재로그인하세요."
            exit 1
        fi
    else
        DOCKER_CMD="docker"
    fi
}

check_docker
DOCKER_COMPOSE="$DOCKER_CMD compose"
success "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) 준비 완료"

# ═══════════════════════════════════════════════════════════
# STEP 1. 배포 모드 선택
# ═══════════════════════════════════════════════════════════
header "STEP 1. 배포 모드"

if [ -z "$MODE" ] && ! $AUTO_YES; then
    echo "  A) 독립 포트 8080 (권장) — http://서버IP:8080"
    echo "     team-work-manager 수정 불필요, 즉시 사용 가능"
    echo ""
    echo "  B) 경로 통합 /track — http://서버IP/track"
    echo "     기존 nginx에 location 블록 추가 필요"
    echo ""
    read -rp "모드 선택 [A/b]: " mode_input
    MODE="${mode_input:-a}"
fi
MODE="${MODE,,}"  # 소문자 변환
[ "$MODE" = "b" ] || MODE="a"

if [ "$MODE" = "a" ]; then
    info "모드 A 선택: 독립 포트 8080"
else
    info "모드 B 선택: nginx 경로 통합 /track"
fi

# ═══════════════════════════════════════════════════════════
# STEP 2. 환경변수 설정
# ═══════════════════════════════════════════════════════════
header "STEP 2. 환경변수 설정"

ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    info ".env 파일이 없습니다. 새로 생성합니다..."
    cp "$SCRIPT_DIR/.env.template" "$ENV_FILE"

    # 서버 IP 자동 감지
    SERVER_IP=$(hostname -I | awk '{print $1}')

    if $AUTO_YES; then
        # 비대화형: 랜덤 SECRET_KEY 자동 생성, DB_PASSWORD는 오류 처리
        SECRET_KEY=$(openssl rand -hex 32)
        DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
        sed -i "s|CHANGE_THIS_SECRET_KEY_32CHARS_MIN|$SECRET_KEY|g" "$ENV_FILE"
        sed -i "s|CHANGE_THIS_DB_PASSWORD|$DB_PASSWORD|g" "$ENV_FILE"
        if [ "$MODE" = "a" ]; then
            sed -i "s|http://10.10.10.10:8080|http://$SERVER_IP:8080|g" "$ENV_FILE"
        else
            sed -i "s|EXPOSE_PORT=8080|EXPOSE_PORT=|g" "$ENV_FILE"
            sed -i "s|VITE_BASE_PATH=/|VITE_BASE_PATH=/track/|g" "$ENV_FILE"
            sed -i "s|VITE_API_URL=http://10.10.10.10:8080|VITE_API_URL=|g" "$ENV_FILE"
        fi
        warn "자동 생성된 DB 비밀번호: $DB_PASSWORD  (기록해 두세요!)"
    else
        # 대화형 설정
        echo ""
        echo "  서버 IP 감지: $SERVER_IP"
        read -rp "  서버 IP 주소 확인 (Enter=사용, 직접 입력 가능): " input_ip
        SERVER_IP="${input_ip:-$SERVER_IP}"

        read -rp "  DB 비밀번호 (Enter=자동생성): " DB_PASSWORD
        if [ -z "$DB_PASSWORD" ]; then
            DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
            info "자동 생성된 DB 비밀번호: $DB_PASSWORD  (기록해 두세요!)"
        fi

        SECRET_KEY=$(openssl rand -hex 32)
        info "JWT 비밀키 자동 생성 완료"

        sed -i "s|CHANGE_THIS_SECRET_KEY_32CHARS_MIN|$SECRET_KEY|g" "$ENV_FILE"
        sed -i "s|CHANGE_THIS_DB_PASSWORD|$DB_PASSWORD|g" "$ENV_FILE"

        if [ "$MODE" = "a" ]; then
            sed -i "s|http://10.10.10.10:8080|http://$SERVER_IP:8080|g" "$ENV_FILE"
        else
            sed -i "s|EXPOSE_PORT=8080|EXPOSE_PORT=|g" "$ENV_FILE"
            sed -i "s|VITE_BASE_PATH=/|VITE_BASE_PATH=/track/|g" "$ENV_FILE"
            sed -i "s|VITE_API_URL=http://10.10.10.10:8080|VITE_API_URL=|g" "$ENV_FILE"
        fi
    fi
    success ".env 생성 완료"
else
    info "기존 .env 파일 사용"
fi

# .env 검증
# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" = "CHANGE_THIS_DB_PASSWORD" ]; then
    error ".env의 DB_PASSWORD를 설정하세요."
    exit 1
fi
if [ -z "$SECRET_KEY" ] || [ "$SECRET_KEY" = "CHANGE_THIS_SECRET_KEY_32CHARS_MIN" ]; then
    error ".env의 SECRET_KEY를 설정하세요 (openssl rand -hex 32)."
    exit 1
fi
if [ "$MODE" = "a" ] && ([ -z "$VITE_API_URL" ] || [[ "$VITE_API_URL" == *"10.10.10.10"* ]]); then
    warn "VITE_API_URL이 '10.10.10.10'으로 설정되어 있습니다. 실제 서버 IP인지 확인하세요."
    if ! confirm "현재 VITE_API_URL ($VITE_API_URL) 로 계속하시겠습니까?"; then
        error ".env의 VITE_API_URL을 실제 서버 IP로 수정 후 다시 실행하세요."
        exit 1
    fi
fi

success "환경변수 검증 완료"

# ═══════════════════════════════════════════════════════════
# STEP 3. 이미지 빌드
# ═══════════════════════════════════════════════════════════
header "STEP 3. Docker 이미지 빌드"
info "빌드 시작 (최초 실행 시 5~15분 소요)..."

$DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" \
    --env-file "$ENV_FILE" \
    build --progress=plain 2>&1 | \
    grep -E "(Step|RUN|COPY|FROM|Successfully|ERROR|error)" || true

success "이미지 빌드 완료"

# ═══════════════════════════════════════════════════════════
# STEP 4. 컨테이너 시작
# ═══════════════════════════════════════════════════════════
header "STEP 4. 컨테이너 시작"

if $DO_UPDATE; then
    info "업데이트 모드: DB 데이터를 유지하며 재시작..."
    $DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
        up -d --no-deps db
    sleep 3
    $DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
        up -d --no-deps --force-recreate backend
    sleep 5
    $DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
        up -d --no-deps --force-recreate frontend
else
    $DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
        up -d
fi

success "컨테이너 시작 완료"

# ═══════════════════════════════════════════════════════════
# STEP 5. 백엔드 Alembic 마이그레이션 대기
# ═══════════════════════════════════════════════════════════
header "STEP 5. Alembic 마이그레이션 대기"
info "백엔드 컨테이너 준비 대기 중..."

WAIT_SECS=0
until $DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
        exec -T backend python -c "
import psycopg2, os, sys
url = os.environ.get('DATABASE_URL','').replace('+psycopg2','').replace('postgresql+asyncpg','postgresql')
try:
    psycopg2.connect(url); sys.exit(0)
except Exception as e:
    sys.exit(1)
" 2>/dev/null; do
    WAIT_SECS=$((WAIT_SECS + 2))
    if [ $WAIT_SECS -gt 60 ]; then
        error "백엔드가 60초 내에 응답하지 않습니다."
        echo ""
        echo "백엔드 로그:"
        $DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
            logs --tail=30 backend
        exit 1
    fi
    printf "  대기 중... %ds\r" "$WAIT_SECS"
    sleep 2
done

# 마이그레이션 결과 확인
ALEMBIC_HEAD=$($DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
    exec -T backend alembic current 2>/dev/null | tail -1 || echo "확인 불가")
success "마이그레이션 완료: $ALEMBIC_HEAD"

# ═══════════════════════════════════════════════════════════
# STEP 6. 기준데이터 복원
# ═══════════════════════════════════════════════════════════
header "STEP 6. 기준데이터 복원"

SEED_DIR="$SCRIPT_DIR/seed"
SQL_FILE=$(ls "$SEED_DIR"/reference_data_*.sql 2>/dev/null | sort | tail -1 || true)

if [ -n "$SQL_FILE" ]; then
    SEED_SIZE=$(du -sh "$SQL_FILE" | cut -f1)
    info "기준데이터 파일 발견: $(basename "$SQL_FILE") ($SEED_SIZE)"

    # 복원 여부 결정
    DO_SEED=false
    if [ "$SEED_OPT" = "yes" ]; then
        DO_SEED=true
    elif [ "$SEED_OPT" = "no" ]; then
        DO_SEED=false
    elif $DO_UPDATE; then
        warn "업데이트 모드: 기준데이터 복원은 운영 데이터를 덮어씁니다."
        if confirm "기준데이터를 복원하시겠습니까? (운영 데이터가 있으면 건너뜀 권장)"; then
            DO_SEED=true
        fi
    else
        # 최초 설치: 기본 복원
        if confirm "기준데이터(노선·역·시설물·조직 등)를 복원하시겠습니까? (권장)"; then
            DO_SEED=true
        fi
    fi

    if $DO_SEED; then
        info "기준데이터 복원 중 (잠시 기다려 주세요)..."
        $DOCKER_CMD exec -i tbm-db \
            psql -U "${DB_USER:-tbm}" -d track_block \
            --set ON_ERROR_STOP=off \
            < "$SQL_FILE" 2>&1 | \
            grep -v "^SET$\|^--\|^$\|already exists" | tail -20 || true
        success "기준데이터 복원 완료"
    else
        info "기준데이터 복원 건너뜀"
    fi
else
    warn "seed/*.sql 파일이 없습니다. 기준데이터 복원을 건너뜁니다."
    echo "  → Mac에서 'bash install-usb/scripts/prepare-usb.sh' 후 재배포하거나"
    echo "     서버에서 수동으로 'bash scripts/restore-seed.sh'를 실행하세요."
fi

# ═══════════════════════════════════════════════════════════
# STEP 7. 최종 상태 확인
# ═══════════════════════════════════════════════════════════
header "STEP 7. 상태 확인"

echo ""
$DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
    ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# 헬스 체크
sleep 2
BACKEND_UP=false
if curl -sf "http://localhost:7000/api/v1/health" &>/dev/null 2>&1 || \
   $DOCKER_COMPOSE -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" \
       exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://localhost:7000/api/v1/health')" 2>/dev/null; then
    BACKEND_UP=true
fi

# ── 완료 배너 ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}   설치 완료!${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""

if [ "$MODE" = "a" ]; then
    SERVER_IP=$(hostname -I | awk '{print $1}')
    EXPOSE=${EXPOSE_PORT:-8080}
    echo -e "  접속 주소: ${GREEN}http://$SERVER_IP:$EXPOSE${NC}"
else
    SERVER_IP=$(hostname -I | awk '{print $1}')
    echo -e "  접속 주소: ${GREEN}http://$SERVER_IP/track${NC}"
    echo ""
    echo -e "  ${YELLOW}[추가 작업 필요]${NC} nginx에 /track 경로 블록 추가:"
    echo "    docker ps  # 기존 nginx 컨테이너명 확인"
    echo "    docker network connect tbm-net <nginx_컨테이너명>"
    echo "    docker cp nginx/integrated.conf <nginx_컨테이너명>:/etc/nginx/conf.d/track.conf"
    echo "    docker exec <nginx_컨테이너명> nginx -s reload"
fi

echo ""
echo "  기본 계정:"
echo "    시스템 관리자   : admin@korail.com / korail7788!"
echo "    차단명령 관리자 : block_manager / korail7788!"
echo -e "  ${RED}→ 로그인 후 즉시 비밀번호를 변경하세요!${NC}"
echo ""
echo "  유용한 명령:"
echo "    docker compose logs -f backend   # 백엔드 로그"
echo "    docker compose ps                # 컨테이너 상태"
echo "    docker compose restart           # 전체 재시작"
echo ""
echo -e "${BOLD}============================================${NC}"
