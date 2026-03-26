#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PID_FILE="dist/runtime/server.pid"
AUTH_FILE="data/auth.json"
PORT="${TODO_SERVER_PORT:-8081}"
STOPPED_BY_PID=0
STOPPED_BY_PORT=0

if [ ! -f "$PID_FILE" ]; then
  PID_FILE=""
fi

if [ -n "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
echo "Server stopped: PID $PID"
    STOPPED_BY_PID=1
    sleep 1
  else
    echo "Server pid file is stale: PID $PID"
  fi
fi

if command -v lsof >/dev/null 2>&1; then
  PORT_PID="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null | head -n 1)"
  if [ -n "$PORT_PID" ]; then
    kill "$PORT_PID"
    echo "Server stopped by port ${PORT}: PID $PORT_PID"
    STOPPED_BY_PORT=1
  fi
fi

if [ "$STOPPED_BY_PID" -eq 0 ] && [ "$STOPPED_BY_PORT" -eq 0 ]; then
  echo "Server is not running"
fi

rm -f dist/runtime/server.pid
rm -f "$AUTH_FILE"
