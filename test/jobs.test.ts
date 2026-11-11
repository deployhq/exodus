import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobStore, STEPS } from '../src/lib/migration/jobs.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'exodus-jobs-'));

test('create, step transitions and persistence', () => {
  const dir = tmp();
  const s = new JobStore(dir);
  const { job } = s.create('https://wptavern.com/', 'wptavern');
  assert.equal(job.status, 'queued');
  assert.deepEqual(job.steps.map((x) => x.name), STEPS.map((x) => x.name));
  assert.equal(job.steps.find((x) => x.name === 'build')?.phase, 'astro');
  s.step(job, 'validate', 'running');
  assert.ok(job.steps[0].startedAt);
  s.step(job, 'validate', 'done', 'ok');
  assert.equal(job.steps[0].status, 'done');
  assert.ok(job.steps[0].finishedAt);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, `${job.id}.json`), 'utf8'));
  assert.equal(onDisk.steps[0].status, 'done');
  // A fresh store (dev-server reload) reads it from disk; a queued job it never ran is marked failed.
  const s2 = new JobStore(dir);
  const loaded = s2.get(job.id);
  assert.equal(loaded?.id, job.id);
  assert.equal(loaded?.status, 'failed');
  assert.equal(s2.list().length, 1);
  assert.equal(s2.get('nope'), null);
  assert.equal(s2.get('../etc'), null);
});

test('dedupes active jobs by slug', () => {
  const s = new JobStore(tmp());
  const a = s.create('https://wptavern.com/', 'wptavern');
  const b = s.create('https://wptavern.com/', 'wptavern');
  assert.equal(b.existing, true);
  assert.equal(b.job.id, a.job.id);
  s.setStatus(a.job, 'failed', 'x');
  const c = s.create('https://wptavern.com/', 'wptavern');
  assert.equal(c.existing, false);
  assert.notEqual(c.job.id, a.job.id);
});

test('log keeps the last 200 lines', () => {
  const s = new JobStore(tmp());
  const { job } = s.create('https://wptavern.com/', 'w');
  for (let i = 0; i < 250; i++) s.log(job, `l${i}`);
  assert.equal(job.log.length, 200);
  assert.equal(job.log[0], 'l50');
});

test('queue runs tasks one at a time', async () => {
  const s = new JobStore(tmp());
  const order: string[] = [];
  let active = 0;
  const task = (n: string) => async () => {
    active++;
    assert.equal(active, 1);
    order.push(`${n}+`);
    await new Promise((r) => setTimeout(r, 20));
    order.push(`${n}-`);
    active--;
  };
  await Promise.all([s.enqueue(task('a')), s.enqueue(async () => { throw new Error('boom'); }).catch(() => {}), s.enqueue(task('b'))]);
  assert.deepEqual(order, ['a+', 'a-', 'b+', 'b-']);
});
