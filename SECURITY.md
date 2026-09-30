# Security Policy

## Install Scripts

Inspect `install.ps1`, `install.sh`, `update.ps1`, `update.sh`, `uninstall.ps1`, and `uninstall.sh` before running them. They are intended to copy harness files and manage only the harness install directory.

## Hooks

Hooks are optional. No destructive hook should be enabled without explicit user review and consent.

Where a compatible host loads the bundled PreToolUse hook, Heli:

- **fails closed** — when the hook cannot evaluate a call (unreadable input, broken workspace state, an internal error) it denies the call and points to `heli doctor`, instead of crashing (hosts treat a crashed or timed-out hook as "allow"). PreToolUse hook timeouts are 30 seconds;
- **evaluates every command rule** — any T6 match is a hard deny that scoped grants, YOLO and `HELI_ALLOW_COMMAND` cannot override, and each matched T5 rule needs its own approval. A built-in T6 floor applies even when `safety/command-rules.json` is empty, and a missing or unreadable rules file denies shell commands until it is restored;
- **protects itself** — agent-run `heli grant issue`, `heli yolo on`, task takeovers, write transfers and Heli removal are hard-denied, and `heli grant issue` / `heli yolo on` refuse to run without an interactive terminal. Agents cannot write Heli's authority state (task, session, lock, binding, YOLO and workspace records, `~/.heli`, Heli-installed host hooks) or switch Claude Code hooks off;
- denies remote Git pushes, `.env`-style writes and writes while task state is stuck or target-mismatched unless a human approved them.

The command tiers in `.heli-harness/safety/command-tiers.md` remain the policy reference. Hooks are guardrails, **not a sandbox**: command parsing is best-effort, and an agent that can run arbitrary code (for example a script that calls Heli's library directly) can still work around them. Pair Heli with host permissions and an OS-level sandbox for untrusted work.

## Cloud Sync

Cloud sync is experimental and optional. Pulls refuse plaintext when end-to-end encryption is on, refuse rollbacks and relabeled bundles, and never apply `safety/`, `policies/` or task YOLO changes without `--accept-policy-changes`. See `docs/architecture/cloud-sync.md`.

## Reporting a Vulnerability

To report a security issue, open a [GitHub Security Advisory](https://github.com/KJ-AIML/heli-harness/security/advisories/new) in this repository.

Do not open a public issue for security vulnerabilities.

We will acknowledge receipt within 72 hours and aim to ship a fix or mitigation within 14 days for confirmed issues.
