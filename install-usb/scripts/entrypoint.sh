#!/bin/bash
set -e

echo "=== 선로차단작업 관리 백엔드 시작 ==="
echo "DATABASE_URL: ${DATABASE_URL%%:*}://***@${DATABASE_URL##*@}"

# Alembic 마이그레이션 (신규 배포 시 전체 적용, 업데이트 시 변경분만 적용)
echo "[1/2] Alembic 마이그레이션 실행..."
alembic upgrade head
echo "      완료"

# 서버 시작
echo "[2/2] FastAPI 서버 시작 (포트 7000)..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 7000 \
    --workers 2 \
    --no-access-log
