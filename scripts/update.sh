#!/usr/bin/env bash
# Rebuild everything from a new Abbott compatibility PDF.
#   scripts/update.sh https://freestyleserver.com/Payloads/IFU/2026/q4/ART39109-001_rev-XX-pub.pdf
set -euo pipefail
cd "$(dirname "$0")/.."

url="${1:?usage: scripts/update.sh <compatibility PDF url>}"
pdf="data/raw/$(basename "$url" | sed 's/-pub\.pdf$/.pdf/')"

[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip -q install -r requirements.txt; }

mkdir -p data/raw
curl -fsSL -o "$pdf" "$url"
curl -fsSL -o data/raw/supported_devices.csv https://storage.googleapis.com/play_public/supported_devices.csv

cp data/compatibility.json data/compatibility.prev.json 2>/dev/null || true
.venv/bin/python scripts/parse_compat.py "$pdf" --url "$url"
.venv/bin/python scripts/build_android_models.py

if [ -f data/compatibility.prev.json ]; then
  echo; echo "== 與上一版相比 =="
  .venv/bin/python scripts/diff_compat.py data/compatibility.prev.json data/compatibility.json
  rm data/compatibility.prev.json
fi

# The web page reads its own copy so web/ can be deployed on its own.
cp data/compatibility.json data/android-models.json web/data/
