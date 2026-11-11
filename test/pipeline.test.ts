import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobStore } from '../src/lib/migration/jobs.ts';
import { startMigration } from '../src/lib/migration/pipeline.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'exodus-pipe-'));
const okWp = async () => {};

function fakeEngine(base: string) {
  return async ({ log }: any) => {
    const runDir = path.join(base, 'runs', 'websitedemos-net-agency-02');
    fs.mkdirSync(path.join(runDir, 'verify-translation'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'verify-translation', 'report.html'), '<html>');
    log('engine ran');
    return { siteId: 'websitedemos-net-agency-02', runDir, astroSrcDir: path.join(runDir, 'astro-src'), summary: {}, warnings: ['strict verify failed'] };
  };
}

test('success path: steps done, result set', async () => {
  const base = tmp();
  const store = new JobStore(path.join(base, 'jobs'));
  let opts: any;
  const { job, done } = startMigration('https://websitedemos.net/agency-02/', {
    store,
    baseDir: base,
    checkWordPress: okWp,
    runEngine: fakeEngine(base),
    publish: async (o) => {
      opts = o;
      for (const st of ['build', 'github', 'project', 'repository', 'site', 'deploy', 'live'] as const) {
        o.onStep(st, 'running');
        o.onStep(st, 'done', st);
      }
      return { repoUrl: 'https://github.com/x/y', projectUrl: 'https://p', liveUrl: 'https://l', customDomainUrl: null, warnings: ['w2'] };
    },
  });
  assert.equal(job.slug, 'websitedemos-agency-02');
  const final = await done;
  assert.equal(final.status, 'succeeded', final.error ?? '');
  assert.ok(final.steps.every((s) => s.status === 'done'));
  assert.equal(final.result?.liveUrl, 'https://l');
  assert.ok(final.result?.reports.verifyTranslation?.endsWith('report.html'));
  assert.equal(final.result?.reports.astroQuality, null);
  assert.deepEqual(final.warnings, ['strict verify failed', 'w2']);
  assert.equal(opts.slug, 'websitedemos-agency-02');
  assert.equal(opts.workDir, path.join(base, 'work', job.id));
  assert.ok(fs.existsSync(opts.workDir));
  const disk = JSON.parse(fs.readFileSync(path.join(base, 'jobs', `${job.id}.json`), 'utf8'));
  assert.equal(disk.status, 'succeeded');
});

test('failure in publish marks the failed step and sets the error', async () => {
  const base = tmp();
  const store = new JobStore(path.join(base, 'jobs'));
  const { done } = startMigration('https://websitedemos.net/agency-02/', {
    store,
    baseDir: base,
    checkWordPress: okWp,
    runEngine: fakeEngine(base),
    publish: async (o) => {
      o.onStep('build', 'running');
      o.onStep('build', 'done');
      o.onStep('github', 'running');
      throw new Error('GitHub said no');
    },
  });
  const final = await done;
  assert.equal(final.status, 'failed');
  assert.equal(final.error, 'GitHub said no');
  const by = Object.fromEntries(final.steps.map((s) => [s.name, s.status]));
  assert.equal(by.build, 'done');
  assert.equal(by.github, 'failed');
  assert.equal(by.project, 'pending');
  assert.equal(final.steps.find((s) => s.name === 'github')?.detail, 'GitHub said no');
});

test('engine failure marks extract failed', async () => {
  const base = tmp();
  const { done } = startMigration('https://wptavern.com/', {
    store: new JobStore(path.join(base, 'jobs')),
    baseDir: base,
    checkWordPress: okWp,
    runEngine: async () => { throw new Error('engine did not build'); },
    publish: async () => { throw new Error('unreachable'); },
  });
  const final = await done;
  assert.equal(final.status, 'failed');
  assert.equal(final.steps.find((s) => s.name === 'extract')?.status, 'failed');
});

test('not WordPress fails validate', async () => {
  const base = tmp();
  const { done } = startMigration('https://wptavern.com/', {
    store: new JobStore(path.join(base, 'jobs')),
    baseDir: base,
    checkWordPress: async () => { throw new Error("This doesn't look like a WordPress site"); },
    runEngine: async () => { throw new Error('unreachable'); },
  });
  const final = await done;
  assert.equal(final.steps[0].status, 'failed');
  assert.match(final.error ?? '', /WordPress/);
});

test('bad URLs throw synchronously with 400/422', () => {
  const store = new JobStore(tmp());
  assert.throws(() => startMigration('not a url', { store }), (e: any) => e.status === 400);
  assert.throws(() => startMigration('https://example.com/', { store }), (e: any) => e.status === 422);
});
