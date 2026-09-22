#!/usr/bin/env bash
set -u
APP_DIR="/opt/cryptopilot"
OUT="/tmp/cryptopilot-guardian-diagnostics"
mkdir -p "$OUT"
cd "$APP_DIR" || exit 1
{
  echo "=== TIME ==="; date -u
  echo "=== GIT ==="; git rev-parse HEAD 2>&1 || true; git status --short 2>&1 || true
  echo "=== PM2 ==="; pm2 status 2>&1 || true; pm2 describe cryptopilot 2>&1 || true
  echo "=== HEALTH ==="; curl -sS --max-time 15 http://127.0.0.1:3000/api/health 2>&1 || true
  echo; echo "=== READY ==="; curl -sS --max-time 15 http://127.0.0.1:3000/api/ready 2>&1 || true
  echo; echo "=== DISK ==="; df -h / 2>&1 || true
  echo "=== MEMORY ==="; free -h 2>&1 || true
  echo "=== LOG TAIL ==="; pm2 logs cryptopilot --lines 120 --nostream 2>&1 || true
  echo "=== NGINX ==="; nginx -t 2>&1 || true
  echo "=== LISTENERS ==="; ss -ltnp 2>&1 | grep -E ':(80|443|3000)\\b' || true
} > "$OUT/report.txt"
cat "$OUT/report.txt"
