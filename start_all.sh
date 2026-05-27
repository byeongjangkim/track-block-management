#!/bin/bash

BASE_DIR="/Users/byeongjangkim/MyProjects/Track-Block-Management"

echo "🚀 서버 시작 중..."

# 기존 포트 사용 프로세스 정리
lsof -ti:7000 | xargs kill -9 2>/dev/null
lsof -ti:7001 | xargs kill -9 2>/dev/null

# =========================
# Backend 시작
# =========================
cd "$BASE_DIR/backend" || exit 1

nohup "$BASE_DIR/backend/.venv/bin/uvicorn" app.main:app \
  --host 0.0.0.0 \
  --port 7000 \
  --reload > /tmp/backend.log 2>&1 &

BACKEND_PID=$!
echo "$BACKEND_PID" > /tmp/backend.pid
echo "✅ 백엔드 PID: $BACKEND_PID"

# =========================
# Frontend 시작
# =========================
cd "$BASE_DIR/frontend" || exit 1

nohup npm run dev > /tmp/frontend.log 2>&1 &

FRONTEND_PID=$!
echo "$FRONTEND_PID" > /tmp/frontend.pid
echo "✅ 프론트엔드 PID: $FRONTEND_PID"

echo ""
echo "=============================="
echo "백엔드: http://localhost:7000"
echo "API 문서: http://localhost:7000/api/docs"
echo "프론트엔드: http://localhost:7001"
echo "LAN 접속: http://192.168.0.8:7001"
echo ""
echo "로그인 정보"
echo "ID: admin"
echo "PW: admin1234"
echo "=============================="