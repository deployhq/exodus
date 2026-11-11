// Pure UI logic for the migration progress/result screens. No DOM, no Node APIs, so it runs in the
// browser and under plain `node` type stripping. Never surface the API's step labels, log, raw
// error text or repo/project URLs: our own copy is keyed on step name and phase only.
import type { Job, JobStep } from '../migration/jobs.ts';

export type View = 'progress' | 'succeeded' | 'failed';

const STEP_MESSAGES: Record<string, string> = {
  validate: 'Checking your WordPress site…',
  extract: 'Analyzing your page…',
};

const PHASE_MESSAGES: Record<string, string> = {
  content: 'Analyzing your page…',
  astro: 'Building your new site…',
  deploy: 'Putting it live…',
};

export const QUEUED_MESSAGE = 'Waiting for a free slot…';
export const STARTING_MESSAGE = 'Getting started…';

export function viewFor(job: Pick<Job, 'status'>): View {
  if (job.status === 'succeeded') return 'succeeded';
  if (job.status === 'failed') return 'failed';
  return 'progress';
}

// The step the job is on: the running one, else the first not yet finished.
export function currentStep(job: Pick<Job, 'steps'>): JobStep | null {
  const steps = job.steps ?? [];
  return (
    steps.find((s) => s.status === 'running') ??
    steps.find((s) => s.status === 'pending' || s.status === 'failed') ??
    null
  );
}

export function statusMessage(job: Pick<Job, 'status' | 'steps'>): string {
  if (job.status === 'queued') return QUEUED_MESSAGE;
  const step = currentStep(job);
  if (!step) return STARTING_MESSAGE;
  return STEP_MESSAGES[step.name] ?? PHASE_MESSAGES[step.phase] ?? STARTING_MESSAGE;
}

// The one link to show on success. Always the staging URL: custom domains are not offered yet
// (CLAUDE.md "Landing page copy rules"), so customDomainUrl is deliberately ignored.
export function liveLink(job: Pick<Job, 'result'>): string | null {
  return job.result?.liveUrl || null;
}

// Hostname only, for analytics params (never a full URL).
export function hostnameOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

// Friendly copy for a failed job. The server's message is for operators; only the
// "not WordPress" validate failure is safe and useful to translate.
export function failureMessage(job: Pick<Job, 'steps' | 'error'>): string {
  const failed = (job.steps ?? []).find((s) => s.status === 'failed');
  const text = `${job.error ?? ''} ${failed?.detail ?? ''}`;
  if (failed?.name === 'validate' && /wordpress/i.test(text)) {
    return "This doesn't look like a WordPress site. Check the address and try again.";
  }
  if (failed?.phase === 'deploy') {
    return 'Your site was rebuilt, but we couldn’t put it live this time. Please try again in a few minutes.';
  }
  return 'Something went wrong while migrating this site. Please try again in a few minutes.';
}

// HTTP status from POST /api/jobs -> message under the input. Never echo the server text.
export function submitErrorMessage(status: number): string {
  if (status === 400) return 'That doesn’t look like a valid web address.';
  if (status === 422) {
    return 'We can’t migrate this site yet — Exodus is in early access and only works with a few sites for now.';
  }
  if (status === 429) return 'Too many migrations right now. Please try again in a few minutes.';
  return 'Something went wrong on our side. Please try again in a moment.';
}

// 65_000 -> "1:05", 3_725_000 -> "1:02:05".
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Elapsed time of a job, measured from its creation; frozen at updatedAt once finished.
export function elapsedMs(job: Pick<Job, 'status' | 'createdAt' | 'updatedAt'>, now: number): number {
  const start = Date.parse(job.createdAt);
  if (!Number.isFinite(start)) return 0;
  const done = job.status === 'succeeded' || job.status === 'failed';
  const end = done ? Date.parse(job.updatedAt) : now;
  return Math.max(0, (Number.isFinite(end) ? end : now) - start);
}

// A job id as the store accepts it (see JobStore.get).
export function isJobId(id: string | null): id is string {
  return !!id && /^[A-Za-z0-9-]{1,64}$/.test(id);
}

// job.warnings are operator strings from the engine ("engine exited 1: ...", "translation stage:
// <error>"), so they are never rendered. Any warning becomes one calm, visitor-facing note.
export function warningNotes(job: Pick<Job, 'warnings'>): string[] {
  return job.warnings?.length
    ? ['Some parts of your site may not match the original exactly. Compare the two before you share the link.']
    : [];
}
