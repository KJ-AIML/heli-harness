---
name: test-validation
description: Use when bootstrapping or correcting a repo profile, or verifying that a profile's first verification command is safe, correct, and non-mutating.
---

# test-validation

Trigger: "validate the profile", "run the first verification command", "test the safe command", "verify profile correctness", or any mode that involves checking a repo profile against the actual repo.

Scope:

- Read the repo profile to extract the safe audit-only verification command.
- Confirm the command exists in the repo's package files, scripts, or docs.
- Classify the command as safe (read-only), mutating (writes files), or destructive (irreversible).
- Check dependency presence before running commands that need `node_modules` or similar.
- Run the safe command and observe exit code, stdout, and stderr.
- Verify post-run git status to confirm no files were modified.
- Classify failures into well-defined categories.

## Command Classification

Before running any verification command, classify it:

| Class | Flag examples | Risk tier | Allowed in audit-only? |
|-------|--------------|-----------|------------------------|
| **Safe (read-only)** | No write, fix, force, delete, or deploy flags | S0 | Yes |
| **Mutating** | `--write`, `--fix`, format-in-place, auto-correct | S1+ | No — requires explicit gate |
| **Destructive** | `--force`, `rm`, delete, reset, clean, migration, deploy, publish, push | S2/S3 | No — requires user approval |

Do not run mutating commands in audit-only mode.
Commands with flags like `--write`, `--fix`, `--force`, `rm`, delete, reset, clean, migration, deploy, publish, or push require elevated risk handling.

## Dependency Preflight

Before running verification:

- Check whether `node_modules/` or equivalent dependency directory exists.
- If missing, check whether repo docs support dependency hydration.
- Dependency hydration is allowed only when:
  1. Target repo git status is clean.
  2. A lockfile exists (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, etc.).
  3. Repo docs support install commands with `--ignore-scripts` or equivalent no-lifecycle flags.
- Prefer no-lifecycle install commands such as `npm ci --ignore-scripts` when supported.
- If hydration is blocked or fails, stop and report the exact blocker.

## Post-Run Verification

After running any supposedly non-mutating command:

- Run `git -C <repo> status --short` and confirm empty output.
- If git shows modified files, the command was NOT safe. Report the dirty files and reclassify the command.
- If git shows untracked files, report them and assess whether the command generated them.

## Failure Classification

When a verification command fails, classify the failure:

| Failure type | Definition | Example |
|-------------|-----------|---------|
| **Environment failure** | Missing runtime, wrong platform, OS mismatch | Node version too old, missing system library |
| **Dependency failure** | `node_modules/` absent, wrong version, broken install | `npm ci` fails, package not found |
| **Command-selection failure** | Profile references a nonexistent script or wrong flags | Script missing from `package.json` |
| **Profile failure** | Profile is incorrect — wrong command, missing sections, inaccurate docs | First verification command is actually mutating |
| **Code failure** | The command runs but the repo code has errors | Biome lint errors, type-check failures, test failures |
| **Harness failure** | The harness itself is broken or inconsistent | Missing skill file, broken manifest, ENOENT |

## Rules

- Do not edit repo source code during test-validation.
- Do not run mutating commands in audit-only mode.
- Do not trust a commands-is-safe claim without running it and checking post-run git status.
- Always verify post-run status after a supposedly non-mutating command.
- If dependencies are missing, do not install silently — report, get confirmation, then hydrate only when allowed.
- If a command fails, classify the failure before suggesting a fix.
- If the profile is wrong, route to `profile-correction`.

## Output

```text
Command tested:
Classification: safe | mutating | destructive
Preflight: deps present | deps missing → hydrated | deps missing → blocked
Result: PASS | FAIL | BLOCKED
Failure type (if failed): environment | dependency | command-selection | profile | code | harness
Post-run git status: clean | dirty (<files>)
Profile verdict: correct | needs correction (<what>)
Next action:
```
