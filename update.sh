#!/usr/bin/env bash
set -euo pipefail

# Canonical update path: delegate to Node CLI so Bash/PowerShell/Pi share one
# preserve/prune/dogfood-guard implementation (lib/cli/update.mjs).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/bin/heli.mjs" ]; then
	echo "ERROR: bin/heli.mjs not found next to update.sh" >&2
	echo "Update by cloning or entering the repo checkout, running git pull, then:" >&2
	echo "  ./update.sh <parent-workspace>" >&2
	exit 1
fi

exec node "$SCRIPT_DIR/bin/heli.mjs" update "$@"
