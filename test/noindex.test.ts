import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PREVIEW_ROBOTS_TXT, injectNoindex } from '../src/lib/seo/noindex.ts';

test('adds a noindex meta right after <head>', () => {
	const out = injectNoindex('<html><head><title>x</title></head><body></body></html>');
	assert.match(out, /<head><meta name="robots" content="noindex, nofollow"><title>/);
});

test('replaces an existing robots meta instead of duplicating it', () => {
	const out = injectNoindex('<head><meta name="robots" content="index, follow"></head>');
	assert.equal(out.match(/name="robots"/g)?.length, 1);
	assert.match(out, /noindex, nofollow/);
	assert.doesNotMatch(out, /index, follow/);
});

test('handles <head> with attributes and uppercase tags', () => {
	const out = injectNoindex('<HTML><HEAD lang="en"></HEAD></HTML>');
	assert.match(out, /<HEAD lang="en"><meta name="robots"/);
});

test('prepends the meta when the document has no <head>', () => {
	assert.match(injectNoindex('<p>fragment</p>'), /^<meta name="robots" content="noindex, nofollow"><p>/);
});

test('preview robots.txt disallows everything', () => {
	assert.equal(PREVIEW_ROBOTS_TXT, 'User-agent: *\nDisallow: /\n');
});
