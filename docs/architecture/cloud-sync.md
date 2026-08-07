# Heli Cloud Sync — Design

Status: **Phases 0–2 shipped** (owner-approved 2026-08-06; Phases 0–1 shipped in v0.7.0 with the service deployed; Phase 2 shipped in v0.7.1). Phase 3 remains unscheduled.
Owner decision record: workspace task `cloud-sync-design`

> Phase 2 amendments (2026-08-07):
>
> 4. **E2E passphrase comes from the `HELI_E2E_PASSPHRASE` environment variable**, not an interactive prompt — every heli command stays non-interactive/agent-safe. Scheme: `aes-256-gcm-scrypt` (scrypt-derived 256-bit key, random salt+iv per bundle, GCM tag appended). Pulling an encrypted bundle latches `e2e: on` in the machine-local sync state so a device cannot silently downgrade the workspace to plaintext.
> 5. **Dirty detection hashes canonical content, not wire bytes** (`lastContentSha`) — encrypted bundles are non-deterministic, so the wire hash no longer identifies "same content".
> 6. **Repo re-cloning** uses an optional `remote` field on `workspace/index.json` repo entries (`heli init --clone`); entries without a remote are listed as manual follow-ups.

> Implementation amendments (2026-08-06), applied by the Phase 1 build:
>
> 1. **Bundle format is gzip'd JSON, not tar.gz** — `gzip(JSON {format: "heli-bundle-v1", encryption, files})` via pure `node:zlib`. No platform tar quirks (GNU/BSD tar already bit this repo once); the server stores opaque bytes either way, so the format stays a client concern. The `encryption` field ships from day one so Phase 2 E2E is additive.
> 2. **Phase 1 server state lives in Durable Object storage, not D1** — same data model as the original-design SQL tables (kept for reference under "Data model" below), keyed records instead of SQL, one API DO serializing all mutations. This keeps the API core (`cloud/core.mjs`) dependency-free and fully CI-testable in plain node (`scripts/smoke-cloud-sync.mjs`); the thin CF shell is `cloud/worker.mjs`. D1 and per-workspace DO sharding remain the scale-up path.
> 3. **`heli ws link <name>` added to Phase 1** — linking an existing sync workspace from a second device couldn't wait for Phase 2's `heli init`; cross-device pull is the core recovery story.

## Problem

A Heli workspace's value is its accumulated context: repo profiles, policy overlays,
safety rules, and the full task history with decisions and evidence. Today that context
lives only on one machine's disk. Product repos under `repos/` survive a machine loss
because each has its own git remote — the governance layer does not. A dead device means
losing every profile, policy, and task record the workspace accumulated.

Users also cannot carry a workspace identity across devices. There is no equivalent of
`gcloud auth login` + `gcloud init`: install the CLI anywhere, authenticate once, select
a workspace, and receive its full context.

## Goals

- `npm i -g heli-harness` gives a global `heli` command (real install, not npx-only).
- `heli auth login` authenticates a device via OAuth device flow (gcloud/gh-style).
- `heli ws list` / `heli init` on any device: pick a synced workspace, pull full context.
- `heli push` / `heli pull` sync the portable workspace subset; optional auto-sync.
- Recovery story: new machine → auth → init → working workspace in minutes.

## Constraints (non-negotiable)

1. **Local-first stays.** A workspace must work fully offline with zero account. Sync is
   an optional layer on top; nothing in governance, hooks, tasks, or leases may require
   the service. Disabling sync must break nothing.
2. **The server stores opaque snapshots, not parsed state.** The service never interprets
   profile/policy/task schemas. This keeps the roadmap's "no central database before
   schemas are stable" principle intact: the server is transport + versioning, not a
   schema-coupled datastore. Schema evolution stays a client-side concern.
3. **Machine-local state never syncs.** `sessions/`, `locks/`, `bindings/`,
   `state/yolo.json` contain worktree paths and live coordination state that is
   meaningless or harmful on another machine.
4. **Product repos never sync.** `repos/` is out of scope; each repo has its own remote.
5. **Near-zero ops.** One maintainer. Serverless only; no VMs, no patching, no on-call.

## Non-Goals

- Not a team/multi-user product (Phase 3 question at the earliest).
- Not cross-device *live* coordination (leases stay machine-local; the Durable Object
  reserves the seam for later, but no live features ship in Phases 0–2).
