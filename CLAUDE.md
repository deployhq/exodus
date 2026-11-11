# CLAUDE.md

@AGENTS.md

## What Exodus is

Exodus is a free demo and funnel for DeployHQ. A visitor enters the URL of a WordPress site. The translator rebuilds it as a static Astro site, and the result is hosted on DeployHQ Sites **staging**, inside a new DeployHQ account created for the visitor, so they can see it live. This repo is the **website only**: the translator is a separate package (not yet plugged in) that this app calls on the server.

## The pain we solve

Agencies and freelancers running many WordPress sites pay the "WordPress tax": servers and Plesk, plugin updates, security patches. The reference story is an agency that moved 40 WP sites to Astro on Cloudflare Workers: 2-3 months of work, about $90/month saved, faster sites. Exodus gives that result for free, in minutes, and leads the visitor to DeployHQ.

- Audience: agencies and freelancers with portfolios, not single-site owners.
- Pitch: before/after. Same site, no plugins, no patching, faster.
- Funnel: paste URL, build, create the DeployHQ account (the conversion step), live staging link, then production deploy and custom domain. See "Account creation" below.
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
- UI (built part): a single page with a URL input and a stepper with live progress. Still to build: the account step, and a result page with the staging link and a before/after comparison (page weight, load time, plugins removed).
- **Planned, not built** (see "Account creation"): after the translation and publish steps, the pipeline pauses for the visitor to create their DeployHQ account, then deploys as that account. `deployhq.ts` then acts as the visitor's own account, using the credentials returned by signup, instead of a shared staging account. Any Exodus-level credentials (bot, git host) come from env vars only, never committed.

## Guardrails (required, public tool)

- SSRF protection: only http(s); resolve the host and block private, loopback and link-local addresses, including after redirects.
- Rate limit per IP and a cap on concurrent jobs.
- Check that the target is really WordPress (e.g. `/wp-json/`) before running the pipeline.
- **Status for the hackathon demo:**
  - Done: the engine's host allowlist (`WP_STATIC_ALLOW_HOSTS`, which is stricter than SSRF filtering), one job at a time, and the `/wp-json/` check.
  - Not done: SSRF filtering of arbitrary hosts and per-IP rate limits. Both are needed before this is public.
- Creating the DeployHQ account is the conversion step, so it needs bot protection too (see "Account creation").

## Account creation (decided, not implemented)

Previews are deployed into a real DeployHQ account created for the visitor, not a shared staging account. Exodus creates it with `POST /api/v1/signup` (no auth) and deploys with the credentials it returns.

