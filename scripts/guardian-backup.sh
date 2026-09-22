#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/cryptopilot"
BACKUP_DIR="/opt/cryptopilot-backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

CURRENT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
if [ -n "$CURRENT_SHA" ]; then
  git archive --format=tar.gz --prefix="cryptopilot-$CURRENT_SHA/" "$CURRENT_SHA" > "$BACKUP_DIR/source-$STAMP-$CURRENT_SHA.tar.gz"
fi

if [ -f /etc/cryptopilot.env ]; then
  install -m 600 /etc/cryptopilot.env "$BACKUP_DIR/env-$STAMP"
fi

if [ -f cryptopilot.db ]; then
  sqlite3 cryptopilot.db ".backup '$BACKUP_DIR/db-$STAMP.sqlite'" 2>/dev/null || cp -p cryptopilot.db "$BACKUP_DIR/db-$STAMP.sqlite"
fi

find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "BACKUP_OK:$STAMP"
