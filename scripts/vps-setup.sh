#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/cryptopilot"
REPO="https://github.com/babakbit2022-maker/CryptoPilot.git"

apt-get update
apt-get install -y git nginx curl

mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin main
  git -C "$APP_DIR" reset --hard origin/main
  git -C "$APP_DIR" clean -fd
fi

cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
npm install -g pm2
pm2 startOrRestart ecosystem.config.cjs --env production
pm2 save

cat >/etc/nginx/sites-available/cryptopilot <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/cryptopilot /etc/nginx/sites-enabled/cryptopilot
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/api/health
echo
echo "CryptoPilot VPS base setup complete."
echo "IMPORTANT: create /opt/cryptopilot/.env with your production secrets before enabling payments."
