import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySiteType } from '../lib/site-type.mjs';
import { calculateFastSignals, FAST_MODEL_VERSION } from '../lib/fast-signals.mjs';
import { buildBalancedTrendQueue, TREND_PROFILE_VERSION } from '../lib/trend-queue.mjs';

const now = new Date().toISOString();
function base(name, sources) {
  return {
    id: name,
    gameName: name,
    normalizedName: name.toLowerCase(),
    firstSeen: now,
    sources,
    discoveryScore: 8,
    seo: { modelVersion: 5, classification: 'page', score: 52, nameRisk: 8, entityConflict: false, suggestions: [`${name} play online`] },
  };
}

test('online platforms classify as online and do not assume iframe permission', () => {
  const candidate = base('Browser Gem', [
    { sourceId: 'crazygames-new', kind: 'crazygames-new', url: 'https://crazygames.com/game/browser-gem', firstSeen: now },
    { sourceId: 'poki-new', kind: 'poki-new', url: 'https://poki.com/en/g/browser-gem', firstSeen: now },
  ]);
  const result = classifySiteType(candidate);
  assert.equal(result.type, 'online');
  assert.equal(result.onlinePlatformCount, 2);
  assert.equal(result.iframeLikely, null);
  assert.equal(result.embedStatus, 'needs-check');
});

test('online multi-platform game can pass without YouTube', () => {
  const candidate = base('Browser Gem', [
    { sourceId: 'crazygames-new', kind: 'crazygames-new', url: 'https://crazygames.com/game/browser-gem', firstSeen: now, currentRank: 8 },
    { sourceId: 'poki-new', kind: 'poki-new', url: 'https://poki.com/en/g/browser-gem', firstSeen: now, currentRank: 12 },
  ]);
  candidate.siteType = classifySiteType(candidate);
  const fast = calculateFastSignals(candidate, {});
  assert.equal(fast.modelVersion, FAST_MODEL_VERSION);
  assert.equal(fast.profile, 'online');
  assert.equal(fast.classification, 'pass');
  assert.equal(fast.youtubeChannels, 0);
});

test('balanced queue reserves online capacity', () => {
  const online = base('Browser Gem', [
    { sourceId: 'crazygames-new', kind: 'crazygames-new', url: 'https://crazygames.com/game/browser-gem', firstSeen: now },
    { sourceId: 'poki-new', kind: 'poki-new', url: 'https://poki.com/en/g/browser-gem', firstSeen: now },
  ]);
  online.siteType = classifySiteType(online);
  online.fast = calculateFastSignals(online, {});
  const wiki = base('Steam Gem', [{ sourceId: 'steam-popular-new', kind: 'steam-popular-new', url: 'https://store.steampowered.com/app/1', firstSeen: now }]);
  wiki.seo.classification = 'independent';
  wiki.siteType = classifySiteType(wiki);
  wiki.youtube = { channelCount: 5, videoCount: 8, totalViews: 50000, checkedAt: now };
  wiki.fast = calculateFastSignals(wiki, {});
  const queue = buildBalancedTrendQueue([online, wiki], { online: 1, wiki: 1, flexible: 0 });
  assert.equal(TREND_PROFILE_VERSION, 2);
  assert.equal(queue.length, 2);
  assert.deepEqual(new Set(queue.map((item) => item.channel)), new Set(['online', 'wiki']));
});
