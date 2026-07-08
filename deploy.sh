#!/usr/bin/env bash
# Builds the three Go services (metrics, artifact-store, pool-manager),
# installs/updates their systemd units, and (re)starts them.
#
# Run on the server as root:  bash deploy.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Order matters: metrics first so no events are dropped, pool-manager last
# (its startup cleanup pkills stale firecracker processes).
SERVICES=(metrics artifact-store pool-manager)

if [[ $EUID -ne 0 ]]; then
    echo "error: run as root (needed for systemd and firecracker)" >&2
    exit 1
fi

echo "==> building"
for svc in "${SERVICES[@]}"; do
    cd "$REPO_DIR/$svc"
    # first build of a module with dependencies needs go.sum generated
    if [[ ! -f go.sum ]] && grep -q '^require' go.mod; then
        go mod tidy
    fi
    go build -o "$svc" .
    echo "    built $svc"
done

echo "==> installing systemd units"
for svc in "${SERVICES[@]}"; do
    cat > "/etc/systemd/system/foxplay-$svc.service" <<EOF
[Unit]
Description=Foxplay $svc
After=network.target

[Service]
WorkingDirectory=$REPO_DIR/$svc
ExecStart=$REPO_DIR/$svc/$svc
EnvironmentFile=-$REPO_DIR/$svc/.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload

echo "==> restarting services"
for svc in "${SERVICES[@]}"; do
    systemctl enable "foxplay-$svc.service" >/dev/null
    systemctl restart "foxplay-$svc.service"
    echo "    foxplay-$svc: $(systemctl is-active "foxplay-$svc.service")"
done

echo "==> done"
echo "    status:  systemctl status foxplay-pool-manager"
echo "    logs:    journalctl -u foxplay-pool-manager -f"
