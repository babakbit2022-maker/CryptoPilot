#!/usr/bin/env bash
set -u
set -o pipefail

APP="/opt/cryptopilot"
BRANCH="appdeploy-vps-transfer-20260919"
URL="http://127.0.0.1:3000/api/health"

cd "$APP" || exit 1

echo "[1/5] Syncing CryptoPilot..."
git fetch origin "$BRANCH" >/dev/null 2>&1 || { echo "git fetch failed"; exit 1; }
git checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null 2>&1 || { echo "branch checkout failed"; exit 1; }
git reset --hard "origin/$BRANCH" >/dev/null 2>&1 || { echo "git reset failed"; exit 1; }

echo "[2/5] Checking dependencies..."
npm install --omit=dev --no-audit --no-fund || exit 1

echo "[3/5] Validating application..."
node --check server.js || exit 1
node --check bootstrap.js || exit 1

echo "[4/5] Restarting CryptoPilot safely..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrRestart ecosystem.config.cjs --env production || exit 1
  pm2 save || exit 1
else
  pkill -f "node bootstrap.js" 2>/dev/null || true
  nohup node bootstrap.js >/var/log/cryptopilot.log 2>&1 &
  sleep 4
fi

echo "[5/5] Testing live API..."
if curl -fsS --max-time 20 "$URL" | head -c 600; then
  echo
  echo "CRYPTO_PILOT_OK"
else
  echo
  echo "API did not answer. Last server log:"
  tail -n 60 /var/log/cryptopilot.log 2>/dev/null || true
  exit 2
fi
