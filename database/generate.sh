#!/usr/bin/env bash
# Regenerates database/typescript and database/go from the live schema.
#
#   bash generate.sh          # write the generated files
#   bash generate.sh --check  # exit 1 if committed output is stale,
#                             # exit 2 if the database is unreachable
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec node codegen.mjs "$@"
