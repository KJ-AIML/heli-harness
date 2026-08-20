# Cross-Machine Worktree Restore Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans) when implementing this plan.

**Goal:** Fix GitHub issue #14 so a task restored from cloud sync does not keep the source machine's absolute worktree path as the authoritative target. New and migrated task metadata must resolve against the destination workspace, while ambiguous or non-portable legacy targets are visibly stale instead of being silently guessed.

**Architecture:** Keep the existing task schema version and add optional portable target fields. Workspace-relative paths become the sync authority; existing absolute worktree fields remain local compatibility caches. Push sanitizes those caches out of the bundle, pull reconstructs them for the destination, and status uses the same resolver with live lease/session/binding precedence unchanged.

**Tech Stack:** Node.js 20 ESM, existing Heli v1 task and cloud-bundle formats, Node path/fs APIs, current smoke scripts, generated workspace CLI copies, and the existing plugin-shared synchronization scripts.

**Spec:** Issue #14 reports that restoring a workspace on another machine leaves task.target.worktreePath pointing at the source checkout. The verified reproduction shows packBundle → unpackBundle → writeBundleFiles preserves that path byte-for-byte, and status then falls back to task-metadata when no live coordination record exists. The fix must be safe for existing v1 bundles, deterministic without a source-machine root, and stable if the destination later pushes the restored workspace.

## Global Constraints

- Preserve the existing v1 bundle format and TASK_SCHEMA_VERSION. The new fields are optional and older task files remain readable.
- Treat workspace-relative paths as portable data and absolute paths as local caches only.
- Never infer a destination from a basename alone. Legacy fallback requires one exact, unique workspace-index suffix match.
- Do not import or restore sessions, locks, bindings, target.json, sync.json, or any other machine-local coordination state.
- Keep active lease → writer session → binding → task metadata precedence. A stale task metadata path must never override a live lease or session.
- Do not mutate the live workspace during push normalization. Normalize a copy of each task JSON before it enters the bundle.
- Make pull hashing stable: lastContentSha must be computed from the normalized portable representation, not from destination-specific absolute cache fields.
- Preserve the pre-existing user plan at docs/superpowers/plans/2026-08-20-hook-write-classification.md.
- Do not merge, tag, publish, or edit GitHub issue #14 during implementation validation unless the user separately selects the release handoff.

## Data Contract

Each task target may contain these optional fields:

- workspaceRelativeWorktreePath: POSIX-style path relative to the workspace root, such as repos/demo. The value . represents the workspace root.
- workspaceRelativeRepositoryPath: POSIX-style repository path relative to the workspace root. Prefer the workspace index gitRoot, then path.
- restoreStatus: only present when migration could not safely resolve a legacy target; use { state: "stale", reason: "<stable reason>" }.

The existing fields retain their local/runtime meanings:

- worktreePath is a canonical absolute path for the current machine. It is regenerated from workspaceRelativeWorktreePath after restore and is omitted from outbound bundle task JSON.
- repositoryPath remains the logical path consumed by current target projection code. After restore it is the normalized workspace-relative repository path, not a source-machine absolute path.
- repositoryId remains the identity used to match workspace/index.json entries.

The portable resolver must expose these contracts:

1. workspaceRelativePath(workspaceRoot, value)
   - Accept an absolute path or a path relative to workspaceRoot.
   - Return a normalized POSIX relative path or null when the candidate is outside the workspace, empty, malformed, or escapes through traversal.
   - Resolve existing symlinks before the final containment check so a symlink cannot produce a portable path outside the workspace.

2. resolveWorkspaceRelativePath(workspaceRoot, relativePath)
   - Accept only a validated relative value.
   - Return a canonical absolute path under workspaceRoot, or null for an absolute, traversing, malformed, or symlink-escaping value.

3. addPortableTargetPaths(workspaceRoot, target, workspaceIndex)
   - Return a cloned target with the two relative fields populated where safe.
   - Use the matching repository index entry to normalize repository identity and to recover a deterministic relative path.
   - Leave the caller's target object untouched.

