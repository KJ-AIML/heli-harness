#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/.heli-harness"
PARENT="${1:-$(pwd)}"
if [ ! -d "$PARENT" ]; then
	echo "ERROR: Parent directory does not exist: $PARENT" >&2
	echo "Create it first or pass an existing directory." >&2
	exit 1
fi
PARENT_FULL="$(cd "$PARENT" && pwd)"
TARGET="$PARENT_FULL/.heli-harness"

if [ ! -d "$SOURCE" ]; then
	echo "Source harness not found: $SOURCE" >&2
	exit 1
fi

mkdir -p "$TARGET"
cp -R "$SOURCE"/. "$TARGET"/

AGENTS_PATH="$PARENT_FULL/AGENTS.md"
CLAUDE_PATH="$PARENT_FULL/CLAUDE.md"
AGENTS_SNIPPET="Read .heli-harness/adapters/codex/AGENTS.md first."
CLAUDE_SNIPPET="Read .heli-harness/adapters/claude/CLAUDE.md first."

if [ -e "$AGENTS_PATH" ]; then
	echo "AGENTS.md already exists at $AGENTS_PATH"
	echo "Append manually if desired:"
	echo "$AGENTS_SNIPPET"
else
	printf '%s\n' "$AGENTS_SNIPPET" >"$AGENTS_PATH"
fi

if [ -e "$CLAUDE_PATH" ]; then
	echo "CLAUDE.md already exists at $CLAUDE_PATH"
	echo "Append manually if desired:"
	echo "$CLAUDE_SNIPPET"
else
	printf '%s\n' "$CLAUDE_SNIPPET" >"$CLAUDE_PATH"
fi

for path in "$TARGET/HARNESS.md" "$TARGET/manifest.json" "$TARGET/skills" "$TARGET/adapters"; do
	if [ ! -e "$path" ]; then
		echo "Install validation failed: missing $path" >&2
		exit 1
	fi
done

cat <<EOF

Heli-Harness installed to:
  $TARGET

Next steps:
  1. Add repo profiles under $TARGET/profiles
  2. Start agents from $PARENT_FULL
  3. Use this first-run prompt:

Start from this parent workspace. Read HARNESS.md, identify the target repo, read its profile if present, then inspect repo-local docs. Update state/current-task.md before non-trivial edits. Task: <describe task>.
EOF
