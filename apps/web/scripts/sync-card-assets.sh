#!/usr/bin/env bash
# Derives web-sized card art from the canonical repository assets.
#
# Source of truth: <repo>/assets/cards/*.png (948x1659 cropped card art, 4:7).
# Output: apps/web/public/cards/*.webp (640px wide, same 4:7 ratio).
# The canonical PNGs are never modified; rerun this script after replacing
# any source card. Requires `cwebp` (brew install webp).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$here/../../../assets/cards"
target_dir="$here/../public/cards"

command -v cwebp >/dev/null || {
  echo "cwebp is required (brew install webp)" >&2
  exit 1
}

mkdir -p "$target_dir"
rm -f "$target_dir"/*.webp
for png in "$source_dir"/*.png; do
  name="$(basename "$png" .png)"
  cwebp -quiet -q 82 -resize 640 0 "$png" -o "$target_dir/$name.webp"
done
echo "Synced $(ls "$target_dir"/*.webp | wc -l | tr -d ' ') card assets into $target_dir"
