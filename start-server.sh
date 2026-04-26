#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
PORT="${TODO_SERVER_PORT:-8081}"
RUNTIME_DIR="dist/runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"
AUTH_FILE="data/auth.json"

if ! command -v npm >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install node
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nodejs npm
  else
    echo "npm is required. Install Node.js and npm first."
    exit 1
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not available after installation attempt."
  exit 1
fi

check_required_modules() {
  node -e "const required = ['@codemirror/state','@codemirror/view','@codemirror/autocomplete','@codemirror/commands','@codemirror/language','@codemirror/lang-markdown','codemirror','markdown-it','highlight.js']; for (const name of required) { try { require.resolve(name); } catch { process.exit(1); } }"
}

if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
else
  if ! node -e "const esbuild = require('esbuild'); esbuild.buildSync({stdin:{contents:'export default 1',resolveDir:process.cwd(),sourcefile:'esbuild-check.js'},write:false,format:'esm'});" >/dev/null 2>&1 || ! check_required_modules >/dev/null 2>&1; then
    rm -rf node_modules
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
  fi
fi

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  sleep 1
fi

if command -v lsof >/dev/null 2>&1; then
  while IFS= read -r EXISTING_PID; do
    [ -z "$EXISTING_PID" ] && continue
    COMMAND_LINE="$(ps -p "$EXISTING_PID" -o command= 2>/dev/null || true)"
    if [[ "$COMMAND_LINE" == *"$ROOT_DIR"* && "$COMMAND_LINE" == *"backend/server.ts"* ]]; then
      kill "$EXISTING_PID"
      sleep 1
    else
      echo "Port ${PORT} is already in use by PID ${EXISTING_PID}: ${COMMAND_LINE}"
      exit 1
    fi
  done < <(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)
fi

npm run build

mkdir -p "$RUNTIME_DIR"

nohup env TODO_SERVER_PORT="$PORT" npm run server > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Server failed to start. Check log: $LOG_FILE"
  exit 1
fi
if command -v lsof >/dev/null 2>&1; then
  LISTEN_PID="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null | head -n 1)"
  if [ -n "$LISTEN_PID" ]; then
    SERVER_PID="$LISTEN_PID"
  fi
fi
echo "$SERVER_PID" > "$PID_FILE"
echo "Server started: PID $SERVER_PID"

# Detect LAN IP
_get_local_ip() {
  local os="$(uname -s 2>/dev/null)"
  local ip=""
  case "$os" in
    Darwin)
      ip="$(ipconfig getifaddr en0 2>/dev/null)"
      [ -z "$ip" ] && ip="$(ipconfig getifaddr en1 2>/dev/null)"
      [ -z "$ip" ] && ip="$(ifconfig 2>/dev/null | awk '/inet /{if($2!="127.0.0.1"){print $2;exit}}')"
      ;;
    Linux)
      ip="$(ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}')"
      [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      ip="$(ipconfig 2>/dev/null | grep -m1 -E 'IPv4|IP Address' | awk -F': ' '{gsub(/[[:space:]]+/,"",$2); print $2}')"
      ;;
  esac
  echo "$ip"
}

LOCAL_IP="$(_get_local_ip)"
PUBLIC_IP="$(curl -s --max-time 4 https://api.ipify.org 2>/dev/null || true)"

echo "  Local  : http://localhost:${PORT}/"
[ -n "$LOCAL_IP"  ] && echo "  LAN    : http://${LOCAL_IP}:${PORT}/"
[ -n "$PUBLIC_IP" ] && echo "  Public : http://${PUBLIC_IP}:${PORT}/"
