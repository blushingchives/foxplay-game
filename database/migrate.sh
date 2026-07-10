#!/usr/bin/env bash
# Applies pending migrations from database/migrations via dbmate.
#
#   bash migrate.sh           # dbmate up
#   bash migrate.sh status    # any dbmate subcommand
#
# The server runs this automatically from deploy.sh; use it locally after
# writing a new migration, then run generate.sh to refresh the types.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ -z "${DATABASE_URL:-}" ]; then
    for f in .env ../frontend/.env.local ../metrics/.env; do
        if [ -f "$f" ]; then
            line="$(grep -m1 '^DATABASE_URL=' "$f" || true)"
            if [ -n "$line" ]; then
                export "$line"
                break
            fi
        fi
    done
fi
if [ -z "${DATABASE_URL:-}" ]; then
    echo "error: DATABASE_URL not set (env, database/.env, frontend/.env.local, or metrics/.env)" >&2
    exit 1
fi

export DBMATE_MIGRATIONS_DIR="$PWD/migrations"
export DBMATE_NO_DUMP_SCHEMA=true

if [ $# -eq 0 ]; then
    set -- up
fi

if command -v dbmate >/dev/null 2>&1; then
    exec dbmate "$@"
else
    # local dev fallback — the npm wrapper downloads the dbmate binary
    exec npx --yes dbmate "$@"
fi
