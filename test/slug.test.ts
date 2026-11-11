import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSlug, previewHosts } from '../src/lib/migration/slug.ts';

test('deriveSlug examples', () => {
  assert.equal(deriveSlug('https://websitedemos.net/agency-02/#'), 'websitedemos-agency-02');
  assert.equal(deriveSlug('https://www.addsearch.com/'), 'addsearch');
  assert.equal(deriveSlug('https://wptavern.com'), 'wptavern');
});

test('deriveSlug drops second-level labels, query and hash, and caps length', () => {
  assert.equal(deriveSlug('https://example.co.uk/'), 'example');
  assert.equal(deriveSlug('https://www.Example.com.br/Blog/My_Post/?a=1#x'), 'example-blog-my-post');
  const long = deriveSlug('https://websitedemos.net/a-very-long-path-segment/another-long-segment/more');
  assert.ok(long.length <= 40, long);
  assert.ok(!long.endsWith('-'));
  assert.equal(long, 'websitedemos-a-very-long-path-segment');
});

test('previewHosts', () => {
  assert.deepEqual(previewHosts('foo'), { staging: 'foo-staging.deployhq-sites.com', customDomain: 'foo.dropsite.dev' });
});
