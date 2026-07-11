#!/usr/bin/env bash
# Follow the foxplay service logs.
#
# Usage:
#   bash logs.sh              # all services, interleaved
#   bash logs.sh pool         # just one: metrics | artifact | instance | pool
#   LINES=500 bash logs.sh    # more history before following
set -euo pipefail

case "${1:-all}" in
    metrics)                   units=(-u foxplay-metrics) ;;
    artifact|artifact-store)   units=(-u foxplay-artifact-store) ;;
    instance|instance-manager) units=(-u foxplay-instance-manager) ;;
    pool|pool-manager)         units=(-u foxplay-pool-manager) ;;
    all)
        units=(-u foxplay-metrics -u foxplay-artifact-store \
               -u foxplay-instance-manager -u foxplay-pool-manager) ;;
    *)
        echo "usage: bash logs.sh [metrics|artifact|instance|pool]" >&2
        exit 1
        ;;
esac

exec journalctl "${units[@]}" -n "${LINES:-100}" -f