4. sanitizeTaskTargetForBundle(workspaceRoot, target, workspaceIndex)
   - Return a cloned target suitable for cloud storage.
   - Preserve portable relative fields and logical repository metadata.
   - Remove absolute worktreePath and any absolute repositoryPath.
   - If no safe relative target exists, omit the machine-specific path and attach restoreStatus with a stable stale reason.

5. migrateTaskTargetForRestore(workspaceRoot, target, workspaceIndex)
   - Return { target, changed, stale, reason }.
   - Prefer the new relative fields.
   - For a legacy task without them, accept an existing destination-contained path or one exact workspace-index suffix match. Reject ambiguity and outside-root guesses.
   - Rebuild the local absolute worktreePath and normalized repositoryPath when resolution succeeds.
   - Clear unsafe legacy absolute fields and retain a stale restoreStatus when resolution fails.

6. projectTaskWorktree(workspaceRoot, target, workspaceIndex)
   - Return { worktree, source, stale, reason } without writing.
   - Resolve the portable field first, then a safe legacy field.
   - A missing destination directory is stale but may still return the expected destination candidate for diagnostics.
   - An unsafe legacy path returns unknown/stale rather than presenting the source path as current.

Stable stale reasons should include: outside-workspace, invalid-relative-path, missing-destination, legacy-no-index-match, and legacy-ambiguous-index-match.

## Implementation Tasks

### Task 1: Add the canonical portable-target resolver and task-writer integration

Files:

- Create .heli-harness/adapters/shared/concurrency/portable-targets.mjs.
- Modify .heli-harness/adapters/shared/concurrency/task.mjs.
- Modify .heli-harness/adapters/shared/concurrency/index.mjs.
- Create lib/concurrency/portable-targets.mjs as the source-side re-export.
- Extend scripts/smoke-concurrency-foundation.mjs and add scripts/smoke-portable-targets.mjs.

Steps:

1. Implement the path validation primitives in portable-targets.mjs using canonicalizePath, resolve, relative, and the existing safe filesystem helpers. Test root paths, nested paths, Windows separators as fixture input, traversal, absolute relative values, and symlink escape.

2. Implement addPortableTargetPaths so createTask and setTaskTarget can calculate relative fields from the workspace root. Keep repositoryPath's current logical-path behavior; do not globally convert it to an absolute string.

3. Update createTask immediately before writing task.json to enrich the target with portable fields. Update setTaskTarget after applying targetPatch so a worktree or repository change refreshes the companion fields and clears an old restoreStatus. Keep revision/CAS and task events unchanged.

4. Export the resolver from the canonical concurrency index and re-export it through lib/concurrency. Run node scripts/sync-plugin-shared.mjs so every plugin copy receives the same module and task behavior.

5. Add direct smoke coverage for:
   - a task created under workspace/repos/demo receiving workspaceRelativeWorktreePath = repos/demo;
   - repositoryPath = repos/demo receiving workspaceRelativeRepositoryPath = repos/demo;
   - an outside-workspace worktree receiving no unsafe relative path;
   - setTaskTarget refreshing the relative fields;
   - relative path normalization and traversal rejection;
   - all six plugin shared copies matching the canonical module after synchronization.

6. Extend the existing concurrency foundation assertions around task creation and target updates so the new fields are proven alongside the existing repositoryId and lease isolation behavior.

Expected result: every newly written portable task target has a stable relative authority while existing consumers continue receiving the fields they already use.

### Task 2: Make cloud bundle collection portable and pull restore destination-local

Files:

- Modify lib/cli/cloud-bundle.mjs.
- Modify lib/cli/cloud.mjs.
- Extend scripts/smoke-cloud-sync.mjs.
- Reuse the canonical resolver through lib/concurrency/portable-targets.mjs.

Steps:

1. Add task-file detection in cloud-bundle.mjs for tasks/<task-id>/task.json. Parse only valid JSON task files and leave unrelated portable files byte-identical. Invalid task JSON must continue to fail safely rather than being silently rewritten.

2. Make collectBundleFiles normalize task JSON through sanitizeTaskTargetForBundle. The returned in-memory bundle must not contain a source or destination absolute worktreePath. Its normalized content must retain relative fields, repositoryId, branch, baseSha, and all non-target task data.

