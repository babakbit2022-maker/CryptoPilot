#!/usr/bin/env bash
set -u
set -o pipefail

APP="/opt/cryptopilot"
BRANCH="appdeploy-vps-transfer-20260919"
URL="http://127.0.0.1:3000/api/market/BTCUSDT?tf=1h&limit=5"

cd "$APP" || exit 1

echo "[1/5] Syncing CryptoPilot..."
git fetch origin "$BRANCH" >/dev/null 2>&1 || { echo "git fetch failed"; exit 1; }
git checkout "$BRANCH" >/dev/null 2>&1 || { echo "branch checkout failed"; exit 1; }
git reset --hard "origin/$BRANCH" >/dev/null 2>&1 || { echo "git reset failed"; exit 1; }

echo "[2/5] Checking dependencies..."
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund || exit 1
fi

echo "[3/5] Validating server.js..."
node --check server.js || exit 1

echo "[4/5] Restarting CryptoPilot safely..."
pids="$(pgrep -f 'node server.js' || true)"
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null || true
  sleep 3
fi

# If no supervisor brings it back, start one managed process ourselves.
if ! pgrep -f 'node server.js' >/dev/null 2>&1; then
  nohup npm start >/var/log/cryptopilot.log 2>&1 &
  sleep 4
fi

echo "[5/5] Testing live API..."
if curl -fsS --max-time 20 "$URL" | head -c 600; then
  echo
  echo "CRYPTO_PILOT_OK"
else
  echo
  echo "API did not answer. Last server log:"
  tail -n 40 /var/log/cryptopilot.log 2>/dev/null || true
  exit 2
fi
