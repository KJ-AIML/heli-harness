#!/usr/bin/env bash
set -euo pipefail

# Canonical install path: delegate to Node CLI so Bash/PowerShell/Pi share one seed.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT="${1:-$(pwd)}"
if [ ! -d "$PARENT" ]; then
	echo "ERROR: Parent directory does not exist: $PARENT" >&2
	echo "Create it first or pass an existing directory." >&2
	exit 1
fi

if [ ! -f "$SCRIPT_DIR/bin/heli.mjs" ]; then
	echo "ERROR: bin/heli.mjs not found next to install.sh" >&2
	exit 1
fi

exec node "$SCRIPT_DIR/bin/heli.mjs" install "$PARENT"
