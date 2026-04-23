#!/bin/bash
set -euo pipefail

BASE_DIR="/Users/byeongjangkim/MyProjects/CLAUDE/track-block-management"
BACKEND_DIR="$BASE_DIR/backend"
FRONTEND_DIR="$BASE_DIR/frontend"

echo "[START] track-block-management"

echo "[INFO] 기존 프로세스 정리"
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null || true
lsof -ti tcp:5173 | xargs kill -9 2>/dev/null || true

echo "[INFO] backend 시작"
cd "$BACKEND_DIR" || { echo "[ERROR] backend dir not found: $BACKEND_DIR"; exit 1; }

if [ ! -f ".venv/bin/activate" ]; then
  echo "[ERROR] backend virtualenv not found: $BACKEND_DIR/.venv/bin/activate"
  exit 1
fi

source .venv/bin/activate

nohup .venv/bin/python -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --reload > /tmp/backend.log 2>&1 &

BACKEND_PID=$!
echo "$BACKEND_PID" > /tmp/backend.pid
echo "[OK] backend pid=$BACKEND_PID"

echo "[INFO] frontend 시작"
cd "$FRONTEND_DIR" || { echo "[ERROR] frontend dir not found: $FRONTEND_DIR"; exit 1; }

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm not found in PATH"
  exit 1
fi

nohup npm run dev -- --host 0.0.0.0 > /tmp/frontend.log 2>&1 &

FRONTEND_PID=$!
echo "$FRONTEND_PID" > /tmp/frontend.pid
echo "[OK] frontend pid=$FRONTEND_PID"

echo ""
echo "===== STATUS ====="

# 백엔드: HTTP health check로 실제 응답까지 대기 (최대 20초)
echo -n "[WAIT] backend "
BACKEND_OK=0
for i in $(seq 1 20); do
  if curl -s http://localhost:8000/api/health | grep -q "ok" 2>/dev/null; then
    BACKEND_OK=1
    break
  fi
  echo -n "."
  sleep 1
done
echo ""
if [ "$BACKEND_OK" -eq 1 ]; then
  echo "[OK] backend listening on 8000  (health: ok)"
else
  echo "[WARN] backend not responding after 20s — 로그 확인: /tmp/backend.log"
fi

# 프론트엔드: 포트 바인딩까지 대기 (최대 15초)
echo -n "[WAIT] frontend "
FRONTEND_OK=0
for i in $(seq 1 15); do
  if lsof -i tcp:5173 >/dev/null 2>&1; then
    FRONTEND_OK=1
    break
  fi
  echo -n "."
  sleep 1
done
echo ""
if [ "$FRONTEND_OK" -eq 1 ]; then
  echo "[OK] frontend listening on 5173"
else
  echo "[WARN] frontend not listening after 15s — 로그 확인: /tmp/frontend.log"
fi

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "확인불가")

echo ""
echo "백엔드:     http://localhost:8000"
echo "API 문서:   http://localhost:8000/api/docs"
echo "프론트엔드: http://localhost:5173"
echo "LAN 접속:   http://${LAN_IP}:5173"
echo "로그인 ID:  admin"
echo "로그인 PW:  admin1234"
echo ""
echo "[INFO] backend log:  /tmp/backend.log"
echo "[INFO] frontend log: /tmp/frontend.log"
