#!/usr/bin/env bash
# Builds the ZIP to upload to the Chrome Web Store.
#
# Whitelist, not blacklist: only the files the extension actually needs are
# packaged. A blacklist silently ships whatever it forgets to exclude — .git,
# screenshots, editor leftovers — and those end up public in the store listing.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null \
          || python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="$ROOT/build/wa-voice-transcribe-$VERSION.zip"

FILES=(
  manifest.json
  inject.js
  content.js
  background.js
  providers.js
  settings.js
  options.html
  options.js
  styles.css
  LICENSE
)
DIRS=(icons _locales)

echo "Packaging version $VERSION"

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "  missing file: $f" >&2; exit 1; }
done
for d in "${DIRS[@]}"; do
  [ -d "$d" ] || { echo "  missing directory: $d" >&2; exit 1; }
done

# Fail early rather than have the store reject the upload.
python3 scripts/preflight.py "${FILES[@]}"

rm -rf build && mkdir -p build
zip -q -r "$OUT" "${FILES[@]}" "${DIRS[@]}" -x '*.DS_Store'

echo "  wrote ${OUT#$ROOT/} ($(du -h "$OUT" | cut -f1))"
# `head -n -N` is GNU-only; awk keeps this portable to the BSD tools on macOS.
unzip -l "$OUT" | awk 'NR>3 && $4 != "" && $1 != "----" { print "    " $4 }'
