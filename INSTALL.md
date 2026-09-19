# Install — Heli-Harness v0.10.0

**Current release:** `v0.10.0`  
**Primary model:** shared/global distribution + explicit project binding  
**Architecture:** [docs/architecture/README.md](docs/architecture/README.md)

## Recommended v0.10 setup

The npm registry publication for `0.10.0` may lag the GitHub release. The pinned GitHub package is the authoritative install path until `npm view heli-harness@0.10.0` succeeds.

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli --version
heli setup
```

`heli setup` initializes the trusted user/global environment, including machine identity, user policy, and the rebuildable workspace registry. The registry is a locator only; it does not own live project authority.

Link a project:

```bash
cd /path/to/project
heli link
heli doctor
heli status
```

A linked project receives:

```text
.heli/
├── workspace.json
├── heli.lock
├── policies/
├── profiles/
├── safety/
└── skills/
```

`.heli/workspace.json` contains logical project/resource identity. `.heli/heli.lock` pins behavior-relevant runtime/protocol/schema information.

Neither file may contain live sessions, writer authority, grants, credentials, runtime capability observations, process handles, or other execution-local authorization.

## What `heli link` does

For a fresh project, `heli link`:

- creates or reuses a logical workspace ID;
- declares the project root as a worktree resource;
- writes the v0.10 runtime/protocol/schema lock;
- creates a machine/execution-specific operational namespace outside committed project binding;
- seeds default project policy/safety/profile material when missing;
- registers the project in the global locator;
- creates a fresh execution identity.

Cloning the repository preserves logical project identity but creates a new machine/execution identity and does not inherit grants, sessions, leases/authority, YOLO state, or capability observations.

## Migrating an existing embedded workspace

The self-contained `.heli-harness/` installation remains supported as a compatibility/hermetic mode.

First update it to a linked-workspace-capable runtime, then ensure no embedded writer authority is active:

```bash
# use the current v0.10 CLI
heli status /path/to/workspace
heli link /path/to/workspace
```

The first link fails closed if active embedded write leases exist.

During migration:

- project overlays may move into `.heli/`;
- durable work/evidence may move to the linked execution namespace;
- live sessions, bindings, leases, YOLO, grants, credentials, sync runtime state, and capability observations do **not** migrate as authority.

## Hermetic / embedded compatibility install

Use this only when you intentionally need a self-contained workspace bundle:

```bash
npx github:KJ-AIML/heli-harness#v0.10.0 install /path/to/workspace
```

or from a source checkout:

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.10.0
./install.sh /path/to/workspace
# Windows:
# .\install.ps1 -Parent "C:\your\workspace"
```

The embedded installer copies distribution assets and seeds idle operational state. It must not copy package dogfood sessions/tasks/locks/bindings into the destination.

`heli update` preserves user operational state and local overlays while refreshing shipped distribution assets.

## Host activation

Project binding and host activation are separate. A linked or embedded project does not prove that a host hook/plugin is active.

Use the [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md) for current evidence and limitations.

### Codex

Recommended Git marketplace:

```bash
codex plugin marketplace add KJ-AIML/heli-harness
codex plugin add heli-harness@heli-harness
codex plugin marketplace upgrade heli-harness
```

For workspace-local dogfood of an embedded copy:

```bash
codex plugin marketplace add ./.heli-harness/adapters/codex-plugin
codex plugin add heli-harness@heli-harness
```

### Claude Code

For an embedded/local plugin tree:

```bash
claude plugin install .heli-harness/adapters/claude-plugin
```

Use the support matrix for the currently proven load/enforcement surface.

### Cursor

Use `.heli-harness/adapters/cursor-plugin/` as a local marketplace or copy its nested `plugins/heli-harness/` directory to Cursor's local plugin directory.

### Grok Build

```bash
node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
```

### OpenCode

Use the packaged OpenCode plugin tree as documented under `.heli-harness/adapters/opencode-plugin/`.

### Kimi / Antigravity / Pi / AXGA / Generic

Use the corresponding adapter directory and the [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md). Adapter documentation must not be treated as enforcement proof by itself.

## Scoped grants

For actions that require temporary approval, prefer scoped grants:

```bash
heli grant issue --action git.push --scope once
heli grant list
heli grant revoke <grant-id>
```

A grant is bounded by action/resource/execution and can additionally be bounded by host session, expiration, and usage count.

T6 hard-deny rules are not made grantable by normal temporary approval.

## Work records and concurrency

A named task is optional for ordinary reversible work in the linked v0.10 model.

Use durable task/work records when work spans sessions, requires handoff, coordinates multiple actors, carries significant verifier obligations, or needs investigation/evidence history.

Resource authority—not the task name—is the write-conflict boundary for modeled linked resources.

Embedded compatibility mode still supports the legacy/concurrent task/session commands and state layout.

## Cloud sync

Cloud sync is optional. It transports portable evidence/context; it must not transfer live authorization.

```bash
heli auth login --url https://<your-sync-server>
heli ws create my-project
heli push
heli pull
heli sync
```

Linked portability excludes live sessions, bindings, locks/resource authority, grants, YOLO state, credentials, and runtime capability observations.

See [Cloud Sync](docs/architecture/cloud-sync.md).

## Maintainer release

Release validation is automated in CI. `v0.10.0` has a GitHub Release and annotated tag.

The repository Release workflow:

1. resolves package/tag/npm state;
2. runs the full release gate;
3. packs the artifact;
4. publishes to npm when `NPM_TOKEN` is configured and that package version is missing;
5. creates tag/GitHub Release only when the tag does not already exist.

The retry path deliberately allows npm publication after a GitHub tag already exists.

## Verify installation

```bash
heli --version
heli doctor
heli status
heli explain authority
heli explain capabilities
```

Expected package version for this documentation: **0.10.0**.
