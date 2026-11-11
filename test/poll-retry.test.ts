import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DhqError, isTransientError, retryPoll } from '../src/lib/migration/deployhq.ts';
import { waitForDeployment } from '../src/lib/migration/publish.ts';

const noSleep = async () => {};
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

test('deploy poll survives two timeouts and returns when the deployment completes', async () => {
  let calls = 0;
  const fakeGet = async () => {
    calls++;
    if (calls <= 2) throw timeoutError();
    return { status: 'completed' };
  };
  const lines: string[] = [];
  const id = await waitForDeployment(fakeGet, 'dep-1', 'pending', (l) => lines.push(l), { sleepFn: noSleep });
  assert.equal(id, 'dep-1');
  assert.equal(calls, 3);
  assert.equal(lines.filter((l) => l.includes('retrying')).length, 2);
  assert.ok(lines.includes('Deployment status: pending -> completed'));
});

test('deploy poll fails at once on a non-transient 4xx', async () => {
  let calls = 0;
  const fakeGet = async () => { calls++; throw new DhqError('nope', 404, ''); };
  await assert.rejects(waitForDeployment(fakeGet, 'dep-2', 'pending', () => {}, { sleepFn: noSleep }), /nope/);
  assert.equal(calls, 1);
});

test('retryPoll gives up once the deadline has passed', async () => {
  let calls = 0;
  const fn = async () => { calls++; throw timeoutError(); };
  await assert.rejects(retryPoll('x', fn, Date.now() - 1, () => {}, noSleep), /timeout/);
  assert.equal(calls, 1);
});

test('isTransientError classifies errors', () => {
  assert.equal(isTransientError(timeoutError()), true);
  assert.equal(isTransientError(new TypeError('fetch failed')), true);
  assert.equal(isTransientError(new DhqError('', 503, '')), true);
  assert.equal(isTransientError(new DhqError('', 429, '')), true);
  assert.equal(isTransientError(new DhqError('', 422, '')), false);
  assert.equal(isTransientError(new Error('Deployment x failed')), false);
});
