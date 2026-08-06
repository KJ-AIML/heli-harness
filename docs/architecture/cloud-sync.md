# Heli Cloud Sync — Design

Status: **approved design, pre-implementation** (owner-approved 2026-08-06)
Owner decision record: workspace task `cloud-sync-design`

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
| C. **Cloudflare service (chosen)** | Workers API + D1 metadata + R2 snapshots + Durable Object per workspace | Real account model, gcloud-grade UX, serverless free tier fits the workload, DO reserves the future live-coordination seam. |

**Decision: Option C.** The deciding factors were the account/identity UX (install
anywhere → auth → select workspace) which git-backed designs cannot deliver cleanly, and
Cloudflare's free tier making the ops/cost constraint moot at current scale.

## Architecture

```
heli CLI (npm -g, Node ≥20)
   │  HTTPS, Bearer <heli token>
   ▼
Cloudflare Worker — API (Hono)
   │
   ├── D1 (SQLite)        users, devices/tokens, workspaces, version index
   ├── R2                 snapshot bundles: ws/<workspace-id>/v<N>.tar.gz
   └── Durable Object     one per workspace: serializes pushes, owns the
                          authoritative version counter (future: live state seam)
```

### Auth — OAuth device flow

- `heli auth login` requests a device code from the Worker, prints
  `code + https://heli.<domain>/activate`, and polls.
- The activation page authenticates the user via **GitHub OAuth** (identity provider
  only — no passwords stored, no GitHub repo scopes requested; `read:user` only).
- On approval the Worker mints a **heli token** (random 256-bit, stored hashed in D1,
  one row per device) and the CLI stores it in `~/.heli/credentials.json` (mode 0600).
- `heli auth logout` revokes the device token server-side and deletes the local file.
- Tokens are per-device and individually revocable (`heli auth devices` lists them).

### Sync model — dumb snapshots, optimistic concurrency

The **portable subset** of a workspace:

```
include: profiles/  policies/  safety/  workspace/index.json  workspace/schema.json
         tasks/     state/current-task.md  state/decisions.md  HARNESS.md overlays
exclude: sessions/  locks/  bindings/  state/yolo.json  workspace/target.json
         adapters/  skills/  heli.mjs  cli/   (reinstallable distribution assets)
```

- `heli push`: tar.gz the portable subset (payload is KBs), POST with the client's
  `baseVersion`. The workspace's Durable Object compares `baseVersion` to the current
  version: match → store bundle in R2 as `v<N+1>.tar.gz`, bump counter, record manifest
  hash in D1; mismatch → `409 version conflict` and the CLI says `run heli pull first`
  (or `--force` to overwrite, which still stores the old head as a retained version).
- `heli pull`: GET latest (or `--version N`), extract over the portable subset. Local
  machine-only dirs untouched. A dirty local subset (unpushed changes) prompts before
  overwrite unless `--force`.
- Retention: keep the **last 10 versions** per workspace → built-in time machine
  (`heli ws versions`, `heli pull --version N`). Older versions garbage-collected.
- **No diff protocol, deliberately.** Full snapshots at kilobyte scale beat any sync
  protocol on correctness-per-line-of-code. Revisit only if bundles exceed ~10 MB.
- Conflict semantics are whole-snapshot: last push wins the head, prior heads remain
  retrievable as versions. Per-file merge is explicitly out of scope (see Risks).

### Data model (D1)

```sql
users      (id, github_id, login, created_at)
devices    (id, user_id, name, token_hash, created_at, last_seen_at, revoked_at)
workspaces (id, user_id, name, current_version, created_at, updated_at)
versions   (workspace_id, version, r2_key, manifest_sha256, size_bytes,
            pushed_by_device, created_at)
```

### API surface (Worker, all JSON, Bearer auth except device-flow endpoints)

```
POST /auth/device/code        → { device_code, user_code, verification_uri, interval }
POST /auth/device/token       → { token } | { error: "authorization_pending" }
GET  /auth/devices            → device list          DELETE /auth/devices/:id
GET  /ws                      → workspace list
POST /ws                      → create { name }
GET  /ws/:id/versions         → version index
POST /ws/:id/push             → multipart bundle + { baseVersion } → { version } | 409
GET  /ws/:id/pull?version=N   → bundle stream (default: head)
DELETE /ws/:id                → soft-delete (versions retained 30 days)
```

### CLI surface

