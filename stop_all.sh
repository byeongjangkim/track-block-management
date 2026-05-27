#!/bin/bash

echo "🛑 서버 종료 중..."

if [ -f /tmp/backend.pid ]; then
  kill -9 "$(cat /tmp/backend.pid)" 2>/dev/null
  rm -f /tmp/backend.pid
fi

if [ -f /tmp/frontend.pid ]; then
  kill -9 "$(cat /tmp/frontend.pid)" 2>/dev/null
  rm -f /tmp/frontend.pid
fi

lsof -ti:7000 | xargs kill -9 2>/dev/null
lsof -ti:7001 | xargs kill -9 2>/dev/null

echo "✅ 종료 완료"