- Request: `email`, `password`, `terms_accepted` (must be true), optional `account_name`, `package`, `signup_source`, `client`, `utm_params`. Response (201): API credentials and an SSH public key. Errors: 400, 403, 409 (account exists), 422, 429, 503.
- When to ask: **after the translation finishes, before the deploy.** The visitor pastes a URL and the build starts with no account (translation doesn't need DeployHQ). The stepper shows "pulled content, rebuilt in Astro", then pauses with "Create your free DeployHQ account to put it live". Email and password go to signup, then the deploy steps run. This is better than asking up front because the visitor has seen the build work before committing.
- Copy: the page must not promise "no signup" before the preview.
- Password handling: Exodus only forwards the password to the signup endpoint over TLS. Never log it, store it, or put it in job state. Hold the returned API key only as long as the job needs it (in memory).
- Send `client` and `signup_source` (e.g. `exodus`) plus UTM params so these signups can be attributed.
- Bot protection: a public form that creates real accounts needs a challenge (e.g. Turnstile) on top of the per-IP limits. The translation work before the gate still needs the WordPress check and a concurrency cap.

Verify against staging before building:

- **Rate limits.** Signup is limited per IP, per email and globally. Every signup from Exodus comes from one server IP, so it will hit the per-IP limit. Needs an allowlist from the DeployHQ team or a way to forward the visitor's IP.
- **Existing email (409).** Needs a path for visitors who already have an account. There is no known way to create an API key without being authenticated already (`POST /security/api_keys` requires basic auth).
- **Plan.** `package` defaults to `pro`. Pick the plan (and any trial) deliberately.
- **SSH public key.** If it is the key DeployHQ uses to read repositories, add it as a deploy key on the generated private repo. That could settle git access for private repos. Not confirmed.
- **Immediate use.** The spec says the credentials are usable immediately; confirm no email verification blocks the first deploy.

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

## Landing page copy rules

Source: `exodus-landing-copy.md` (internal marketing draft, 2026-11-11, outside this repo). Rules that apply to anything user-facing here:

- Do NOT claim custom domains, redirects, form handling, or "go live on your own domain" until they ship. This also means the result page must not offer a custom-domain step yet.
- Do not publish unverified claims. The draft marks them **[verify]**; they are left out of the page until confirmed: same URLs, optimized images, repo export, `noindex`/unlisted previews, preview expiry (`[X days]`), read-only crawl guarantee.
- Do not name or quote the author of the reference tweet in public copy.
- Tone: second person, semi-formal, contractions OK. Avoid "simply", "just", "easy", "seamless", "leverage", "robust".
- GA4 events: `exodus_url_submitted`, `exodus_preview_ready`, `exodus_preview_opened`, `exodus_preview_shared`, `exodus_signup_clicked`. Only the first is wired (in `UrlForm.astro`, via `window.gtag`).
- `FAQPage` structured data only if the FAQ is visible with answers (the FAQ is not on the page yet). No `llms.txt` or AI-specific markup.
- The public name "Exodus" is a working name; the title should keep "WordPress to Astro" for SEO.

## SEO

- `src/components/Seo.astro` renders title, description, robots, canonical and Open Graph/Twitter tags. Every page uses it; pass `noindex` for anything that isn't the landing page.
- Canonical URLs, `robots.txt` and `sitemap.xml` need `SITE_URL` (public origin) at build time. Without it, canonical and sitemap entries are omitted.
- `/sitemap.xml` lists indexable pages only: add new public pages to `paths` in `src/pages/sitemap.xml.ts`. `robots.txt` disallows `/api/`.
- Generated preview sites must never be indexed. `src/lib/seo/noindex.ts` provides `injectNoindex(html)` and `PREVIEW_ROBOTS_TXT`. **Not wired in yet**: the publish step must apply both to the generated site's files before the git push (inject into every HTML file, write `robots.txt` at the site root). Tests: `node --test test/noindex.test.ts`.

## Open items (blocked on the team)

- ~~Translator package~~: decided. `hackathon-wp-static`, installed from GitHub and run as a child process (see Architecture).
- Git host: for the demo, one private repo per site under `GITHUB_OWNER`, using a personal `gh` token. Still open: a bot credential, a dedicated org and a cleanup policy.
- Staging account: for the hackathon demo, `thiago-qa` on staging, with credentials in a local `.env` only (ask Thiago). The planned flow replaces it with accounts created for visitors (see "Account creation").
- Ownership proof (DNS TXT or meta tag) before a preview is publicly reachable, versus only the WordPress check. Decide before launch.
- Preview hardening: `noindex`, unlisted, short-lived, "preview, not the original site" banner. Needs the expiry value and a place to apply it (translator output or hosting).
- FAQ answers (cost, client sites, Elementor/Divi, SEO) and a GA4 measurement ID.
- Canonical URL and final domain for this site (the draft's `www.deployhq.com` convention applies to the marketing site, not necessarily to this app).
- Which DeployHQ environment (staging vs production) the signup and the previews target, and the rate-limit allowlist for the Exodus server (see "Account creation").
- Plan or trial for the accounts Exodus creates, and the flow for visitors whose email already has an account.
- Lifetime of previews and of accounts that never come back (cleanup policy).

## Planned, not built: the "what didn't migrate" report

The customer should see what didn't carry over before they claim a site. Nothing in the API or UI shows this today: the job result only has local file paths (`result.reports`). The engine already records the raw data in `<engineDir>/runs/<siteId>/`:
- **`scan.json` → `features`:** things that break on a static site, each with `type`, `detail`, `pages`, `impact` and `suggestion`. For example, forms, LatePoint booking, search, comments, and plugins that need `admin-ajax.php`.
- **`translate-report.json`:** `notTranslated`, `deviations` (each with a reason) and `resolvedFeatures`.
- **`verify-translation/report.json`:** per-page visual %, plus text and structure checks.

To build:
- Read those files in `pipeline.ts`.
- Add a customer-facing `job.result.report`: what works, what doesn't and why, and the suggested replacement.
- Return it from `GET /api/jobs/[id]`, and show it on the result page next to the "claim this site" call to action.

Also missing: the **old-to-new URL map and redirects**. The site keeps the original's paths today. Redirects need the Static Hosting redirects feature, and the WordPress REST API (`/wp-json/wp/v2/pages|posts`) gives the full page inventory to check against the crawl.

## Known issue: redirect "flash" on demo sites
- **The root redirect page:** a site that lived under a subpath (`/agency-02/`) is published as-is, so `publish.ts` writes a meta-refresh page at `/`, which the visitor sees as a flash.
- **The trailing-slash redirect:** Static Hosting 301s every URL that ends in `/` to the same URL without the slash, adding `?__dhq_hops=1`. That's its loop guard, documented in the deployhq-sites repo, `docs/architecture.md`. WordPress links all end in `/`.
- **Fix on our side:** have the translator emit the site at `/` and write internal links without a trailing slash.

## Verification is off by default (EXODUS_VERIFY)

- The engine's verifier proves the copy is pixel-identical to the original and that the Astro version is at least 95% similar, page by page.
- It re-captures the live original at 3 viewports, politely rate-limited, so it takes more than 10 minutes even for a small site. That is too slow for a live demo or an interactive funnel.
- So the service skips it by default (`EXODUS_VERIFY=off` passes `--skip-verify` to the engine); a fresh run then takes about 2-3 minutes end to end.
- Set `EXODUS_VERIFY=full` to get the per-page proof (the report paths in `job.result.reports` then exist), for example when validating a new site or before a customer claims it.
- Follow-up idea: run verification asynchronously after the site is live and attach the report to the job.

## Conventions

- Node 24.12.0 (see `.nvmrc`; Astro 7 needs 22.23.4 or newer), npm, TypeScript. Server code in `src/lib/migration/` must also run under plain `node` type stripping: no enums, use `import type`, and import local files with explicit `.ts` extensions.
- Env vars are documented in `.env.example`; never commit real secrets.
- Work on a feature branch and commit and push as soon as something works; don't leave code only on a laptop. Merge to `main` through a PR.
