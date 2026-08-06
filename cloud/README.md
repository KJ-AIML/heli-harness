# Heli sync service (Cloudflare)

Server side of [cloud sync](../docs/architecture/cloud-sync.md). The API logic
lives in `core.mjs` (portable, dependency-free, CI-tested by
`scripts/smoke-cloud-sync.mjs`); `worker.mjs` is the thin Cloudflare shell that
binds it to Durable Object storage (metadata) and R2 (snapshot bundles).

The server stores opaque snapshot bundles only — it never parses workspace
schemas, and no heli governance path requires it. Local-first stays.

## Deploy (maintainer)

1. Create a GitHub OAuth app (authorization callback:
   `https://<worker-host>/auth/github/callback`).
2. ```bash
   cd cloud
   npx wrangler r2 bucket create heli-sync-bundles
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```
3. Point clients at it: `heli auth login --url https://<worker-host>` (the URL
   is remembered in `~/.heli/credentials.json`).

Local development: `npx wrangler dev` with `TEST_LOGIN=1` in `.dev.vars`
enables the browserless `POST /activate` used by the CI smoke.

## API

See the route tables in `core.mjs` — device-flow auth (`/auth/device/*`,
`/activate`, GitHub callback), device management (`/auth/devices`), workspace
CRUD (`/ws`), snapshot `push`/`pull` with optimistic concurrency
(`x-base-version` → `409 version_conflict`), last-10 version retention.
