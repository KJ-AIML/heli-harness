#!/usr/bin/env bash
set -euo pipefail

PARENT="${1:-$(pwd)}"
PARENT_FULL="$(cd "$PARENT" && pwd)"
TARGET="$PARENT_FULL/.heli-harness"

if [ ! -d "$TARGET" ]; then
	echo "No installed harness found at $TARGET"
	exit 0
fi

rm -rf "$TARGET"

cat <<EOF
Removed Heli-Harness:
  $TARGET

Manual cleanup:
  Review any AGENTS.md or CLAUDE.md snippets you created and remove them if no longer needed.
  Repos were not deleted.
EOF