- Not telemetry, analytics, or a hosted dashboard.
- Not a git replacement for product repos.
- Not real-time collaborative editing of workspace files.

## Options Considered

| Option | Summary | Verdict |
|---|---|---|
| A. Git-backed workspace repo (BYO remote) | Parent workspace as a private git repo; heli wraps git | Rejected by owner. UX ceiling: no account model, no `ws list` across devices without knowing repo URLs, conflates workspace with "a repo to manage". |
| B. Cloud drive / manual backup (`heli backup` zip to Dropbox et al.) | Zip portable subset to a synced folder | Rejected. No versioning contract, no conflict handling, no auth story, worst recovery UX. |
| C. **Cloudflare service (chosen)** | Workers API + R2 snapshots + Durable Object (as evaluated: D1 metadata + one DO per workspace; shipped as DO storage + one API DO — see Architecture) | Real account model, gcloud-grade UX, serverless free tier fits the workload, DO reserves the future live-coordination seam. |

**Decision: Option C.** The deciding factors were the account/identity UX (install
anywhere → auth → select workspace) which git-backed designs cannot deliver cleanly, and
Cloudflare's free tier making the ops/cost constraint moot at current scale. The storage
split inside Option C changed during the Phase 1 build (D1 → Durable Object storage); the
option itself did not.

## Architecture

As shipped (v0.7.0–v0.7.1):

```
heli CLI (npm -g, Node ≥20)
   │  HTTPS, Bearer <heli token>
   ▼
Cloudflare Worker — thin shell (cloud/worker.mjs, no framework, no deps)
   │  forwards every request to one named Durable Object ("api")
   ▼
Durable Object — API core (cloud/core.mjs, portable Request/Response)
   ├── DO storage         users, devices/tokens, workspaces, version index
   │                      (keyed records, not SQL — see Data model below)
   └── R2                 snapshot bundles: bundle:<workspace-id>:<N>
                          (gzip'd `heli-bundle-v1`, opaque bytes to the server)
```

> Original design / scale-up path: a Hono-based Worker over **D1 (SQLite)** for
> metadata plus **one Durable Object per workspace**. Not shipped. `cloud/core.mjs`
> stays dependency-free and storage-agnostic (it talks to a small `get/put/list/blob*`
> store interface), so moving metadata to D1 and sharding the DO per workspace remains
> a drop-in change if a single serializing DO ever becomes the bottleneck.

### Auth — OAuth device flow

- `heli auth login` requests a device code from the Worker, prints
  `code + https://heli.<domain>/activate`, and polls.
- The activation page authenticates the user via **GitHub OAuth** (identity provider
  only — no passwords stored, no GitHub repo scopes requested; `read:user` only).
- On approval the Worker mints a **heli token** (random 256-bit, stored hashed in DO
  storage under `token:<sha256>`, one record per device) and the CLI stores it in
  `~/.heli/credentials.json` (mode 0600).
- `heli auth logout` revokes the device token server-side and deletes the local file.
- Tokens are per-device and individually revocable (`heli auth devices` lists them).

### Sync model — dumb snapshots, optimistic concurrency

The **portable subset** of a workspace:

```
include: profiles/  policies/  safety/  tasks/  (incl. tasks/*/events.jsonl)
         workspace/index.json  workspace/schema.json
         state/current-task.md  state/decisions.md
exclude: sessions/  locks/  bindings/  state/yolo.json  state/sync.json
         workspace/target.json
         adapters/  skills/  heli.mjs  cli/   (reinstallable distribution assets)
```

(As implemented in `lib/cli/cloud-bundle.mjs` — `INCLUDE_DIRS` / `INCLUDE_FILES`.)

- `heli push`: pack the portable subset into a gzip'd `heli-bundle-v1` JSON bundle
  (payload is KBs) and POST the raw bytes with an `x-base-version` header. The API
  Durable Object compares that base version to the workspace's current version:
  match → store the bundle in R2 as `bundle:<workspace-id>:<N+1>`, bump the counter,
  record size + `sha256` of the wire bytes in the DO version index; mismatch →
  `409 version_conflict` and the CLI says `run heli pull first` (or `--force` to
  overwrite, which still stores the old head as a retained version).
