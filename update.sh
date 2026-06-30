#!/usr/bin/env bash
set -euo pipefail

RESET_STATE=0
PARENT=""

for arg in "$@"; do
	case "$arg" in
	--reset-state) RESET_STATE=1 ;;
	*) PARENT="$arg" ;;
	esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.heli-harness/HARNESS.md" ]; then
	SOURCE="$SCRIPT_DIR/.heli-harness"
elif [ -f "$(pwd)/.heli-harness/HARNESS.md" ] && [ -f "$(pwd)/install.sh" ]; then
	SOURCE="$(pwd)/.heli-harness"
else
	echo "No local repository checkout with .heli-harness was found." >&2
	echo "Update by cloning or entering the repo checkout, running git pull, then:" >&2
	echo "  ./update.sh <parent-workspace>" >&2
	exit 1
fi

if [ -n "$PARENT" ]; then
	PARENT_FULL="$(cd "$PARENT" && pwd)"
	TARGET="$PARENT_FULL/.heli-harness"
else
	CWD="$(pwd)"
	if [ "$(basename "$CWD")" = ".heli-harness" ] || [ -f "$CWD/HARNESS.md" ]; then
		TARGET="$CWD"
	else
		TARGET="$CWD/.heli-harness"
	fi
fi

if [ ! -d "$TARGET" ]; then
	echo "Target harness does not exist: $TARGET. Run install.sh first." >&2
	exit 1
fi

PRESERVE_DIRS=(profiles workspace policies safety)
if [ "$RESET_STATE" -eq 0 ]; then
	PRESERVE_DIRS+=(state)
fi

TMP_PRESERVE="$(mktemp -d)"
for dir in "${PRESERVE_DIRS[@]}"; do
	if [ -d "$TARGET/$dir" ]; then
		cp -R "$TARGET/$dir" "$TMP_PRESERVE/$dir"
	fi
done

cp -R "$SOURCE"/. "$TARGET"/

for dir in "${PRESERVE_DIRS[@]}"; do
	if [ -d "$TMP_PRESERVE/$dir" ]; then
		rm -rf "$TARGET/$dir"
		cp -R "$TMP_PRESERVE/$dir" "$TARGET/$dir"
	fi
done
rm -rf "$TMP_PRESERVE"

echo "Updated Heli-Harness at $TARGET"
if [ "$RESET_STATE" -eq 0 ]; then
	echo "Preserved state/. Use --reset-state to replace state from the repo checkout."
fi
echo "Preserved local profiles/, workspace/, policies/, and safety/ overlays."
echo "AGENTS.md and CLAUDE.md were not modified."
