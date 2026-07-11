#!/usr/bin/env bash
# Builds the Go services, installs/updates their systemd units, and
# (re)starts them.
#
# Run on the server as root:  bash deploy.sh
#
# Note: instance base images are built separately and occasionally, not here:
#   bash instance-manager/build-base.sh alpine
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Order matters: metrics first so no events are dropped, pool-manager last
# (its startup cleanup pkills stale firecracker processes).
SERVICES=(metrics artifact-store instance-manager pool-manager)

if [[ $EUID -ne 0 ]]; then
    echo "error: run as root (needed for systemd and firecracker)" >&2
    exit 1
fi

echo "==> applying database migrations"
if [ -z "${DATABASE_URL:-}" ] && [ -f "$REPO_DIR/metrics/.env" ]; then
    line="$(grep -m1 '^DATABASE_URL=' "$REPO_DIR/metrics/.env" || true)"
    [ -n "$line" ] && export "$line"
fi
if [ -n "${DATABASE_URL:-}" ]; then
    if ! command -v dbmate >/dev/null 2>&1; then
        echo "    installing dbmate"
        curl -fsSL -o /usr/local/bin/dbmate \
            https://github.com/amacneil/dbmate/releases/latest/download/dbmate-linux-amd64
        chmod +x /usr/local/bin/dbmate
    fi
    DBMATE_MIGRATIONS_DIR="$REPO_DIR/database/migrations" DBMATE_NO_DUMP_SCHEMA=true dbmate up
else
    echo "    DATABASE_URL not found (metrics/.env) — skipping migrations"
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
    # KillMode=process keeps the instance-manager's long-lived VMs alive
    # across a manager restart (it re-adopts them on startup). The default
    # (control-group) would kill the child firecracker processes.
    kill_mode="control-group"
    [ "$svc" = "instance-manager" ] && kill_mode="process"
    cat > "/etc/systemd/system/foxplay-$svc.service" <<EOF
[Unit]
Description=Foxplay $svc
After=network.target

[Service]
WorkingDirectory=$REPO_DIR/$svc
ExecStart=$REPO_DIR/$svc/$svc
EnvironmentFile=-$REPO_DIR/$svc/.env
KillMode=$kill_mode
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
