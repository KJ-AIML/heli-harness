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

TMP_STATE=""
if [ "$RESET_STATE" -eq 0 ] && [ -d "$TARGET/state" ]; then
	TMP_STATE="$(mktemp -d)"
	cp -R "$TARGET/state" "$TMP_STATE/state"
fi

if [ "$RESET_STATE" -eq 1 ]; then
	cp -R "$SOURCE"/. "$TARGET"/
else
	find "$SOURCE" -mindepth 1 -maxdepth 1 ! -name state -exec cp -R {} "$TARGET"/ \;
fi

if [ -n "$TMP_STATE" ]; then
	rm -rf "$TARGET/state"
	cp -R "$TMP_STATE/state" "$TARGET/state"
	rm -rf "$TMP_STATE"
fi

echo "Updated Heli-Harness at $TARGET"
if [ "$RESET_STATE" -eq 0 ]; then
	echo "Preserved state/. Use --reset-state to replace state from the repo checkout."
fi
echo "AGENTS.md and CLAUDE.md were not modified."
