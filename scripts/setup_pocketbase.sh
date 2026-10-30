#!/usr/bin/env bash
# Downloads the latest PocketBase release for linux/amd64 into ./pocketbase/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p pocketbase
url=$(curl -fsSL https://api.github.com/repos/pocketbase/pocketbase/releases/latest \
  | grep -o '"browser_download_url": *"[^"]*linux_amd64.zip"' | head -1 | cut -d'"' -f4)
echo "Downloading $url"
curl -fsSL "$url" -o pocketbase/pb.zip
unzip -o pocketbase/pb.zip pocketbase -d pocketbase >/dev/null
rm pocketbase/pb.zip
chmod +x pocketbase/pocketbase
pocketbase/pocketbase superuser upsert "${PB_ADMIN_EMAIL:-admin@matelda.local}" "${PB_ADMIN_PASSWORD:-matelda-admin-pw}"
echo "Done. Start with: pocketbase/pocketbase serve --http=0.0.0.0:8090, then run: python scripts/init_pocketbase.py"
