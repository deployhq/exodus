import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findEntrySubpath, redirectHtml } from '../src/lib/migration/publish.ts';

test('findEntrySubpath returns null when dist has a root index.html', () => {
  const d = mkdtempSync(join(tmpdir(), 'exodus-dist-'));
  writeFileSync(join(d, 'index.html'), '<p>hi</p>');
  assert.equal(findEntrySubpath(d), null);
});

test('findEntrySubpath picks the first subdirectory holding an index.html', () => {
  const d = mkdtempSync(join(tmpdir(), 'exodus-dist-'));
  mkdirSync(join(d, '_astro'));
  writeFileSync(join(d, '_astro', 'index.html'), 'x');
  mkdirSync(join(d, 'assets'));
  mkdirSync(join(d, 'plumber-02'));
  writeFileSync(join(d, 'plumber-02', 'index.html'), 'x');
  assert.equal(findEntrySubpath(d), 'plumber-02');
});

test('findEntrySubpath throws when no index.html exists anywhere', () => {
  const d = mkdtempSync(join(tmpdir(), 'exodus-dist-'));
  assert.throws(() => findEntrySubpath(d), /no index\.html/);
});

test('redirectHtml points at the subpath with meta refresh and a link', () => {
  const html = redirectHtml('plumber-02');
  assert.match(html, /http-equiv="refresh" content="0; url=\/plumber-02\/"/);
  assert.match(html, /<a href="\/plumber-02\/">/);
});
