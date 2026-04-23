#!/bin/bash
set -u

echo "[STOP] track-block-management"

if [ -f /tmp/backend.pid ]; then
  BACKEND_PID="$(cat /tmp/backend.pid)"
  kill -9 "$BACKEND_PID" 2>/dev/null || true
  rm -f /tmp/backend.pid
  echo "[OK] backend stopped: $BACKEND_PID"
else
  echo "[INFO] no backend pid file"
fi

if [ -f /tmp/frontend.pid ]; then
  FRONTEND_PID="$(cat /tmp/frontend.pid)"
  kill -9 "$FRONTEND_PID" 2>/dev/null || true
  rm -f /tmp/frontend.pid
  echo "[OK] frontend stopped: $FRONTEND_PID"
else
  echo "[INFO] no frontend pid file"
fi

lsof -ti tcp:8000 | xargs kill -9 2>/dev/null || true
lsof -ti tcp:5173 | xargs kill -9 2>/dev/null || true

echo "[DONE] stop complete"
