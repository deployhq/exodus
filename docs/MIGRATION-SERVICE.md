# Migration service

The service turns a WordPress URL into a live Astro site:

1. **Pulling content**: it checks the URL is an allowed WordPress site, then runs the engine (`hackathon-wp-static`), which crawls the site, makes an exact static copy, verifies it and translates it into an Astro project.
2. **Rebuilding in Astro**: it builds that Astro project.
3. **Deploying**: it pushes the project to a new GitHub repo, creates a DeployHQ project with Static Hosting, deploys it, and waits until it is live.

The UI only talks to the HTTP API below. Everything else runs on the server.

## Setup

```sh
nvm use                      # .nvmrc pins Node 24.12.0; Astro 7 needs >= 22.23.4
npm install                  # needs GitHub access to the private deployhq/hackathon-wp-static
cp .env.example .env         # then ask the team for the staging credentials. Never commit .env
npm run dev                  # http://localhost:4321
```

The engine drives a real browser to verify pages. If Chromium for Playwright is missing:

```sh
cd node_modules/hackathon-wp-static && npx playwright install chromium
```

`.env` variables (placeholders in `.env.example`):

| Variable | What |
| --- | --- |
| `DEPLOYHQ_HOST`, `DEPLOYHQ_ACCOUNT`, `DEPLOYHQ_EMAIL`, `DEPLOYHQ_API_KEY` | DeployHQ staging API credentials |
| `GITHUB_OWNER` | GitHub org or user that receives the generated repo |
| `GITHUB_TOKEN` | Optional; falls back to `gh auth token` |
| `STATIC_HOSTING_CUSTOM_DOMAIN_ZONE` | Optional zone for `<slug>.<zone>` (e.g. `dropsite.dev`) |
| `EXODUS_ENGINE_DIR` | Optional path to a local engine checkout (default: the installed dependency) |
| `EXODUS_VERIFY` | `off` (default) passes `--skip-verify` to the engine: a fresh run takes about 2-3 min end to end. `full` runs the per-page copy verify and translation verify: about 15 min. See "Verification" below |
| `EXODUS_ENGINE_REUSE` | `1` reuses a cached crawl (`--skip-scan --skip-copy`), saving the scan and copy (about 2 min fresh) |
| `WP_STATIC_ALLOW_HOSTS` | Extra hosts the engine may crawl, comma-separated |

Only these hosts are accepted by default: `websitedemos.net`, `wptavern.com`, `www.addsearch.com` (exact hostname match: `addsearch.com` is not `www.addsearch.com`). Add others with `WP_STATIC_ALLOW_HOSTS` and restart the server.

## Versioned runs (`EXODUS_VERSIONED`)

Every run creates a new versioned project; `EXODUS_VERSIONED=0` to reuse. With the default (`1`), publish lists the DeployHQ projects, takes the highest `exodus-<slug>-vNNN` and adds one (starting at `v001`), then creates repo `<owner>/exodus-<slug>-vNNN`, project `exodus-<slug>-vNNN` and site subdomain `<slug>-vNNN` (staging: `https://<slug>-vNNN-staging.deployhq-sites.com/`; custom domain `<slug>-vNNN.<zone>`). Earlier runs and the old unversioned `exodus-<slug>` resources are never touched. The slug is trimmed (never the version) to keep the name within the 40-character slug cap. `job.result.version` (e.g. `v001`) and `job.result.name` record what was created. Each run consumes one static hosting site, so the account's site limit caps how many versions can exist at once.

## API contract

All responses are JSON unless noted. Errors are always `{ "error": "<message>" }`.

### `POST /api/jobs`

Request body: `{ "url": "https://websitedemos.net/agency-02/" }`

`202 Accepted`:

```json
{
  "id": "3f9c1a2b7d4e",
  "statusUrl": "/api/jobs/3f9c1a2b7d4e",
  "eventsUrl": "/api/jobs/3f9c1a2b7d4e/events",
  "job": { "...": "the job object, see below" }
}
```

If a job for the same slug is already queued or running, you get that job back (same id) instead of a new one.

Errors:

| Status | When | Example |
| --- | --- | --- |
| 400 | Body is not JSON, `url` missing, not a valid http(s) URL | `{"error":"Not a valid URL: not a url"}` |
| 422 | Host not on the engine allowlist | `{"error":"Host example.com is not on the engine allowlist (websitedemos.net, wptavern.com, www.addsearch.com). Add it to WP_STATIC_ALLOW_HOSTS on the server."}` |

