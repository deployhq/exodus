// validate -> engine (scan, copy, translate to Astro) -> publish (GitHub + DeployHQ Static Hosting).
import fs from 'node:fs';
import path from 'node:path';
import { deriveSlug } from './slug.ts';
import { runEngine, validateUrl } from './engine.ts';
import { defaultStore } from './jobs.ts';
import type { Job, JobStore, StepName } from './jobs.ts';
import type { EngineOptions, EngineResult } from './engine.ts';
import type { PublishOptions, PublishResult } from './publish.ts';

export interface PipelineOverrides {
  store?: JobStore;
  runEngine?: (opts: EngineOptions) => Promise<EngineResult>;
  publish?: (opts: PublishOptions) => Promise<PublishResult>;
  baseDir?: string; // defaults to <cwd>/.exodus
  checkWordPress?: (url: string) => Promise<void>;
}

export const NOT_WORDPRESS = "This doesn't look like a WordPress site";

// GET <origin><path>wp-json/ then <origin>/wp-json/; expect a 200 JSON response.
export async function checkWordPress(url: string): Promise<void> {
  const u = new URL(url);
  const pathBase = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
  const candidates = [...new Set([`${u.origin}${pathBase}wp-json/`, `${u.origin}/wp-json/`])];
  for (const c of candidates) {
    try {
      const r = await fetch(c, { headers: { accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (r.status !== 200) continue;
      const ct = r.headers.get('content-type') || '';
      const body = await r.text();
      if (ct.includes('json')) return;
      try {
        JSON.parse(body);
        return;
      } catch {}
    } catch {}
  }
  throw new Error(`${NOT_WORDPRESS} (no WordPress REST API at ${candidates.join(' or ')})`);
}

export interface StartResult {
  job: Job;
  existing: boolean;
  done: Promise<Job>;
}

// Throws an Error with .status 400/422 for a bad URL, so the route can answer synchronously.
export function startMigration(url: string, overrides: PipelineOverrides = {}): StartResult {
  const check = validateUrl(url);
  if (!check.ok) {
    const err: any = new Error(check.error);
    err.status = check.status;
    throw err;
  }
  const store = overrides.store ?? defaultStore();
  const slug = deriveSlug(check.url);
  const { job, existing } = store.create(check.url, slug);
  if (existing) return { job, existing, done: waitFor(store, job) };
  const done = store.enqueue(() => runJob(store, job, overrides)).then(() => job);
  return { job, existing, done };
}

function waitFor(store: JobStore, job: Job): Promise<Job> {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (job.status === 'succeeded' || job.status === 'failed') {
        clearInterval(t);
        resolve(job);
      }
    }, 500);
  });
}

async function runJob(store: JobStore, job: Job, o: PipelineOverrides): Promise<void> {
  const base = o.baseDir ?? path.resolve(process.cwd(), '.exodus');
  const log = (line: string) => store.log(job, line);
  let current: StepName = 'validate';
  store.setStatus(job, 'running');
  try {
    store.step(job, 'validate', 'running');
    const check = validateUrl(job.url);
    if (!check.ok) throw new Error(check.error);
    await (o.checkWordPress ?? checkWordPress)(job.url);
    store.step(job, 'validate', 'done', `slug ${job.slug}`);

    current = 'extract';
    store.step(job, 'extract', 'running');
    const engine = o.runEngine ?? runEngine;
    const eng = await engine({ url: job.url, workDir: path.join(base, 'work'), log });
    job.warnings.push(...eng.warnings);
    store.step(job, 'extract', 'done', eng.astroSrcDir);

    const publish = o.publish ?? (await import('./publish.ts')).publish;
    const workDir = path.join(base, 'work', job.id);
    fs.mkdirSync(workDir, { recursive: true });
    const res = await publish({
      slug: job.slug,
      astroSrcDir: eng.astroSrcDir,
      workDir,
      log,
      onStep: (step, status, detail) => {
        if (status === 'running') current = step;
        store.step(job, step, status, detail);
      },
    });
    job.warnings.push(...(res.warnings ?? []));
    const reportPath = (rel: string) => {
      const f = path.join(eng.runDir, rel);
      return fs.existsSync(f) ? f : null;
    };
    job.result = {
      liveUrl: res.liveUrl,
      customDomainUrl: res.customDomainUrl,
      repoUrl: res.repoUrl,
      projectUrl: res.projectUrl,
      reports: {
        // A skipped verify (EXODUS_VERIFY=off) must not surface a stale report from an earlier run.
        verifyTranslation: eng.summary?.stages?.translation?.verify?.skipped ? null : reportPath('verify-translation/report.html'),
        astroQuality: reportPath('astro-quality.md'),
      },
    };
    // Steps publish never reported (e.g. no 'live' callback) are marked done on success.
    for (const s of job.steps) if (s.status === 'pending' || s.status === 'running') store.step(job, s.name, 'done');
    store.setStatus(job, 'succeeded');
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    log(`error: ${msg}`);
    const running = job.steps.find((s) => s.status === 'running');
    store.step(job, running ? running.name : current, 'failed', msg);
    for (const s of job.steps) if (s.status === 'running') store.step(job, s.name, 'failed');
    store.setStatus(job, 'failed', msg);
  }
}
