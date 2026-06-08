#!/bin/bash
# ============================================================
#  선로차단작업 관리 — Mac USB 준비 스크립트
#  사용: bash install-usb/scripts/prepare-usb.sh [USB_경로]
#
#  수행 작업:
#    1. 기준데이터 덤프 생성 (dump_reference_data.sh)
#    2. 최신 덤프를 install-usb/seed/ 로 복사
#    3. 프로젝트 전체를 USB로 rsync (민감파일·빌드캐시 제외)
#
#  예시:
#    bash install-usb/scripts/prepare-usb.sh /Volumes/MyUSB
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$SCRIPT_DIR/.."
PROJECT_DIR="$INSTALL_DIR/.."
SEED_DIR="$INSTALL_DIR/seed"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}[정보]${NC} $*"; }
success() { echo -e "${GREEN}[완료]${NC} $*"; }
warn()    { echo -e "${YELLOW}[경고]${NC} $*"; }
error()   { echo -e "${RED}[오류]${NC} $*" >&2; }

USB_PATH="${1:-}"

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}   선로차단작업 관리 — USB 준비 스크립트${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""

# ── USB 경로 확인 ─────────────────────────────────────────
if [ -z "$USB_PATH" ]; then
    # /Volumes 에서 마운트된 볼륨 목록 표시
    echo "마운트된 볼륨 목록:"
    ls /Volumes/ | while read -r v; do
        [ "$v" != "Macintosh HD" ] && [ "$v" != "Macintosh HD - Data" ] && \
            echo "  /Volumes/$v"
    done 2>/dev/null || true
    echo ""
    read -rp "USB 경로 입력 (예: /Volumes/MyUSB): " USB_PATH
fi

if [ -z "$USB_PATH" ]; then
    error "USB 경로를 입력하세요."
    exit 1
fi

if [ ! -d "$USB_PATH" ]; then
    error "경로가 존재하지 않습니다: $USB_PATH"
    echo "  USB를 연결하고 Finder에서 마운트 후 다시 시도하세요."
    exit 1
fi

USB_FREE=$(df -h "$USB_PATH" | tail -1 | awk '{print $4}')
info "USB 경로: $USB_PATH (여유 공간: $USB_FREE)"

# ═══════════════════════════════════════════════════════════
# STEP 1. 기준데이터 덤프 생성
# ═══════════════════════════════════════════════════════════
echo ""
info "STEP 1. 기준데이터 덤프 생성"

DUMP_SCRIPT="$PROJECT_DIR/backend/scripts/dump_reference_data.sh"
DUMPS_DIR="$PROJECT_DIR/backend/scripts/dumps"

if [ ! -f "$DUMP_SCRIPT" ]; then
    warn "dump_reference_data.sh 스크립트가 없습니다: $DUMP_SCRIPT"
    warn "기존 덤프 파일을 사용합니다."
else
    # PostgreSQL 서비스 확인
    if ! brew services list 2>/dev/null | grep -q "postgresql.*started"; then
        warn "PostgreSQL 서비스가 실행 중이지 않습니다."
        echo "  'brew services start postgresql@16' 으로 시작 후 다시 실행하세요."
        echo "  또는 기존 덤프 파일이 있다면 계속 진행합니다."
    else
        info "기준데이터 덤프 생성 중..."
        cd "$PROJECT_DIR"
        bash "$DUMP_SCRIPT" && success "덤프 생성 완료" || warn "덤프 생성 실패 (기존 파일 사용)"
        cd "$SCRIPT_DIR"
    fi
fi

# 최신 덤프 파일 찾기
LATEST_DUMP=$(ls "$DUMPS_DIR"/reference_data_*.sql 2>/dev/null | sort | tail -1 || true)
if [ -z "$LATEST_DUMP" ]; then
    error "덤프 파일이 없습니다: $DUMPS_DIR/reference_data_*.sql"
    echo "  'bash backend/scripts/dump_reference_data.sh' 를 직접 실행하세요."
    exit 1
fi

DUMP_SIZE=$(du -sh "$LATEST_DUMP" | cut -f1)
info "사용할 덤프: $(basename "$LATEST_DUMP") ($DUMP_SIZE)"

# ═══════════════════════════════════════════════════════════
# STEP 2. seed/ 폴더 업데이트
# ═══════════════════════════════════════════════════════════
echo ""
info "STEP 2. seed/ 폴더 업데이트"

mkdir -p "$SEED_DIR"

# 기존 .sql 삭제 후 교체
OLD_COUNT=$(ls "$SEED_DIR"/reference_data_*.sql 2>/dev/null | wc -l || echo "0")
if [ "$OLD_COUNT" -gt 0 ]; then
    info "기존 덤프 파일 $OLD_COUNT 개 삭제..."
    rm -f "$SEED_DIR"/reference_data_*.sql
fi

cp "$LATEST_DUMP" "$SEED_DIR/"
success "seed/ 업데이트: $(basename "$LATEST_DUMP")"

# ═══════════════════════════════════════════════════════════
# STEP 3. USB로 rsync
# ═══════════════════════════════════════════════════════════
echo ""
info "STEP 3. USB로 복사 중..."

USB_DEST="$USB_PATH/track-block-management"
mkdir -p "$USB_DEST"

rsync -av --progress \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.venv' \
    --exclude='backend/.env' \
    --exclude='frontend/.env.local' \
    --exclude='backend/scripts/dumps/*.sql' \
    --exclude='.DS_Store' \
    --exclude='install-usb/.env' \
    --exclude='dist' \
    --exclude='.vite' \
    --exclude='*.egg-info' \
    "$PROJECT_DIR/" "$USB_DEST/" \
    2>&1 | tail -20

echo ""
USB_SIZE=$(du -sh "$USB_DEST" | cut -f1)
success "USB 복사 완료: $USB_DEST ($USB_SIZE)"

# ── 완료 ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}   USB 준비 완료!${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""
echo "  복사된 위치: $USB_DEST"
echo ""
echo "  서버 설치 절차:"
echo "    1. USB를 Ubuntu 서버에 연결"
echo "    2. rsync 또는 cp로 /opt/track-block-management/ 복사"
echo "       sudo rsync -av /media/\$USER/<USB이름>/track-block-management/. \\"
echo "            /opt/track-block-management/"
echo "    3. cd /opt/track-block-management/install-usb"
echo "    4. bash install.sh"
echo ""
echo -e "${BOLD}============================================${NC}"