"Not WordPress" is not an HTTP error: the job is created and fails at its `validate` step with `This doesn't look like a WordPress site` (the server GETs `<url>wp-json/` and `<origin>/wp-json/` and needs a 200 JSON response).

### `GET /api/jobs/:id/events` (preferred)

Server-Sent Events. Sends `event: job` with the full job JSON (in `data:`) immediately and on every change (checked every 1 s), a `: ping` comment every 15 s, and closes the stream once the job is `succeeded` or `failed`. `404 {"error":"Job not found"}` for an unknown id.

```
event: job
data: {"id":"3f9c1a2b7d4e","status":"running", ... }
```

### `GET /api/jobs/:id` (polling fallback)

`200` with the job. `404 {"error":"Job not found"}`. Poll every 2 s if you can't use SSE.

### `GET /api/jobs`

`200` with an array of jobs, newest first.

### The job object

```json
{
  "id": "3f9c1a2b7d4e",
  "url": "https://websitedemos.net/agency-02/",
  "slug": "websitedemos-agency-02",
  "status": "running",
  "createdAt": "2026-11-11T09:10:00.000Z",
  "updatedAt": "2026-11-11T09:13:12.000Z",
  "steps": [
    { "name": "validate", "label": "Checking the WordPress site", "phase": "content", "status": "done",
      "startedAt": "2026-11-11T09:10:00.100Z", "finishedAt": "2026-11-11T09:10:01.000Z", "detail": "slug websitedemos-agency-02" },
    { "name": "extract", "label": "Crawling WordPress and converting to Astro", "phase": "content", "status": "running",
      "startedAt": "2026-11-11T09:10:01.000Z" },
    { "name": "build", "label": "Building the Astro site", "phase": "astro", "status": "pending" }
  ],
  "result": null,
  "error": null,
  "warnings": [],
  "log": ["...last 200 log lines..."]
}
```

- `status`: `queued` | `running` | `succeeded` | `failed`.
- step `status`: `pending` | `running` | `done` | `failed` | `skipped`. On failure, the failed step has `status: "failed"` and `detail` with the reason; `job.error` holds the same message.
- `warnings`: non-fatal issues (e.g. the strict copy check did not pass but the Astro site built). Show them, don't block on them.
- `result` when `succeeded`:

```json
{
  "liveUrl": "https://websitedemos-agency-02-staging.deployhq-sites.com/",
  "customDomainUrl": "https://websitedemos-agency-02.dropsite.dev/",
  "repoUrl": "https://github.com/<owner>/websitedemos-agency-02",
  "projectUrl": "https://<account>.<deployhq-host>/projects/...",
  "reports": {
    "verifyTranslation": "/abs/path/runs/<siteId>/verify-translation/report.html",
    "astroQuality": "/abs/path/runs/<siteId>/astro-quality.md"
  }
}
```

`reports.verifyTranslation` is `null` unless the job ran with `EXODUS_VERIFY=full` (verification is off by default).

## Verification (`EXODUS_VERIFY`)

The engine's verifier proves, page by page, that the copy is pixel-identical to the original and that the Astro version is at least 95% similar. To do that it re-captures the live original at 3 viewports, politely rate-limited, which takes more than 10 minutes even for a 6-page site (measured: strict verify about 690 s, versus about 2 minutes for scan, copy, translate, build and quality gate together). That is too slow for a live demo or an interactive funnel, so the service skips it by default (`EXODUS_VERIFY=off`, which passes `--skip-verify` to `bin/run.mjs`).

- Fresh runs: about 2-3 min end to end with the default, about 15 min with `EXODUS_VERIFY=full`.
- Set `EXODUS_VERIFY=full` when you want the per-page proof, e.g. when validating a new site or before a customer claims it. The report paths in `job.result.reports` then exist.
- The job log says which mode was used (`engine: verification off ...` / `engine: verification full ...`).

`customDomainUrl` may be `null`. `reports` are server-side file paths (for the demo operator), not URLs. Always use the URLs from `result`; the patterns are `<slug>-staging.deployhq-sites.com` and optionally `<slug>.dropsite.dev`.

### Steps and phases (for the loader / stepper)

