import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApifyFastTimeline, calculateStandaloneTrendVerdict } from '../lib/apify-fast-trends.mjs';
import { applyFinalRecommendation } from '../lib/opportunity-finalizer.mjs';

function dates(values, partialLast = false) {
  const series = {};
  const partial = {};
  values.forEach((value, index) => {
    const date = `2026-07-${String(index + 1).padStart(2, '0')}`;
    series[date] = value;
    partial[date] = partialLast && index === values.length - 1;
  });
  return { series, partial };
}

test('parseApifyFastTimeline reads nested keyword series and removes partial point', () => {
  const { series, partial } = dates([0, 3, 20, 100], true);
  const parsed = parseApifyFastTimeline({ timeline_data: { 'Test Game': series, isPartial: partial } }, 'Test Game');
  assert.deepEqual(parsed.values, [0, 3, 20]);
  assert.equal(parsed.points.length, 3);
});

test('standalone verdict detects a fresh sustained breakout', () => {
  const exact = [...Array(70).fill(0), 1, 2, 3, 6, 28, 63, 56, 75, 83, 65, 63, 59];
  const qualified = [...Array(75).fill(0), 1, 2, 3, 5, 7, 9, 12];
  const verdict = calculateStandaloneTrendVerdict({ gameName: 'Shift At Midnight', exactValues: exact, qualifiedValues: qualified, siteType: 'wiki', qualifiedQuery: 'Shift At Midnight wiki' });
  assert.equal(verdict.classification, 'breakout');
  assert.equal(verdict.keywordFreshness, 'new');
  assert.equal(verdict.entityConflict, false);
  assert.equal(verdict.gameIntentConfirmed, true);
  assert.ok(verdict.score >= 60);
});

test('standalone verdict returns none when both terms have no data', () => {
  const verdict = calculateStandaloneTrendVerdict({ gameName: 'No Demand Game', exactValues: Array(90).fill(0), qualifiedValues: Array(90).fill(0), siteType: 'online', qualifiedQuery: 'No Demand Game online' });
  assert.equal(verdict.classification, 'none');
  assert.equal(verdict.gameIntentConfirmed, false);
});

test('standalone verdict flags established ambiguous bare term without game intent', () => {
  const exact = [...Array(80).fill(18), 20, 22, 25, 28, 30, 32, 35];
  const qualified = Array(exact.length).fill(0);
  const verdict = calculateStandaloneTrendVerdict({ gameName: 'Common Phrase', exactValues: exact, qualifiedValues: qualified, siteType: 'wiki', qualifiedQuery: 'Common Phrase wiki' });
  assert.equal(verdict.keywordFreshness, 'existing');
  assert.equal(verdict.entityConflict, true);
});

test('Apify rising result without qualified game intent cannot become final independent recommendation', () => {
  const candidate = {
    gameName: 'Ambiguous Rise',
    siteType: { modelVersion: 2, type: 'wiki' },
    seo: { modelVersion: 5, classification: 'independent', score: 80, nameRisk: 8 },
    fast: { classification: 'pass', score: 75 },
    trend: { provider: 'apify-data-xplorer', classification: 'breakout', score: 85, keywordFreshness: 'new', entityConflict: false, gameIntentConfirmed: false },
  };
  applyFinalRecommendation(candidate);
  assert.equal(candidate.recommendation, 'watch');
  assert.ok(candidate.finalScore <= 54);
});
