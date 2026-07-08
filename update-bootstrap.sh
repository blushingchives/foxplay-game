#!/usr/bin/env bash
# Rebuilds the VM bootstrap, installs it into the base rootfs, and stamps a
# version file ({BASE_ROOTFS}.version) that the artifact-store records with
# every deployment.
#
# Run on the server as root:  bash update-bootstrap.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_ROOTFS="${BASE_ROOTFS:-/var/lib/foxplay/node22.ext4}"

if [[ $EUID -ne 0 ]]; then
    echo "error: run as root (mount + systemd)" >&2
    exit 1
fi
if [[ ! -f "$BASE_ROOTFS" ]]; then
    echo "error: base rootfs not found at $BASE_ROOTFS (set BASE_ROOTFS=...)" >&2
    exit 1
fi

echo "==> building bootstrap"
cd "$REPO_DIR/pool-manager/bootstrap"
CGO_ENABLED=0 go build -o bootstrap .
version="$(git -C "$REPO_DIR" rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)"

echo "==> stopping services so nothing holds the image open"
systemctl stop foxplay-pool-manager foxplay-artifact-store 2>/dev/null || true
pkill -f 'firecracker --api-sock' || true

echo "==> installing bootstrap into $BASE_ROOTFS"
mount_dir="$(mktemp -d)"
mount -o loop "$BASE_ROOTFS" "$mount_dir"
cp bootstrap "$mount_dir/var/runtime/bootstrap"
chmod +x "$mount_dir/var/runtime/bootstrap"
umount "$mount_dir"
rmdir "$mount_dir"

# belt and braces: guests mount this read-only and cannot replay a journal
e2fsck -f -p "$BASE_ROOTFS" || true

echo "$version" > "$BASE_ROOTFS.version"

echo "==> restarting services"
systemctl start foxplay-artifact-store foxplay-pool-manager 2>/dev/null || true

echo "==> done: bootstrap $version"
echo "    existing snapshots are now stale (base image changed) and will cold"
echo "    boot — re-deploy functions to regenerate them with the new bootstrap."
