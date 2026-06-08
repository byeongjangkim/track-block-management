#!/bin/bash
# 기준데이터 복원 — Docker 컨테이너 DB에 seed/*.sql 파일을 적용
# 사용: bash scripts/restore-seed.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEED_DIR="$SCRIPT_DIR/../seed"

# .env 로드
ENV_FILE="$SCRIPT_DIR/../.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env 파일이 없습니다. .env.template을 복사해 설정하세요."
    exit 1
fi
source "$ENV_FILE"

DB_USER="${DB_USER:-tbm}"
DB_NAME="track_block"
CONTAINER="tbm-db"

# SQL 파일 찾기
SQL_FILE=$(ls "$SEED_DIR"/reference_data_*.sql 2>/dev/null | sort | tail -1)
if [ -z "$SQL_FILE" ]; then
    echo "ERROR: seed/ 폴더에 reference_data_*.sql 파일이 없습니다."
    echo "       backend/scripts/dump_reference_data.sh 로 덤프 후 seed/ 에 복사하세요."
    exit 1
fi

echo "=== 기준데이터 복원 ==="
echo "파일: $SQL_FILE"
echo "대상 DB: $DB_NAME @ $CONTAINER"
echo ""

# 컨테이너 실행 중인지 확인
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "ERROR: $CONTAINER 컨테이너가 실행 중이지 않습니다."
    echo "       먼저 'docker-compose up -d db' 를 실행하세요."
    exit 1
fi

echo "복원 중..."
docker exec -i "$CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" \
    --set ON_ERROR_STOP=off \
    < "$SQL_FILE"

echo ""
echo "완료: 기준데이터 복원이 완료되었습니다."