3. Add a restore pass over unpacked task files before writeBundleFiles. Use the bundled workspace/index.json as the only repository catalog. For each task:
   - resolve workspaceRelativeWorktreePath first;
   - resolve workspaceRelativeRepositoryPath or the matching index gitRoot/path;
   - for legacy absolute paths, use an exact unique index-relative suffix match;
   - clear unsafe source paths and set restoreStatus when no safe mapping exists;
   - preserve the task file when no target fields need migration.

4. In runPull, keep the original unpacked map for restoration, write the restored map to the destination, and calculate lastContentSha from the normalized portable map that would be returned by collectBundleFiles after the write. This prevents a destination absolute cache from making the next pull appear dirty or causing the next push to publish the destination machine's path.

5. Keep writeBundleFiles as a path-safe file writer. Do not put migration logic in the generic writer; this keeps arbitrary bundle entries and future bundle consumers predictable.

6. Add cross-root cloud smoke coverage with intentionally different temporary roots:
   - source task has a source-root absolute cache plus repos/demo relative metadata;
   - destination pull produces a destination-root absolute cache;
   - destination task retains the same relative fields and does not contain the source root;
   - normalized content from both devices is byte-equivalent;
   - a legacy source absolute path matching one index entry is rebased;
   - an ambiguous or unmatched legacy path is cleared and marked stale;
   - non-task profile content and machine-local exclusions retain current behavior.

Expected result: a pull repairs portable tasks for the destination, and a subsequent push cannot reintroduce either machine's absolute path into the shared snapshot.

### Task 3: Make status report stale metadata without weakening live coordination

Files:

- Modify lib/cli/status.mjs.
- Modify scripts/smoke-status-worktree.mjs.
- Regenerate .heli-harness/cli/status.mjs with scripts/sync-workspace-cli.mjs.

Steps:

1. Load the workspace index once for the status projection and call projectTaskWorktree only for the task-metadata fallback branch. Keep lease, writer-session, and binding lookup order and warning behavior unchanged.

2. Add worktreeStale and worktreeStaleReason to the returned task summary. For a valid relative candidate that exists, report task-metadata-relative and stale = false. For a missing relative candidate, retain the expected destination path for diagnostics, set stale = true, and add a warning.

3. For a legacy absolute path outside the current workspace or with no safe index match, return unknown/task-metadata-stale rather than treating the source path as current. Include the stable stale reason in warnings and worktreeStaleReason.

4. If an active lease, writer session, or binding supplies a path, keep that path authoritative. A stale task metadata record may produce a diagnostic warning, but it must not set the row stale or replace the live worktree.

5. Update the human-readable status output to append a clear stale marker and reason without changing existing fields used by scripts. Regenerate the distributed workspace CLI and verify its generated header and imports.

6. Extend smoke-status-worktree.mjs with:
   - relative metadata resolving under the test workspace;
   - a missing relative destination reporting stale;
   - an unsafe legacy source path reporting unknown/stale;
   - an active lease winning over stale metadata;
   - reviewer and observer counts remaining unchanged.

Expected result: status distinguishes “the task expects this destination worktree but it is not present” from “this task has a stale source-machine path,” while live coordination remains authoritative.

### Task 4: Document the portability contract and generated-file workflow

Files:

- Modify docs/architecture/cloud-sync.md.
- Modify the relevant task/concurrency documentation if the new target fields are described there.
- Generated adapter/plugin and workspace CLI copies are refreshed by the existing sync scripts; do not hand-edit generated copies.

Steps:

1. Update the portable-subset section to explain that task JSON may contain local compatibility caches, but push strips absolute target paths and syncs workspace-relative companions.

2. Document pull migration precedence, the exact-index suffix fallback for legacy v1 tasks, and the stale behavior for outside-root or ambiguous targets. State that product repos remain local and must be cloned or created separately.

3. Document the bundle hash invariant: source and destination may have different absolute caches, but their normalized portable task content is identical.

4. Add the implementation and validation commands to contributor-facing guidance:
   - node scripts/sync-plugin-shared.mjs
   - node scripts/sync-workspace-cli.mjs
   - node scripts/smoke-portable-targets.mjs
   - node scripts/smoke-cloud-sync.mjs
   - node scripts/smoke-status-worktree.mjs
   - npm run check

Expected result: the architecture document describes the behavior users will observe and the generated-copy rules prevent plugin drift.