- `heli pull`: GET latest (or `--version N`), gunzip and write the bundle's files over
  the portable subset. Local machine-only dirs untouched. A dirty local subset
  (unpushed changes, detected via `lastContentSha` over canonical content) is refused
  unless `--force`.
- Retention: keep the **last 10 versions** per workspace → built-in time machine
  (`heli ws versions`, `heli pull --version N`). Older versions garbage-collected.
- **No diff protocol, deliberately.** Full snapshots at kilobyte scale beat any sync
  protocol on correctness-per-line-of-code. Revisit only if bundles exceed ~10 MB.
- Conflict semantics are whole-snapshot: last push wins the head, prior heads remain
  retrievable as versions. Per-file merge is explicitly out of scope (see Risks).

### Data model (Durable Object storage)

Keyed JSON records in the API Durable Object's storage — no SQL, no D1. Keys are
prefix-scannable so `list(prefix)` replaces every query the SQL design needed:

```
user:<github-id>                → { userId, login, createdAt }
token:<sha256(token)>           → { userId, login, deviceId, deviceName,
                                    createdAt, revokedAt? }
ws:<user-id>:<workspace-id>     → { id, name, currentVersion, createdAt,
                                    updatedAt, deletedAt? }
ver:<workspace-id>:<version>    → { version, size, sha256, pushedBy, createdAt }
                                  (version zero-padded to 10 digits so key order
                                   is version order)
pending:<device-code>           → in-flight device-flow grant (15 min TTL)
usercode:<user-code>            → device-code lookup for the activation page

R2 blob: bundle:<workspace-id>:<version> → the opaque snapshot bytes
```

> Original design / scale-up path — the same model as D1 (SQLite) tables:
>
> ```sql
> users      (id, github_id, login, created_at)
> devices    (id, user_id, name, token_hash, created_at, last_seen_at, revoked_at)
> workspaces (id, user_id, name, current_version, created_at, updated_at)
> versions   (workspace_id, version, r2_key, manifest_sha256, size_bytes,
>             pushed_by_device, created_at)
> ```
>
> Not shipped. DO storage was chosen because it keeps `cloud/core.mjs` dependency-free
> and fully CI-testable in plain node (`scripts/smoke-cloud-sync.mjs`) and because one
> serializing DO gives the version counter its atomicity for free. D1 remains the
> migration target if metadata ever outgrows a single DO.

### API surface (Worker, all JSON, Bearer auth except device-flow endpoints)

```
POST /auth/device/code        → { device_code, user_code, verification_uri, interval }
POST /auth/device/token       → { token } | { error: "authorization_pending" }
GET  /auth/devices            → device list          DELETE /auth/devices/:id
GET  /ws                      → workspace list
POST /ws                      → create { name }
GET  /ws/:id/versions         → version index
POST /ws/:id/push             → raw bundle bytes + `x-base-version` header
                                → { version } | 409 { error: "version_conflict" }
GET  /ws/:id/pull?version=N   → bundle stream (default: head), `x-version` +
                                `x-sha256` response headers
DELETE /ws/:id                → soft-delete (versions retained 30 days)
```

### CLI surface

```
heli auth login [--url <server>] | logout | status | devices
heli ws create <name> | link <name> | unlink | list | versions | delete <name>
heli push [--force] [--allow-secrets]     heli pull [--version N] [--force]
heli sync                     # push if ahead, pull if behind, error on divergence
heli sync auto on|off         # auto-push after `heli task complete`
heli sync e2e on|off          # client-side encryption (HELI_E2E_PASSPHRASE)
heli init <name> [--dir path] [--clone]
                              # one command: install if absent → link → pull →
                              # list (or --clone) repos/ from index.json remotes
```

## Security & Privacy

- **Secret scan before every push** (Phase 1, blocking): reuse the safety-rules pattern
  matching (.env-style keys, `AKIA…`, `ghp_…`, PEM headers, generic
  high-entropy assignments) over the bundle; findings block the push with file:line,
  `--allow-secrets` opt-out mirrors `HELI_ALLOW_COMMAND` semantics.
