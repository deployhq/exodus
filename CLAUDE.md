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

- Astro with the Node adapter (`@astrojs/node`, `output: 'server'`). The translator is a package and runs server-side.
- `src/lib/pipeline.ts`: `translate(url)` then `publish(sourceDir)` (push to git), then a pause for the visitor to create their DeployHQ account, then `deploy(repoUrl, credentials)` (DeployHQ project, repository, static_hosting server, deployment) then staging URL. Emits progress events. The translator and the deployer sit behind small interfaces, with mock implementations until the real ones are plugged in.
- `POST /api/jobs` starts a job and returns an id. `GET /api/jobs/[id]/events` streams progress over SSE. Job state is in memory (demo scale).
- `src/lib/deployhq.ts`: client for the DeployHQ staging API. It acts as the visitor's own account, using the credentials returned by signup. Any Exodus-level credentials (bot, git host) come from env vars only, never committed.
- UI: a single page with a URL input, a stepper with live progress (pausing at the account step), and a result page with the staging link and a before/after comparison (page weight, load time, plugins removed).

## Guardrails (required, public tool)

- SSRF protection: only http(s); resolve the host and block private, loopback and link-local addresses, including after redirects.
- Rate limit per IP and a cap on concurrent jobs.
- Check that the target is really WordPress (e.g. `/wp-json/`) before running the pipeline.
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
  1. `POST /projects` `{project:{name, zone_id?, template_id?}}`
  2. `POST /projects/{id}/repository` `{repository:{url, scm_type:'git', branch, username?, password?}}`
  3. `POST /projects/{id}/servers` `{server:{name, protocol_type:'static_hosting'}, hosted_website_attributes:{subdomain, spa_mode, subdirectory}}`
  4. `POST /projects/{id}/deployments` `{deployment:{parent_identifier:<server id>, mode:'queue', run_build_commands:true, use_latest:true}}`
  5. Poll `GET /projects/{id}/deployments/{id}` (status: pending, running, completed, failed) and `GET /hosted_resources/{id}` for the site URL.
- `POST /detection` can detect the framework and suggest the static-hosting output directory (Astro: `dist`) and build commands.
- Open API details to verify against a real staging account: the exact `hosted_website` response shape (where the public URL lives) and the `subdomain` rules.

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

- Ownership proof (DNS TXT or meta tag) before a preview is publicly reachable, versus only the WordPress check. Decide before launch.
- Preview hardening: `noindex`, unlisted, short-lived, "preview, not the original site" banner. Needs the expiry value and a place to apply it (translator output or hosting).
- FAQ answers (cost, client sites, Elementor/Divi, SEO) and a GA4 measurement ID.
- Canonical URL and final domain for this site (the draft's `www.deployhq.com` convention applies to the marketing site, not necessarily to this app).

- Translator package: name, install method, entry-point signature.
- Git host for generated sites: the translator output must be pushed to a repo DeployHQ can reach (e.g. one repo per demo in a dedicated GitHub org, or a repo with a branch per demo). Needs a decision, a bot credential, and a cleanup policy.
- Which DeployHQ environment (staging vs production) the signup and the previews target, and the rate-limit allowlist for the Exodus server (see "Account creation").
- Plan or trial for the accounts Exodus creates, and the flow for visitors whose email already has an account.
- Lifetime of previews and of accounts that never come back (cleanup policy).

## Conventions

- Node >= 22 (see `.nvmrc`), npm, TypeScript.
- Env vars are documented in `.env.example`; never commit real secrets.
- Do not commit or push unless asked.