### Task 5: Run focused and repository-wide verification

Files:

- No additional source files; validation only.

Steps:

1. Run node --check on the new resolver, lib/concurrency/portable-targets.mjs, lib/cli/cloud-bundle.mjs, lib/cli/cloud.mjs, and lib/cli/status.mjs.

2. Run the focused smokes in this order:
   - node scripts/smoke-portable-targets.mjs
   - node scripts/smoke-concurrency-foundation.mjs
   - node scripts/smoke-cloud-sync.mjs
   - node scripts/smoke-status-worktree.mjs

3. Run generated-copy gates:
   - node scripts/sync-plugin-shared.mjs --check
   - node scripts/sync-workspace-cli.mjs --check

4. Run npm run check from repos/heli-harness. This must cover package syntax, every existing smoke, plugin parity, release validation, and the new portable-target smoke added to the check script.

5. Run git diff --check and inspect the final diff for accidental edits to the pre-existing hook-write-classification plan or generated files outside the synchronization outputs.

6. Re-run the isolated original reproduction against the implemented code. The falsifier is any restored task whose resolved metadata still reports the source root, any ambiguous legacy path that is guessed, any live lease replaced by metadata, or any normalized destination bundle that contains an absolute machine path.

Expected result: focused behavior and the full repository gate are green, with explicit evidence for cross-root migration and stale reporting.

### Task 6: Release and GitHub issue handoff after implementation approval

This task is a separate handoff from the plan-only turn. It must begin only after the implementation diff and all validation results are reviewed.

Steps:

1. Use the Heli branch/release workflow to keep the implementation isolated, inspect the worktree, and confirm the only unrelated dirty file is the pre-existing hook-write-classification plan.

2. Prepare the next patch version from the current package version 0.8.2, expected to be 0.8.3 unless the release validation shows a newer version already exists. Update the changelog with the issue-#14 behavior and the stale-safety guarantee.

3. Run the release validator, npm whoami, npm view heli-harness version, npm pack --dry-run, and the complete npm run check. If npm credentials are still unavailable, stop before publish and report the exact authentication blocker; do not claim an npm release.

4. After CI is green and npm authentication is confirmed, merge the implementation branch, create the patch tag, push the tag, and publish the package using the repository release procedure. Verify the published version with npm view and a clean-install smoke.

5. Comment on GitHub issue #14 with the released version, cross-root smoke evidence, and the stale/ambiguous fallback behavior. Close the issue only after the published artifact and clean-install verification pass.

Rollback: revert the resolver, bundle normalization, restore migration, status projection, generated copies, tests, and documentation as one change set. No server migration is required because the bundle remains v1 and old absolute-only tasks remain readable; the restore pass is client-side and can be disabled without deleting task history.

## Acceptance Criteria

- A task created or retargeted under a workspace records stable workspace-relative target companions.
- A source workspace pushed and pulled into a differently rooted destination yields destination-local worktreePath values and no source absolute path in the normalized bundle.
- A legacy absolute target is rebased only by an exact unique index-relative suffix match or a safe current-root path.
- Unmatched, ambiguous, traversal, symlink-escaping, or outside-workspace targets are marked stale and are never displayed as current.
- Active leases, writer sessions, bindings, reviewer counts, and observer counts retain their current precedence and behavior.
- A pull followed by a push produces stable portable content rather than machine-specific path churn.
- Existing cloud secret scanning, dirty-pull refusal, version conflict behavior, E2E encryption, and machine-local exclusions remain green.
- sync-plugin-shared --check, sync-workspace-cli --check, npm run check, and CI pass.
- GitHub issue #14 receives a linked implementation/release update only after the release handoff completes.

## Decision Record

Selected design: additive workspace-relative target companions plus local absolute compatibility caches, with push sanitization, pull migration, and explicit stale status.

Rejected design: rebase every absolute path by replacing the source workspace prefix. v1 bundles do not carry a trustworthy source root, and an arbitrary prefix replacement can silently attach a task to the wrong repository or worktree.

Rejected design: trust destination existence alone. A stale source path can coincidentally exist, and existence does not establish that it belongs to the restored workspace. The resolver must use relative metadata or a unique workspace-index mapping first.
