import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteDocument, deriveGameName, normalizeGameName, calculateCandidateScore } from '../lib/scanner.mjs';

test('parses sitemap urlset', () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.com/play-night-shift-online/</loc><lastmod>2026-07-28</lastmod></url></urlset>`;
  const parsed = parseRemoteDocument(xml, 'https://example.com/sitemap.xml', 'sitemap');
  assert.equal(parsed.type, 'sitemap');
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].date, '2026-07-28');
});

test('parses RSS feed', () => {
  const xml = `<rss><channel><item><title><![CDATA[Quiet Hallways]]></title><link>https://dev.itch.io/quiet-hallways</link><pubDate>Mon, 27 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const parsed = parseRemoteDocument(xml, 'https://itch.io/feed/new.xml', 'feed');
  assert.equal(parsed.type, 'feed');
  assert.equal(parsed.entries[0].title, 'Quiet Hallways');
});

test('derives clean game name from slug', () => {
  assert.equal(deriveGameName({ url: 'https://example.com/play-night-shift-online/' }), 'Night Shift');
});

test('normalizes equivalent names', () => {
  assert.equal(normalizeGameName('Play Night Shift Online'), normalizeGameName('Night Shift Game'));
});

test('scores cross-source candidate higher', () => {
  const score = calculateCandidateScore({
    gameName: 'Quiet Hallways',
    sources: [
      { kind: 'competitor-sitemap', date: '2026-07-28' },
      { kind: 'itch-popular', date: '2026-07-28' },
    ],
  });
  assert.ok(score >= 11);
});
