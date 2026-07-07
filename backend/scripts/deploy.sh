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
# 캐시 버스팅 값(빌드 ID). 정적 스크립트는 CDN/브라우저가 오래 캐시하므로
# 배포마다 index.html의 ?v= 값을 바꿔 강제 무효화해야 함.
#
# ⚠️ index.html은 __BUILD__ 리터럴 그대로 웹 루트에 복사한다(치환하지 않음).
#    실제 치환은 nginx sub_filter가 응답 시점에 수행하며, 빌드 ID는 아래에서
#    nginx 설정에만 주입된다. 이렇게 하면 어떤 이유로 원본 index.html이
#    (__BUILD__ 그대로) 웹 루트에 다시 덮어써져도 캐시 버스팅이 깨지지 않는다.
#    (과거: 웹 루트의 index.html이 원본으로 되돌려져 ?v=__BUILD__ 고정 URL이
#     서빙 → CDN이 옛 JS를 계속 캐시하는 사고가 반복됨.)
BUILD_ID="$(date +%s)"
cp "$FRONTEND/index.html"            "$WEB_ROOT/index.html"
cp "$FRONTEND/styles.css"            "$WEB_ROOT/styles.css"
cp "$FRONTEND/js/app.js"             "$WEB_ROOT/js/app.js"
cp "$FRONTEND/js/spot-difference.js" "$WEB_ROOT/js/spot-difference.js"
cp "$FRONTEND/js/vowel-game.js"      "$WEB_ROOT/js/vowel-game.js"
cp "$FRONTEND/js/vowel-multi.js"     "$WEB_ROOT/js/vowel-multi.js"
cp "$FRONTEND/js/spot-multi.js"      "$WEB_ROOT/js/spot-multi.js"

echo "▶ nginx 설정 동기화 & reload (빌드 ID=$BUILD_ID 주입)"
# 빌드 ID는 웹 루트 밖의 nginx 설정에만 존재 → 프론트 파일이 되돌려져도 영향 없음.
sed "s/__BUILDID__/$BUILD_ID/g" "$NGINX_CONF_SRC" > "$NGINX_CONF_DST"
ln -sf "$NGINX_CONF_DST" /etc/nginx/sites-enabled/minigameheaven.conf
nginx -t && systemctl reload nginx

# reload가 실제로 워커에 반영됐는지 검증한다. 과거에 systemctl reload가 조용히
# 실패해 옛 워커가 옛 설정(sub_filter 없음)으로 계속 서빙 → 캐시 버스팅이 통째로
# 무력화된 적이 있음. 새 빌드 ID가 응답에 실제로 주입되는지 확인하고, 안 되면 restart로 강제.
sleep 1
if curl -fs -H "Host: minigameheaven-v1.madcamp-kaist.org" http://127.0.0.1/ | grep -q "?v=$BUILD_ID"; then
  echo "  ✓ nginx reload 반영 확인 (?v=$BUILD_ID 주입됨)"
else
  echo "  ⚠ reload가 반영되지 않음 → nginx restart로 강제 적용"
  systemctl restart nginx
  sleep 1
  curl -fs -H "Host: minigameheaven-v1.madcamp-kaist.org" http://127.0.0.1/ | grep -q "?v=$BUILD_ID" \
    && echo "  ✓ restart 후 반영 확인" \
    || { echo "  ✗ 캐시 버스팅 주입 실패 — nginx 설정을 확인하세요"; exit 1; }
fi

echo "▶ 웹소켓 서버 (재)빌드 & 기동"
# 백엔드는 파일 복사 없이 이미지 자체를 새로 빌드함 — Dockerfile이 backend/src를
# 통째로 COPY하므로 --build가 최신 backend/src 변경사항을 항상 그대로 반영함.
cd "$BACKEND"
docker compose up -d --build

echo "✅ 배포 완료"
