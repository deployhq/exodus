// DEV ONLY. Fixture jobs for previewing the progress/result screens without running a migration
// (/migration?demo=queued|running|succeeded|failed|notwp). Imported only behind
// `import.meta.env.DEV`, so production builds drop it. Shapes mirror what jobs.ts produces.
import type { Job, JobStep, StepName, Phase } from '../migration/jobs.ts';

const STEPS: [StepName, string, Phase][] = [
  ['validate', 'Checking the WordPress site', 'content'],
  ['extract', 'Crawling WordPress and converting to Astro', 'content'],
  ['build', 'Building the Astro site', 'astro'],
  ['github', 'Pushing the code to GitHub', 'deploy'],
  ['project', 'Creating the DeployHQ project', 'deploy'],
  ['repository', 'Connecting the repository', 'deploy'],
  ['site', 'Setting up Static Hosting', 'deploy'],
  ['deploy', 'Deploying', 'deploy'],
  ['live', 'Waiting for the site to go live', 'deploy'],
];

// `doneUntil` steps are done, the next one has `current` status, the rest pending.
function steps(doneUntil: number, current: JobStep['status'] | null): JobStep[] {
  return STEPS.map(([name, label, phase], i) => ({
    name,
    label,
    phase,
    status: i < doneUntil ? 'done' : i === doneUntil && current ? current : 'pending',
  }));
}

function job(over: Partial<Job>, startedMinutesAgo: number): Job {
  const created = new Date(Date.now() - startedMinutesAgo * 60_000).toISOString();
  return {
    id: 'demo',
    url: 'https://websitedemos.net/agency-02/',
    slug: 'websitedemos-agency-02',
    status: 'running',
    createdAt: created,
    updatedAt: new Date().toISOString(),
    steps: steps(0, 'running'),
    result: null,
    error: null,
    warnings: [],
    log: [],
    ...over,
  };
}

// The running demo walks through the steps so the changing status line can be seen.
export function demoTimeline(): Job[] {
  return [
    job({ status: 'queued', steps: steps(0, null) }, 0),
    job({ steps: steps(0, 'running') }, 0.1),
    job({ steps: steps(1, 'running') }, 2),
    job({ steps: steps(2, 'running') }, 12),
    job({ steps: steps(3, 'running') }, 13),
    job({ steps: steps(7, 'running') }, 14),
  ];
}

export function demoJob(kind: string): Job | null {
  switch (kind) {
    case 'queued':
      return job({ status: 'queued', steps: steps(0, null) }, 1);
    case 'running':
      return job({ steps: steps(1, 'running') }, 3);
    case 'succeeded':
      return job(
        {
          status: 'succeeded',
          steps: steps(STEPS.length, null),
          result: {
            liveUrl: 'https://websitedemos-agency-02-staging.deployhq-sites.com/',
            customDomainUrl: 'https://websitedemos-agency-02.dropsite.dev/',
            repoUrl: 'https://example.invalid/should-never-render',
            projectUrl: 'https://example.invalid/should-never-render',
            reports: {},
          },
          warnings: ['engine exited 1: the strict copy-verify stage did not pass (operator text, must never render)'],
        },
        16,
      );
    case 'failed':
      return job(
        {
          status: 'failed',
          steps: steps(3, 'failed'),
          error: 'github: 401 Bad credentials (operator message, must never render)',
        },
        14,
      );
    case 'notwp':
      return job(
        {
          status: 'failed',
          steps: steps(0, 'failed').map((s) =>
            s.name === 'validate' ? { ...s, detail: "This doesn't look like a WordPress site" } : s,
          ),
          error: "This doesn't look like a WordPress site",
        },
        0.1,
      );
    default:
      return null;
  }
}
