import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchApiProfile, parseSearchApiTimelines } from '../lib/searchapi-trends.mjs';

test('SearchApi online profile compares exact, online, play, and anchor in one request', () => {
  const profile = buildSearchApiProfile('Test Game', 'online');
  assert.deepEqual(profile.queries, ['Test Game', 'Test Game online', 'play Test Game', 'crazy games']);
  assert.deepEqual(profile.supportIndexes, [1, 2]);
  assert.equal(profile.anchor, 'crazy games');
});

test('SearchApi wiki profile compares exact, wiki, guide, and Steam anchor', () => {
  const profile = buildSearchApiProfile('Test Game', 'wiki');
  assert.deepEqual(profile.queries, ['Test Game', 'Test Game wiki', 'Test Game guide', 'steam']);
  assert.equal(profile.anchor, 'steam');
});

test('parseSearchApiTimelines maps values by query name instead of relying on response order', () => {
  const queries = ['Test Game', 'Test Game wiki', 'steam'];
  const payload = {
    interest_over_time: {
      timeline_data: [
        {
          date: 'Jul 1, 2026',
          values: [
            { query: 'steam', extracted_value: 90 },
            { query: 'Test Game', extracted_value: 8 },
            { query: 'Test Game wiki', extracted_value: 3 },
          ],
        },
        {
          date: 'Jul 2, 2026',
          values: [
            { query: 'Test Game wiki', value: '7' },
            { query: 'steam', value: '80' },
            { query: 'Test Game', value: '12' },
          ],
        },
      ],
    },
  };
  const parsed = parseSearchApiTimelines(payload, queries);
  assert.deepEqual(parsed.timelines[0], [8, 12]);
  assert.deepEqual(parsed.timelines[1], [3, 7]);
  assert.deepEqual(parsed.timelines[2], [90, 80]);
  assert.equal(parsed.dates.length, 2);
});
