# GitHub Actions

One workflow: **`deploy.yml`** — runs on every push to `main`. Steps:

1. Install deps (root, engine, worker)
2. Run the 143-test engine suite
3. Rebuild `public/js/engine.js` from source
4. `wrangler deploy` → Cloudflare

## Required secret: `CLOUDFLARE_API_TOKEN`

One-time setup. Same token gets used for every future deploy.

1. Open [Cloudflare → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens).
2. **Create Token** → pick the **Edit Cloudflare Workers** template.
3. Account Resources: pick your account (`Sam@thencandesigns.com's Account`).
4. Zone Resources: **All zones** (or none — we don't need a zone to deploy to `*.workers.dev`).
5. Continue → Create Token → copy it once (you won't see it again).
6. In GitHub, go to **[Repo] → Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: the token you just copied
7. Done. Next push to `main` triggers a deploy.

## Triggering a deploy

- **Automatic**: `git push origin main`.
- **Manual**: the Actions tab on GitHub → "Deploy" workflow → "Run workflow".

## If a deploy fails

- Engine tests broken → fix the code that broke a test.
- Wrangler error → open the log, usually config / token / account-id.
- `wrangler deploy` hitting rate limits → unlikely at our scale; Cloudflare free tier is generous.

## Adding the harness to CI (future)

Right now the harness runs against a local `wrangler dev`. To gate deploys
on harness success, we'd:

1. Spin up `wrangler dev` in the background in CI (workerd can take a few
   seconds to boot).
2. `WORKER=http://localhost:8787 N=20 npm run harness`.
3. Fail the workflow if harness fails.

Deferred because the harness is quick to run locally and the engine tests
already give us a strong correctness signal.
