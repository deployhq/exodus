## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Migration service (WordPress URL -> live Astro site)

The UI only calls this HTTP API; never call DeployHQ or GitHub from the browser. Full guide with example JSON and snippets: `docs/MIGRATION-SERVICE.md`.

- Setup: `nvm use` (Node 24.12.0), `npm install` (needs access to the private deployhq/hackathon-wp-static), `cp .env.example .env` (ask Thiago for the staging credentials; never commit `.env`), `npm run dev`.
- `POST /api/jobs` `{url}` -> `202 {id, statusUrl, eventsUrl, job}`; `400 {error}` for a bad URL, `422 {error}` for a host outside the allowlist.
- `GET /api/jobs/:id/events` -> SSE: `event: job` with the full job JSON on every change; the stream closes when the job is `succeeded` or `failed`; `: ping` every 15 s. Preferred.
- `GET /api/jobs/:id` -> the job (poll every 2 s as a fallback); `404 {error}` if unknown. `GET /api/jobs` -> all jobs, newest first.
- Job: `status` (`queued|running|succeeded|failed`), `steps[]` (`name`, `label`, `phase`, `status`, `detail`), `result` (`liveUrl`, `customDomainUrl`, `repoUrl`, `projectUrl`, `reports`), `error`, `warnings`, `log`.
- Phases for the stepper: `content` (Pulling content: `validate`, `extract`), `astro` (Rebuilding in Astro: `build`), `deploy` (Deploying: `github`, `project`, `repository`, `site`, `deploy`, `live`).
- Durations: about 15 min fresh, about 3 min with a cached crawl (`EXODUS_ENGINE_DIR=<engine checkout> EXODUS_ENGINE_REUSE=1`), plus 2-4 min to deploy.
- One job runs at a time; the same slug while queued/running returns the existing job.
