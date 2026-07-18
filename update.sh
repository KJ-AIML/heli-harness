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

# v0.5.5: Preserve local overlays by default.
# Packaged defaults update; user-owned overlays survive.
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
	echo "Preserved local overlays: profiles/, workspace/, policies/, safety/, state/."
	echo "Use --reset-state to replace state/ from the repo checkout."
else
	echo "Preserved local overlays: profiles/, workspace/, policies/, safety/."
	echo "state/ was replaced from the repo checkout (--reset-state)."
fi
echo "AGENTS.md and CLAUDE.md were not modified."
echo "Workspace mode is preserved: update does NOT flip legacy to concurrent."
echo "Parallel agents: heli task migrate-legacy --id <id> then claim write + HELI_SESSION_ID (skill concurrent-upgrade)."
echo ""
echo "Host plugin refresh (workspace update does not upgrade host marketplaces/plugins):"
echo "  - Codex (Git marketplace): codex plugin marketplace upgrade heli-harness"
echo "  - Codex (switch from local to Git once):"
echo "      codex plugin remove heli-harness@heli-harness"
echo "      codex plugin marketplace remove heli-harness"
echo "      codex plugin marketplace add KJ-AIML/heli-harness"
echo "      codex plugin add heli-harness@heli-harness"
echo "  - Claude: claude plugin install .heli-harness/adapters/claude-plugin"
echo "  - Grok:   node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs"
echo "See INSTALL.md for host-specific details."