| Phase | Phase label | Step `name` | Step `label` | Typical time |
| --- | --- | --- | --- | --- |
| `content` | Pulling content | `validate` | Checking the WordPress site | 1 s |
| `content` | Pulling content | `extract` | Crawling WordPress and converting to Astro | ~15 min fresh, ~3 min cached |
| `astro` | Rebuilding in Astro | `build` | Building the Astro site | 10-30 s |
| `deploy` | Deploying | `github` | Pushing the code to GitHub | 5-10 s |
| `deploy` | Deploying | `project` | Creating the DeployHQ project | a few s |
| `deploy` | Deploying | `repository` | Connecting the repository | a few s |
| `deploy` | Deploying | `site` | Setting up Static Hosting | a few s |
| `deploy` | Deploying | `deploy` | Deploying | 1-3 min |
| `deploy` | Deploying | `live` | Waiting for the site to go live | up to ~1 min |

A phase is done when all its steps are `done` or `skipped`, running when any is `running`, failed when any is `failed`. Derive it from `steps`; there is no separate phase field on the job.

## Snippets for the UI

EventSource (preferred):

```js
async function migrate(url, onUpdate) {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error); // 400 / 422
  onUpdate(body.job);
  return new Promise((resolve, reject) => {
    const es = new EventSource(body.eventsUrl);
    es.addEventListener('job', (e) => {
      const job = JSON.parse(e.data);
      onUpdate(job);
      if (job.status === 'succeeded') { es.close(); resolve(job); }
      if (job.status === 'failed') { es.close(); reject(new Error(job.error)); }
    });
    // The server closes the stream when the job ends; EventSource would reconnect, so
    // on error fall back to one GET to decide.
    es.onerror = async () => {
      const job = await (await fetch(body.statusUrl)).json();
      if (job.status === 'succeeded' || job.status === 'failed') {
        es.close();
        onUpdate(job);
        job.status === 'succeeded' ? resolve(job) : reject(new Error(job.error));
      }
    };
  });
}
```

Polling fallback:

```js
async function poll(statusUrl, onUpdate) {
  for (;;) {
    const job = await (await fetch(statusUrl)).json();
    onUpdate(job);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
```

## Command line

```sh
npm run migrate -- https://websitedemos.net/agency-02/   # same pipeline, foreground, prints step changes
EXODUS_VERBOSE=1 npm run migrate -- <url>                # also streams the engine log
npm test                                                 # unit tests (fake engine and fake publish)
```

## Demo shortcut (cached runs)

```sh
EXODUS_ENGINE_DIR=/path/to/hackathon-wp-static EXODUS_ENGINE_REUSE=1 npm run dev
```

With `EXODUS_ENGINE_REUSE=1`, if the engine already has `runs/<siteId>/site/` for that URL, it skips the scan and copy and only translates and builds (and re-verifies with `EXODUS_VERIFY=full`). Fresh runs are already about 2-3 minutes with verification off, so this is mostly useful with `EXODUS_VERIFY=full`.

Note: the engine always writes its output to `<engine dir>/runs/<siteId>/` (not under `.exodus/`). The service keeps its own state in `.exodus/` (gitignored): `.exodus/jobs/<id>.json` for jobs and `.exodus/work/<id>/` for publish.

## Don'ts

- Don't call the DeployHQ or GitHub APIs from the browser. Credentials live only in the server's `.env`.
- Don't commit `.env`.
- One engine runs at a time; jobs queue up. Don't start several migrations to "speed things up".
- Don't build the live URL yourself; use `result.liveUrl` / `result.customDomainUrl`.

## Code map

| File | What |
| --- | --- |
| `src/lib/migration/slug.ts` | `deriveSlug(url)`, `previewHosts(slug)` |
| `src/lib/migration/engine.ts` | `runEngine()`, `validateUrl()`, allowlist |
| `src/lib/migration/jobs.ts` | Job store (memory + `.exodus/jobs`), steps/phases, sequential queue |
| `src/lib/migration/pipeline.ts` | `startMigration(url, overrides?)`: validate -> engine -> publish |
| `src/lib/migration/publish.ts` | `publish()`: GitHub + DeployHQ (owned by the publish lane) |
| `src/pages/api/jobs/*` | HTTP routes |
| `scripts/migrate.ts` | CLI |