- **Optional E2E encryption** (shipped in Phase 2): `heli sync e2e on` plus a
  `HELI_E2E_PASSPHRASE` environment variable (never an interactive prompt — every heli
  command stays agent-safe). Scheme `aes-256-gcm-scrypt`: a scrypt-derived 256-bit key
  with a random salt+iv per bundle and the GCM tag appended, applied to the gzip'd
  `heli-bundle-v1` bytes client-side; the server then stores ciphertext only. The bundle
  format carries an `encryption` field from Phase 1, so this was additive, not a
  migration. *(The original design floated age or libsodium secretstream; `node:crypto`
  won because it adds no dependency.)*
- Tokens hashed at rest; TLS only; no workspace content in logs; R2 bucket private.
- Deleting a workspace or account hard-deletes R2 objects after the 30-day soft window.

## Risks

| Risk | Mitigation |
|---|---|
| Two devices push divergent snapshots | Optimistic concurrency (409 + pull-first); retained versions make any overwrite recoverable; whole-snapshot semantics documented loudly. Per-file merge deferred until real demand. |
| Secrets leak into synced context | Blocking pre-push scan (Phase 1); E2E option (Phase 2). |
| Service becomes load-bearing, violating local-first | Constraint #1 enforced in review: no governance path may read the network. Sync code is isolated in `lib/cli/cloud.mjs` + `lib/cli/cloud-bundle.mjs`. |
| npm name/bin squatting confusion (`heli`, `heli-cli` taken) | Publish as `heli-harness` with bin `heli`; README states this explicitly. |
| GitHub-as-IdP excludes non-GitHub users | Accepted for now; the token layer is IdP-agnostic, a second IdP is additive later. |
| Cloudflare free-tier limits | Workload is KB-scale and low-frequency; measured headroom is orders of magnitude. Paid Workers plan is the fallback, not a redesign. |
| Solo-maintainer service abandonment | Local-first means the workspace never depends on the service; `heli pull` + retained versions allow full egress at any time. |

## Rollout

| Phase | Ships | Status | Acceptance |
|---|---|---|---|
| **0 — npm publish** | `npm publish` of `heli-harness`; `npm i -g heli-harness` → global `heli`; INSTALL/README updated | shipped v0.7.0 | Global install verified on Windows + macOS/Linux CI legs; npx path unchanged |
| **1 — Service + core CLI** | Worker (auth device flow, ws CRUD, push/pull), Durable Object + R2 setup via wrangler, CLI: `auth`, `ws` (incl. `link`), `push`, `pull`; blocking secret scan | shipped v0.7.0 | Contract smokes against a local `wrangler dev` worker in CI; live-verify script against staging; INSTALL section |
| **2 — Restore & comfort** | `heli init` full restore (incl. repo cloning offer), `heli sync`, auto-push on `task complete`, E2E encryption, `ws versions` time machine | shipped v0.7.1 | Smoke: fresh temp "device" → auth (stubbed) → init → workspace equivalence assert |
| **3 — Teams** | Shared workspaces, roles, live cross-device state via DO | unscheduled | Not designed here; requires its own design doc and real demand |

Shipped versions: Phases 0–1 shipped in v0.7.0. Phase 2 shipped in v0.7.1, behind a `sync`
command group that is invisible-when-unauthenticated. Phase 3 unscheduled and unversioned.

## Rollback

Every phase is additive. Rollback = disable the command group / unpublish nothing:
workspaces keep working locally because no governance path depends on sync (Constraint 1).
Server-side, versions are immutable snapshots; a bad push is rolled back with
`heli pull --version N` + `heli push`. Killing the service entirely strands no data the
client can't re-push later: the local workspace remains the primary copy at all times.

## Open Questions — resolved by the Phase 1 build

1. Custom domain (`api.heli.dev`-style) vs `*.workers.dev` for launch — **still open**, and
   deliberately so: the server host is not baked into the client. `heli auth login --url
   <server>` records whatever host you point it at in `~/.heli/credentials.json`, so the
   domain decision is a deploy concern, not a code or protocol change.
2. Whether `tasks/` sync should exclude `events.jsonl` — **resolved: include.** `tasks/` is
   bundled whole (`INCLUDE_DIRS` in `lib/cli/cloud-bundle.mjs`); the event log is evidence
   and the payload stays at kilobyte scale.
3. Monorepo layout for the Worker — **resolved: `cloud/` in this repo** (`core.mjs`,
   `worker.mjs`, `wrangler.toml`), one release cadence, one CI, and `core.mjs` runs under
   plain node so `scripts/smoke-cloud-sync.mjs` covers the full contract without workerd.