```
heli auth login | logout | status | devices
heli ws create <name> | list | versions | delete
heli push [--force]           heli pull [--version N] [--force]
heli sync                     # push if ahead, pull if behind, error on divergence
heli init                     # interactive: auth check → pick ws → pull → offer to
                              # clone repos/ from workspace/index.json remotes
heli config set sync.auto on  # auto-push after `task complete`
```

## Security & Privacy

- **Secret scan before every push** (Phase 1, blocking): reuse the safety-rules pattern
  matching (.env-style keys, `AKIA…`, `ghp_…`, PEM headers, generic
  high-entropy assignments) over the bundle; findings block the push with file:line,
  `--allow-secret <id>` opt-out mirrors `HELI_ALLOW_COMMAND` semantics.
- **Optional E2E encryption** (Phase 2): `heli config set sync.e2e on` derives a key from
  a passphrase (scrypt) and encrypts the tarball client-side (age or libsodium
  secretstream); the server then stores ciphertext only. The bundle format carries an
  `encryption` field from Phase 1 so this is additive, not a migration.
- Tokens hashed at rest; TLS only; no workspace content in logs; R2 bucket private.
- Deleting a workspace or account hard-deletes R2 objects after the 30-day soft window.

## Risks

| Risk | Mitigation |
|---|---|
| Two devices push divergent snapshots | Optimistic concurrency (409 + pull-first); retained versions make any overwrite recoverable; whole-snapshot semantics documented loudly. Per-file merge deferred until real demand. |
| Secrets leak into synced context | Blocking pre-push scan (Phase 1); E2E option (Phase 2). |
| Service becomes load-bearing, violating local-first | Constraint #1 enforced in review: no governance path may read the network. Sync code lives in an isolated `lib/cli/sync/` module. |
| npm name/bin squatting confusion (`heli`, `heli-cli` taken) | Publish as `heli-harness` with bin `heli`; README states this explicitly. |
| GitHub-as-IdP excludes non-GitHub users | Accepted for now; the token layer is IdP-agnostic, a second IdP is additive later. |
| Cloudflare free-tier limits | Workload is KB-scale and low-frequency; measured headroom is orders of magnitude. Paid Workers plan is the fallback, not a redesign. |
| Solo-maintainer service abandonment | Local-first means the workspace never depends on the service; `heli pull` + retained versions allow full egress at any time. |

## Rollout

| Phase | Ships | Acceptance |
|---|---|---|
| **0 — npm publish** | `npm publish` of `heli-harness`; `npm i -g heli-harness` → global `heli`; INSTALL/README updated | Global install verified on Windows + macOS/Linux CI legs; npx path unchanged |
| **1 — Service + core CLI** | Worker (auth device flow, ws CRUD, push/pull), D1/R2/DO setup via wrangler, CLI: `auth`, `ws`, `push`, `pull`; blocking secret scan | Contract smokes against a local `wrangler dev` worker in CI; live-verify script against staging; INSTALL section |
| **2 — Restore & comfort** | `heli init` full restore (incl. repo cloning offer), `heli sync`, auto-push on `task complete`, E2E encryption, `ws versions` time machine | Smoke: fresh temp "device" → auth (stubbed) → init → workspace equivalence assert |
| **3 — Teams (unscheduled)** | Shared workspaces, roles, live cross-device state via DO | Not designed here; requires its own design doc and real demand |

Version targets: Phase 0 → v0.7.0. Phases 1–2 → v0.8.x behind a `sync` command group
that is invisible-when-unauthenticated. Phase 3 unversioned.

## Rollback

Every phase is additive. Rollback = disable the command group / unpublish nothing:
workspaces keep working locally because no governance path depends on sync (Constraint 1).
Server-side, versions are immutable snapshots; a bad push is rolled back with
`heli pull --version N` + `heli push`. Killing the service entirely strands no data the
client can't re-push later: the local workspace remains the primary copy at all times.

## Open Questions (to resolve in Phase 1 implementation)

1. Custom domain (`api.heli.dev`-style) vs `*.workers.dev` for launch — cost/trust tradeoff.
2. Whether `tasks/` sync should exclude `events.jsonl` (append-only, machine-noisy) or
   include it for full provenance. Leaning include (it is evidence).
3. Monorepo layout for the Worker: `cloud/` top-level dir in this repo vs separate repo.
   Leaning `cloud/` here — shared release cadence, one CI.
