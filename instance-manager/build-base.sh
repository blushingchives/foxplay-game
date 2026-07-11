#!/usr/bin/env bash
# Builds an instance base image into {BASE_IMAGES_DIR}/{name}.ext4 from a
# Containerfile under base/{name}/. Run on the server as root (needs docker
# and mkfs.ext4).
#
#   bash build-base.sh alpine
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

name="${1:-alpine}"
dir="base/$name"
[ -d "$dir" ] || { echo "no base image dir: $dir" >&2; exit 1; }

BASE_IMAGES_DIR="${BASE_IMAGES_DIR:-/var/lib/foxplay/base}"
out="$BASE_IMAGES_DIR/$name.ext4"
size_mb="${SIZE_MB:-512}"

echo "==> building container image foxplay-base-$name"
# docker only auto-detects "Dockerfile"; ours is a Containerfile (repo
# convention, e.g. fabric/), so point at it explicitly.
docker build -t "foxplay-base-$name" -f "$dir/Containerfile" "$dir"

echo "==> exporting rootfs"
cid="$(docker create "foxplay-base-$name")"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
rootfs="$(mktemp -d)"
docker export "$cid" | tar -x -C "$rootfs"

echo "==> writing ext4 ($size_mb MB) to $out"
mkdir -p "$BASE_IMAGES_DIR"
mkfs.ext4 -q -F -d "$rootfs" "$out" "${size_mb}M"
rm -rf "$rootfs"

echo "==> done: $out"
