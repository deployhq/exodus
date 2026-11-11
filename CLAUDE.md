# CLAUDE.md

@AGENTS.md

## What Exodus is

Exodus is a free demo and funnel for DeployHQ. A visitor enters the URL of a WordPress site. The translator rebuilds it as a static Astro site, and the result is hosted on DeployHQ Sites **staging** so the visitor can see it live. This repo is the **website only**: the translator is a separate package (not yet plugged in) that this app calls on the server.

## The pain we solve

Agencies and freelancers running many WordPress sites pay the "WordPress tax": servers and Plesk, plugin updates, security patches. The reference story is an agency that moved 40 WP sites to Astro on Cloudflare Workers: 2-3 months of work, about $90/month saved, faster sites. Exodus gives that result for free, in minutes, and leads the visitor to DeployHQ.

- Audience: agencies and freelancers with portfolios, not single-site owners.
- Pitch: before/after. Same site, no plugins, no patching, faster.
- Funnel: staging link, then "claim this site", then DeployHQ signup, then production deploy and custom domain.
- Progress steps should echo the story: pulling content, rebuilding in Astro, deploying.

## Architecture (decided)

- Astro with the Node adapter (`@astrojs/node`, standalone). Pages are static by default; the API routes opt out with `export const prerender = false`. The translator is a package and runs server-side.
- **Translator = the engine:** the npm dependency `hackathon-wp-static` (`github:deployhq/hackathon-wp-static`, pinned to a commit). It is spawned as a child process (`bin/run.mjs <url>`), not imported. It produces an Astro project (`runs/<siteId>/astro-src`) plus verification reports. It makes no model calls.
- **The service lives in `src/lib/migration/`:**
  - `pipeline.ts` runs validate, then extract (`engine.ts`), then `publish.ts`. Publishing does build, GitHub (`github.ts`), then project, repository, site, deploy and live (`deployhq.ts`).
  - `jobs.ts` is the job store: in memory, also written to `.exodus/jobs/`, one job at a time.
  - `slug.ts` turns the URL into the site name.
- **API (the UI calls only this):** `POST /api/jobs` `{url}` returns an id. `GET /api/jobs/[id]` returns the job, for polling. `GET /api/jobs/[id]/events` streams the job over SSE. Each step has a `phase` (`content`, `astro`, `deploy`) for the stepper. The full contract and snippets are in `docs/MIGRATION-SERVICE.md`.
- **Naming:** `https://websitedemos.net/agency-02/` gives slug `websitedemos-agency-02`. The site is then `websitedemos-agency-02-staging.deployhq-sites.com`, with optional custom domain `websitedemos-agency-02.dropsite.dev`. The GitHub repo is `<GITHUB_OWNER>/exodus-<slug>` (private).
- UI: a single page with a URL input, a stepper with live progress, and a result page with the staging link, a before/after comparison (page weight, load time, plugins removed) and a "claim this site" call to action.

## Guardrails (required, public tool)

- SSRF protection: only http(s); resolve the host and block private, loopback and link-local addresses, including after redirects.
- Rate limit per IP and a cap on concurrent jobs.
- Check that the target is really WordPress (e.g. `/wp-json/`) before running the pipeline.
- Staging sites are temporary; claiming one is the conversion step.
- **Status for the hackathon demo:**
  - Done: the engine's host allowlist (`WP_STATIC_ALLOW_HOSTS`, which is stricter than SSRF filtering), one job at a time, and the `/wp-json/` check.
  - Not done: SSRF filtering of arbitrary hosts and per-IP rate limits. Both are needed before this is public.

## DeployHQ API (spec: https://api.deployhq.com/docs.json)

- Base URL `https://<account>.deployhq.com/`, HTTP Basic auth (account email + 40-char API key), headers `Accept` and `Content-Type: application/json`.
- "Sites" is a server with `protocol_type: static_hosting`, not a separate API. There is **no upload endpoint**: DeployHQ deploys from a **git repository**.
- Flow per demo:
  1. `POST /projects` `{project:{name}}`. The response has `permalink` and `public_key`.
  2. Add the project's `public_key` as a read-only **deploy key** on the GitHub repo **before** step 3. DeployHQ test-clones over SSH when the repository is connected.
  3. `POST /projects/{id}/repository` `{repository:{url:'git@github.com:<owner>/<repo>.git', scm_type:'git', branch:'main'}}`
  4. `POST /projects/{id}/servers` `{server:{name, protocol_type:'static_hosting'}, hosted_website_attributes:{subdomain, subdirectory:'dist', custom_domain_hostname?}}`. Note `hosted_website_attributes` is top-level, not inside `server`. Poll `GET /projects/{id}/servers/{id}` until `static_hosting.status` is no longer `provisioning`. **The public URL is `static_hosting.url`.**
  5. `POST /projects/{id}/deployments` `{deployment:{parent_identifier:<server identifier>, branch:'main', end_revision:<sha>}}`, then poll `GET /projects/{id}/deployments/{id}` (status: pending, running, completed, failed).
- Field names and order were taken from the `dhq launch` source in deployhq-cli (`internal/commands/launch.go`, `pkg/sdk`).
- **We push the built `dist/` and deploy it without build commands.** Nobody has checked whether the staging build servers have the Node version Astro 7 needs (22.23.4 or newer). Switching to `run_build_commands` (with `POST /detection` for the commands) is a follow-up.
- Re-running the same URL reuses its repo, project and site and just redeploys. That matters because Static Hosting caps sites per account.

## Open items (blocked on the team)

- ~~Translator package~~: decided. `hackathon-wp-static`, installed from GitHub and run as a child process (see Architecture).
- Git host: for the demo, one private repo per site under `GITHUB_OWNER`, using a personal `gh` token. Still open: a bot credential, a dedicated org and a cleanup policy.
- ~~Staging account~~: decided. `thiago-qa` on staging; credentials in a local `.env` only (ask Thiago).
- Staging site lifetime and how a "claim" hands the project over to a user's DeployHQ account.

## Conventions

- Node 24.12.0 (see `.nvmrc`; Astro 7 needs 22.23.4 or newer), npm, TypeScript. Server code in `src/lib/migration/` must also run under plain `node` type stripping: no enums, use `import type`, and import local files with explicit `.ts` extensions.
- Env vars are documented in `.env.example`; never commit real secrets.
- Work on a feature branch and commit and push as soon as something works; don't leave code only on a laptop. Merge to `main` through a PR.
