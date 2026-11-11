# Exodus

Paste a WordPress URL and get a live preview of that site rebuilt as a static Astro project, hosted on [DeployHQ Sites](https://www.deployhq.com). It is a free demo and a funnel for DeployHQ, aimed at agencies and freelancers who maintain many WordPress sites.

Example: `https://websitedemos.net/agency-02/` becomes `https://websitedemos-agency-02-staging.deployhq-sites.com`. On mobile PageSpeed, the performance score went from 58 to 92.

## How it works

1. **Pull content.** The service checks the URL is an allowed WordPress site, then runs the engine ([`hackathon-wp-static`](https://github.com/deployhq/hackathon-wp-static)), which crawls the site and translates it into an Astro project.
2. **Rebuild in Astro.** It builds that project.
3. **Deploy.** It pushes the result to a private GitHub repo, creates a DeployHQ project with Static Hosting through the DeployHQ API, deploys, and waits until the site is live.

The landing page and the progress UI call a small HTTP API (`POST /api/jobs`, then SSE on `/api/jobs/[id]/events`). Everything else runs on the server. The API contract is in [docs/MIGRATION-SERVICE.md](docs/MIGRATION-SERVICE.md).

## Run it locally

You need Node 22.23.4 or newer (`.nvmrc` pins 24.12.0) and GitHub access to the private engine repo.

```sh
nvm use
npm install
cp .env.example .env   # fill in the DeployHQ staging and GitHub values; never commit .env
npm run dev            # http://localhost:4321
```

The engine drives a browser. If Chromium for Playwright is missing:

```sh
cd node_modules/hackathon-wp-static && npx playwright install chromium
```

## Commands

| Command | What it does |
| :-- | :-- |
| `npm run dev` | Start the dev server |
| `npm run build` | Build the site and the Node server |
| `npm run preview` | Preview the build |
| `npm run migrate -- <url>` | Run the migration pipeline in the foreground |
| `npm test` | Run the tests (`node --test`) |

## Configuration

Variables are documented in [`.env.example`](.env.example). `SITE_URL` (the public origin) is optional locally and needed for canonical URLs, `robots.txt` and the sitemap in production.

For the demo, only a short allowlist of hosts can be translated. See [docs/MIGRATION-SERVICE.md](docs/MIGRATION-SERVICE.md) before adding hosts.

## Status

Hackathon project. The pipeline works for allowed hosts. Before this is public it still needs SSRF filtering of arbitrary hosts, per-IP rate limits, `noindex` on generated previews and the account-creation step. The decided design and open questions are in [CLAUDE.md](CLAUDE.md).
