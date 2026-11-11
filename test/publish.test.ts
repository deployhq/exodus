import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findEntrySubpath, nextVersion, redirectHtml, versionedName, versioningEnabled } from '../src/lib/migration/publish.ts';

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

test('nextVersion starts at 1 when no versions exist', () => {
  assert.equal(nextVersion('plumber-02', []), 1);
  assert.equal(nextVersion('plumber-02', ['exodus-plumber-02']), 1);
});

test('nextVersion takes max+1 over v001 and v002', () => {
  assert.equal(nextVersion('plumber-02', ['exodus-plumber-02-v002', 'exodus-plumber-02', 'exodus-plumber-02-v001']), 3);
});

test('nextVersion ignores unrelated names', () => {
  const names = ['exodus-agency-02-v007', 'exodus-plumber-02-v01', 'exodus-plumber-02-v0010', 'x-exodus-plumber-02-v005',
    'exodus-plumber-02-v003-old', 'exodus-plumber-022-v009', 'exodus-plumber-02-v001'];
  assert.equal(nextVersion('plumber-02', names), 2);
});

test('versionedName pads to 3 digits and trims the slug, not the version', () => {
  assert.deepEqual(versionedName('plumber-02', 1), { version: 'v001', name: 'plumber-02-v001' });
  const long = 'a'.repeat(40);
  const r = versionedName(long, 12);
  assert.equal(r.name, `${'a'.repeat(35)}-v012`);
  assert.equal(r.name.length, 40);
});

test('versioning is on by default and off with EXODUS_VERSIONED=0', () => {
  assert.equal(versioningEnabled({}), true);
  assert.equal(versioningEnabled({ EXODUS_VERSIONED: '1' }), true);
  assert.equal(versioningEnabled({ EXODUS_VERSIONED: '0' }), false);
});
