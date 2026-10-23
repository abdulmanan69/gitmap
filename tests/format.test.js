import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtBytes, fmtCompact, fmtInt, fmtRelative, fmtDuration, plural, truncate, escapeHtml, fmtPct } from '../src/utils/format.js';

test('fmtBytes picks sensible units', () => {
  assert.equal(fmtBytes(0), '0 B');
  assert.equal(fmtBytes(1023), '1023 B');
  assert.equal(fmtBytes(1024), '1.0 KB');
  assert.equal(fmtBytes(15 * 1024), '15 KB');
  assert.equal(fmtBytes(3.5 * 1024 * 1024), '3.5 MB');
  assert.equal(fmtBytes(2 ** 40 * 1.5), '1.5 TB');
  assert.equal(fmtBytes(1536, 2), '1.50 KB');
});

test('fmtCompact and fmtInt', () => {
  assert.equal(fmtCompact(999), '999');
  assert.equal(fmtCompact(1500), '1.5k');
  assert.equal(fmtCompact(25000), '25k');
  assert.equal(fmtCompact(2_300_000), '2.3M');
  assert.equal(fmtInt(1234567), '1,234,567');
  assert.equal(fmtInt('x'), '0');
});

test('fmtRelative describes elapsed time', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(fmtRelative('2026-10-23T11:59:50Z', now), 'just now');
  assert.equal(fmtRelative('2026-10-23T11:30:00Z', now), '30 minutes ago');
  assert.equal(fmtRelative('2026-10-23T09:00:00Z', now), '3 hours ago');
  assert.equal(fmtRelative('2026-10-22T12:00:00Z', now), '1 day ago');
  assert.equal(fmtRelative('2026-07-23T12:00:00Z', now), '3 months ago');
  assert.equal(fmtRelative('2020-10-23T12:00:00Z', now), '6 years ago');
  assert.equal(fmtRelative(null), '—');
  assert.equal(fmtRelative('garbage'), '—');
});

test('misc helpers', () => {
  assert.equal(fmtDuration(250), '250ms');
  assert.equal(fmtDuration(1500), '1.5s');
  assert.equal(fmtDuration(65000), '1m 5s');
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(2, 'file'), '2 files');
  assert.equal(plural(3, 'branch', 'branches'), '3 branches');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(fmtPct(0.12345), '12.3%');
});
