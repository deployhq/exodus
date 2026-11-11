import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { commitAndPush, ensureDeployKey, ensureRepo, githubToken } from './github.ts';
import { asList, dhq, dhqBase, dhqConfigFromEnv, DhqError } from './deployhq.ts';
import type { DhqConfig } from './deployhq.ts';

export type PublishLog = (line: string) => void;
export type PublishStep = 'build' | 'github' | 'project' | 'repository' | 'site' | 'deploy' | 'live';
export interface PublishOptions {
  slug: string;
  astroSrcDir: string;
  workDir: string;
  log: PublishLog;
  onStep: (step: PublishStep, status: 'running' | 'done' | 'failed' | 'skipped', detail?: string) => void;
}
export interface PublishResult {
  repoUrl: string;
  projectUrl: string;
  liveUrl: string;
  customDomainUrl: string | null;
  warnings: string[];
}

const EXCLUDE = new Set(['node_modules', 'dist', '.astro', '.git']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function runCmd(cmd: string, args: string[], cwd: string, log: PublishLog): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onData = (buf: Buffer) => {
      const s = buf.toString();
      tail = (tail + s).slice(-2000);
      for (const line of s.split('\n')) if (line.trim()) log(line.trimEnd());
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', rej);
    child.on('close', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${tail.slice(-500)}`)));
  });
}

/** Returns the subpath (e.g. "plumber-02") when dist has no root index.html. */
export function findEntrySubpath(distDir: string): string | null {
  if (existsSync(join(distDir, 'index.html'))) return null;
  const dirs = readdirSync(distDir)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.'))
    .filter((d) => statSync(join(distDir, d)).isDirectory() && existsSync(join(distDir, d, 'index.html')))
    .sort();
  if (!dirs.length) throw new Error(`Build produced no index.html in ${distDir}`);
  return dirs[0];
}

export function redirectHtml(subpath: string): string {
  const href = `/${subpath}/`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting</title>` +
    `<meta http-equiv="refresh" content="0; url=${href}"><link rel="canonical" href="${href}"></head>` +
    `<body><a href="${href}">Continue to ${href}</a></body></html>\n`;
}

async function step<T>(name: PublishStep, opts: PublishOptions, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> {
  opts.onStep(name, 'running');
  const t0 = Date.now();
  try {
    const r = await fn();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    opts.onStep(name, 'done', `${detail ? detail(r) + ' ' : ''}(${secs}s)`);
    return r;
  } catch (e: any) {
    opts.onStep(name, 'failed', e?.message);
    throw e;
  }
}

async function getProject(cfg: DhqConfig, permalink: string) {
  return dhq(cfg, 'GET', `/projects/${permalink}`);
}

async function createServer(cfg: DhqConfig, p: string, body: unknown, log: PublishLog): Promise<any> {
  try {
    return await dhq(cfg, 'POST', `/projects/${p}/servers`, body, 180_000);
  } catch (e) {
    if (e instanceof DhqError && e.status === 429) {
      log('Provisioning rate limited (429); waiting 30s and retrying once');
      await sleep(30_000);
      return dhq(cfg, 'POST', `/projects/${p}/servers`, body, 180_000);
    }
    throw e;
  }
}

export async function publish(opts: PublishOptions): Promise<PublishResult> {
  try { process.loadEnvFile?.('.env'); } catch { /* no .env: rely on the environment */ }
  const { slug, log } = opts;
  const warnings: string[] = [];
  const warn = (w: string) => { warnings.push(w); log(`WARNING: ${w}`); };
  const name = `exodus-${slug}`;
  const owner = process.env.GITHUB_OWNER || '';
  if (!owner) throw new Error('GITHUB_OWNER must be set');
  const zone = (process.env.STATIC_HOSTING_CUSTOM_DOMAIN_ZONE || '').trim();
  const cfg = dhqConfigFromEnv();
  const repoDir = resolve(opts.workDir, 'repo');

  // 1. build
  const subpath = await step('build', opts, async () => {
    rmSync(repoDir, { recursive: true, force: true });
    mkdirSync(repoDir, { recursive: true });
    cpSync(resolve(opts.astroSrcDir), repoDir, {
      recursive: true,
      filter: (src) => !EXCLUDE.has(basename(src)),
    });
    await runCmd('npm', ['install', '--no-audit', '--no-fund'], repoDir, log);
    await runCmd('npm', ['run', 'build'], repoDir, log);
    writeFileSync(join(repoDir, '.gitignore'), 'node_modules/\n.astro/\n');
    const dist = join(repoDir, 'dist');
    if (!existsSync(dist)) throw new Error('npm run build produced no dist/ directory');
    const sub = findEntrySubpath(dist);
    if (sub) {
      writeFileSync(join(dist, 'index.html'), redirectHtml(sub));
      log(`Site lives under /${sub}/; wrote dist/index.html redirect`);
    }
    return sub;
  }, (s) => (s ? `subpath /${s}/` : 'root'));

  // 2. github
  const token = githubToken();
  const { repoUrl, sha } = await step('github', opts, async () => {
    const r = await ensureRepo(token, owner, name);
    log(`${r.created ? 'Created' : 'Reusing'} repo ${r.repoUrl}`);
    const sha = commitAndPush(repoDir, token, owner, name, `Exodus migration of ${slug}`);
    log(`Pushed ${sha} to main`);
    return { repoUrl: r.repoUrl, sha };
  }, (r) => r.sha.slice(0, 7));

  // 3. project
  const project = await step('project', opts, async () => {
    const all = asList(await dhq(cfg, 'GET', '/projects'));
    const found = all.find((p) => p.name === name);
    if (found) {
      log(`Reusing project ${found.permalink}`);
      return getProject(cfg, found.permalink);
    }
    const created = await dhq(cfg, 'POST', '/projects', { project: { name } });
    log(`Created project ${created.permalink}`);
    return created;
  }, (p) => p.permalink);
  const p = project.permalink as string;
  const projectUrl = `${dhqBase(cfg)}/projects/${p}`;

  // 4. repository
  const current = await getProject(cfg, p);
  if (current?.repository?.url) {
    opts.onStep('repository', 'skipped', current.repository.url);
  } else {
    await step('repository', opts, async () => {
      const key = current?.public_key || project.public_key;
      if (!key) throw new Error(`Project ${p} has no public_key`);
      const added = await ensureDeployKey(token, owner, name, `DeployHQ ${name}`, key);
      log(added ? 'Added DeployHQ deploy key to GitHub' : 'Deploy key already on GitHub');
      const url = `git@github.com:${owner}/${name}.git`;
      await dhq(cfg, 'POST', `/projects/${p}/repository`,
        { repository: { scm_type: 'git', url, branch: 'main' } }, 120_000);
      return url;
    }, (u) => u);
  }

  // 5. site
  let customDomainUrl: string | null = null;
  const server = await step('site', opts, async () => {
    const servers = asList(await dhq(cfg, 'GET', `/projects/${p}/servers`));
    let srv = servers.find((s) => s.protocol_type === 'static_hosting');
    if (srv) {
      log(`Reusing static hosting server ${srv.identifier}`);
    } else {
      const hw: Record<string, unknown> = { subdomain: slug, subdirectory: 'dist' };
      if (zone) hw.custom_domain_hostname = `${slug}.${zone}`;
      const body = { server: { name: slug, protocol_type: 'static_hosting' }, hosted_website_attributes: hw };
      try {
        srv = await createServer(cfg, p, body, log);
      } catch (e) {
        if (zone && e instanceof DhqError && e.status >= 400 && e.status < 500 && e.status !== 429 &&
            /domain|plan|trial|paid/i.test(e.body)) {
          warn(`Custom domain ${slug}.${zone} refused (HTTP ${e.status}): ${e.body}. Retrying without it.`);
          delete hw.custom_domain_hostname;
          srv = await createServer(cfg, p, body, log);
        } else {
          throw e;
        }
      }
      if (Array.isArray(srv.custom_domain_errors) && srv.custom_domain_errors.length) {
        warn(`Custom domain not added: ${srv.custom_domain_errors.join('; ')}`);
      }
      log(`Created static hosting server ${srv.identifier}`);
    }
    // Poll provisioning.
    const deadline = Date.now() + 180_000;
    let status = srv.static_hosting?.status;
    while (status === 'provisioning' || !srv.static_hosting?.url) {
      if (Date.now() > deadline) throw new Error(`Site still ${status} after 3 minutes`);
      await sleep(3000);
      srv = await dhq(cfg, 'GET', `/projects/${p}/servers/${srv.identifier}`);
      if (srv.static_hosting?.status !== status) log(`Site status: ${srv.static_hosting?.status}`);
      status = srv.static_hosting?.status;
    }
    if (status === 'error') throw new Error(`Static hosting provisioning failed (status error) for ${srv.identifier}`);
    let domains: any[] = Array.isArray(srv.custom_domains) ? srv.custom_domains : [];
    if (zone && !domains.length) {
      try {
        domains = asList(await dhq(cfg, 'GET', `/projects/${p}/servers/${srv.identifier}/custom_domains`));
      } catch (e: any) {
        warn(`Could not read custom domains: ${e?.message}`);
      }
    }
    if (zone) {
      const want = `${slug}.${zone}`;
      const cd = domains.find((d) => d.hostname === want);
      if (cd) {
        customDomainUrl = `https://${want}`;
        log(`Custom domain ${want}: status=${cd.status} ssl=${cd.ssl_status ?? 'n/a'}`);
        if (cd.status !== 'active') {
          const dns = (cd.dns_records || []).map((r: any) => `${r.type} ${r.name} -> ${r.value}`).join(', ');
          warn(`Custom domain ${want} is ${cd.status} (ssl ${cd.ssl_status ?? 'n/a'}); needs DNS: ${dns}`);
        }
      } else if (!warnings.some((w) => w.includes('Custom domain'))) {
        warn(`Custom domain ${want} not present on the site`);
      }
    }
    return srv;
  }, (s) => `${s.identifier} ${s.static_hosting?.url}`);

  const baseUrl = String(server.static_hosting.url).replace(/\/+$/, '');
  const liveUrl = subpath ? `${baseUrl}/${subpath}/` : `${baseUrl}/`;

  // 6. deploy
  await step('deploy', opts, async () => {
    const dep = await dhq(cfg, 'POST', `/projects/${p}/deployments`, {
      deployment: { parent_identifier: server.identifier, branch: 'main', end_revision: sha },
    }, 120_000);
    const id = dep.identifier;
    log(`Deployment ${id} queued (${dep.status})`);
    let last = dep.status;
    const deadline = Date.now() + 600_000;
    while (true) {
      if (last === 'completed') return id;
      if (last === 'failed' || last === 'cancelled') throw new Error(`Deployment ${id} ${last}`);
      if (Date.now() > deadline) throw new Error(`Deployment ${id} still ${last} after 10 minutes`);
      await sleep(3000);
      const d = await dhq(cfg, 'GET', `/projects/${p}/deployments/${id}`);
      if (d.status !== last) log(`Deployment status: ${last} -> ${d.status}`);
      last = d.status;
    }
  }, (id) => id);

  // 7. live
  await step('live', opts, async () => {
    const deadline = Date.now() + 120_000;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(liveUrl, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
        lastStatus = res.status;
        if (res.status === 200) return liveUrl;
      } catch { /* retry */ }
      await sleep(3000);
    }
    throw new Error(`${liveUrl} did not answer 200 within 2 minutes (last HTTP ${lastStatus})`);
  }, (u) => `200 ${u}`);

  return { repoUrl, projectUrl, liveUrl, customDomainUrl, warnings };
}
