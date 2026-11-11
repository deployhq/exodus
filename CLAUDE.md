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

- Astro with the Node adapter (`@astrojs/node`, `output: 'server'`). The translator is a package and runs server-side.
- `src/lib/pipeline.ts`: `translate(url)` then `publish(sourceDir)` (push to git) then `deploy(repoUrl)` (DeployHQ project, repository, static_hosting server, deployment) then staging URL. Emits progress events. The translator and the deployer sit behind small interfaces, with mock implementations until the real ones are plugged in.
- `POST /api/jobs` starts a job and returns an id. `GET /api/jobs/[id]/events` streams progress over SSE. Job state is in memory (demo scale).
- `src/lib/deployhq.ts`: client for the DeployHQ staging API. Credentials come from env vars only, never committed.
- UI: a single page with a URL input, a stepper with live progress, and a result page with the staging link, a before/after comparison (page weight, load time, plugins removed) and a "claim this site" call to action.

## Guardrails (required, public tool)

- SSRF protection: only http(s); resolve the host and block private, loopback and link-local addresses, including after redirects.
- Rate limit per IP and a cap on concurrent jobs.
- Check that the target is really WordPress (e.g. `/wp-json/`) before running the pipeline.
- Staging sites are temporary; claiming one is the conversion step.

## DeployHQ API (spec: https://api.deployhq.com/docs.json)

- Base URL `https://<account>.deployhq.com/`, HTTP Basic auth (account email + 40-char API key), headers `Accept` and `Content-Type: application/json`.
- "Sites" is a server with `protocol_type: static_hosting`, not a separate API. There is **no upload endpoint**: DeployHQ deploys from a **git repository**.
- Flow per demo:
  1. `POST /projects` `{project:{name, zone_id?, template_id?}}`
  2. `POST /projects/{id}/repository` `{repository:{url, scm_type:'git', branch, username?, password?}}`
  3. `POST /projects/{id}/servers` `{server:{name, protocol_type:'static_hosting'}, hosted_website_attributes:{subdomain, spa_mode, subdirectory}}`
  4. `POST /projects/{id}/deployments` `{deployment:{parent_identifier:<server id>, mode:'queue', run_build_commands:true, use_latest:true}}`
  5. Poll `GET /projects/{id}/deployments/{id}` (status: pending, running, completed, failed) and `GET /hosted_resources/{id}` for the site URL.
- `POST /detection` can detect the framework and suggest the static-hosting output directory (Astro: `dist`) and build commands.
- Open API details to verify against a real staging account: the exact `hosted_website` response shape (where the public URL lives) and the `subdomain` rules.

## Open items (blocked on the team)

- Translator package: name, install method, entry-point signature.
- Git host for generated sites: the translator output must be pushed to a repo DeployHQ can reach (e.g. one repo per demo in a dedicated GitHub org, or a repo with a branch per demo). Needs a decision, a bot credential, and a cleanup policy.
- Staging account: which DeployHQ staging account and API credentials the demo uses.
- Staging site lifetime and how a "claim" hands the project over to a user's DeployHQ account.

## Conventions

- Node >= 22 (see `.nvmrc`), npm, TypeScript.
- Env vars are documented in `.env.example`; never commit real secrets.
- Do not commit or push unless asked.
