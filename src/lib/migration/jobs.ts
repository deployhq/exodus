// Job store: in memory, persisted to <dir>/<id>.json so a dev-server reload doesn't lose jobs.
// Plus a sequential queue (one engine at a time).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type StepName = 'validate' | 'extract' | 'build' | 'github' | 'project' | 'repository' | 'site' | 'deploy' | 'live';

export type Phase = 'content' | 'astro' | 'deploy';

export interface JobStep {
  name: StepName;
  label: string;
  phase: Phase;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
}

export interface JobResult {
  liveUrl: string;
  customDomainUrl: string | null;
  repoUrl: string;
  projectUrl: string;
  /** "v001" for a versioned run, null with EXODUS_VERSIONED=0. */
  version: string | null;
  /** Name used for the repo/project/site suffix, e.g. "plumber-02-v001". */
  name: string;
  reports: Record<string, string | null>;
}

export interface Job {
  id: string;
  url: string;
  slug: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  steps: JobStep[];
  result: JobResult | null;
  error: string | null;
  warnings: string[];
  log: string[];
}

export const PHASES: { name: Phase; label: string }[] = [
  { name: 'content', label: 'Pulling content' },
  { name: 'astro', label: 'Rebuilding in Astro' },
  { name: 'deploy', label: 'Deploying' },
];

export const STEPS: { name: StepName; label: string; phase: Phase }[] = [
  { name: 'validate', label: 'Checking the WordPress site', phase: 'content' },
  { name: 'extract', label: 'Crawling WordPress and converting to Astro', phase: 'content' },
  { name: 'build', label: 'Building the Astro site', phase: 'astro' },
  { name: 'github', label: 'Pushing the code to GitHub', phase: 'deploy' },
  { name: 'project', label: 'Creating the DeployHQ project', phase: 'deploy' },
  { name: 'repository', label: 'Connecting the repository', phase: 'deploy' },
  { name: 'site', label: 'Setting up Static Hosting', phase: 'deploy' },
  { name: 'deploy', label: 'Deploying', phase: 'deploy' },
  { name: 'live', label: 'Waiting for the site to go live', phase: 'deploy' },
];

const LOG_LIMIT = 200;
const ACTIVE: JobStatus[] = ['queued', 'running'];

export class JobStore {
  dir: string;
  jobs: Map<string, Job>;
  live: Set<string>; // ids created (or queued) by this process
  chain: Promise<void>;

  constructor(dir: string) {
    this.dir = dir;
    this.jobs = new Map();
    this.live = new Set();
    this.chain = Promise.resolve();
  }

  create(url: string, slug: string): { job: Job; existing: boolean } {
    for (const id of this.live) {
      const j = this.jobs.get(id);
      if (j && j.slug === slug && ACTIVE.includes(j.status)) return { job: j, existing: true };
    }
    const now = new Date().toISOString();
    const job: Job = {
      id: crypto.randomUUID().slice(0, 12),
      url,
      slug,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      steps: STEPS.map((s) => ({ name: s.name, label: s.label, phase: s.phase, status: 'pending' })),
      result: null,
      error: null,
      warnings: [],
      log: [],
    };
    this.jobs.set(job.id, job);
    this.live.add(job.id);
    this.save(job);
    return { job, existing: false };
  }

  get(id: string): Job | null {
    if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
    const mem = this.jobs.get(id);
    if (mem) return mem;
    const job = this.load(path.join(this.dir, `${id}.json`));
    if (job) this.jobs.set(id, job);
    return job;
  }

  list(): Job[] {
    const byId = new Map<string, Job>();
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        const j = this.load(path.join(this.dir, f));
        if (j) byId.set(j.id, j);
      }
    } catch {}
    for (const [id, j] of this.jobs) byId.set(id, j);
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // A job read from disk that this process never ran can't still be running: mark it failed.
  load(file: string): Job | null {
    let job: Job;
    try {
      job = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    if (!this.live.has(job.id) && ACTIVE.includes(job.status)) {
      job.status = 'failed';
      job.error = job.error ?? 'Interrupted: the server restarted while this job was in progress.';
      for (const s of job.steps) if (s.status === 'running') s.status = 'failed';
    }
    return job;
  }

  save(job: Job): void {
    job.updatedAt = new Date().toISOString();
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = path.join(this.dir, `${job.id}.json.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
      fs.renameSync(tmp, path.join(this.dir, `${job.id}.json`));
    } catch {}
  }

  setStatus(job: Job, status: JobStatus, error?: string): void {
    job.status = status;
    if (error !== undefined) job.error = error;
    this.save(job);
  }

  step(job: Job, name: StepName, status: StepStatus, detail?: string): void {
    const s = job.steps.find((x) => x.name === name);
    if (!s) return;
    const now = new Date().toISOString();
    if (status === 'running') s.startedAt = s.startedAt ?? now;
    if (status === 'done' || status === 'failed' || status === 'skipped') {
      s.startedAt = s.startedAt ?? now;
      s.finishedAt = now;
    }
    s.status = status;
    if (detail !== undefined) s.detail = detail;
    this.save(job);
  }

  log(job: Job, line: string): void {
    job.log.push(line);
    if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
    // Logs are chatty: persist them along with the next step change, or at most every 2 s.
    const now = Date.now();
    const last = (job as any)._lastLogSave ?? 0;
    if (now - last > 2000) {
      Object.defineProperty(job, '_lastLogSave', { value: now, enumerable: false, writable: true, configurable: true });
      this.save(job);
    }
  }

  // Run tasks one at a time, in order.
  enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => {});
    return run;
  }
}

const g = globalThis as any;

// One store per process, kept on globalThis so Vite module reloads don't create a second queue.
export function defaultStore(): JobStore {
  if (!g.__exodusJobStore) g.__exodusJobStore = new JobStore(path.resolve(process.cwd(), '.exodus', 'jobs'));
  return g.__exodusJobStore;
}
