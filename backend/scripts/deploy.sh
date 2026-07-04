#!/usr/bin/env bash
# 미니게임천국 배포 스크립트
#   - 프론트(frontend/)를 nginx web root로 복사
#   - 웹소켓 서버 컨테이너 (재)빌드 & 기동
# 사용법: sudo ./backend/scripts/deploy.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$REPO/backend"
FRONTEND="$REPO/frontend"
WEB_ROOT="/var/www/minigameheaven"
NGINX_CONF_SRC="$BACKEND/nginx/minigameheaven.conf"
NGINX_CONF_DST="/etc/nginx/sites-available/minigameheaven.conf"

echo "▶ 프론트엔드 배포 → $WEB_ROOT"
mkdir -p "$WEB_ROOT/js"
cp "$FRONTEND/index.html"            "$WEB_ROOT/index.html"
cp "$FRONTEND/styles.css"            "$WEB_ROOT/styles.css"
cp "$FRONTEND/js/app.js"             "$WEB_ROOT/js/app.js"
cp "$FRONTEND/js/spot-difference.js" "$WEB_ROOT/js/spot-difference.js"

echo "▶ nginx 설정 동기화 & reload"
cp "$NGINX_CONF_SRC" "$NGINX_CONF_DST"
ln -sf "$NGINX_CONF_DST" /etc/nginx/sites-enabled/minigameheaven.conf
nginx -t && systemctl reload nginx

echo "▶ 웹소켓 서버 (재)빌드 & 기동"
cd "$BACKEND"
docker compose up -d --build

echo "✅ 배포 완료"
