#!/usr/bin/env bash
# Update the backend on the VM:  ./deploy.sh [tunnel|quick]
# Pulls the latest code from GitHub, rebuilds and restarts. Run it again after each push.
set -euo pipefail
cd "$(dirname "$0")"
PROFILE="${1:-tunnel}"

[ -f backend/.env ] || { echo "Missing backend/.env (copy backend/.env.example and fill it in)"; exit 1; }
if [ "$PROFILE" = "tunnel" ] && ! grep -q '^TUNNEL_TOKEN=.\+' .env 2>/dev/null; then
  echo "Missing TUNNEL_TOKEN in ./.env (see DEPLOY_VM.md), or run: ./deploy.sh quick"; exit 1
fi

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Building and starting ($PROFILE)"
docker compose --profile "$PROFILE" up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "==> Waiting for the API to become healthy"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health 2>/dev/null; then echo; break; fi
  sleep 3
  [ "$i" = 30 ] && { echo "API did not become healthy; check: docker compose logs api"; exit 1; }
done

if [ "$PROFILE" = "quick" ]; then
  echo "==> Temporary public URL (changes whenever the tunnel restarts):"
  sleep 5; docker compose logs quick-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
fi
echo "Deployed commit $(git rev-parse --short HEAD)"
