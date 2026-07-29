import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySiteType } from '../lib/site-type.mjs';

test('classifies browser portal games as online opportunities', () => {
  const result = classifySiteType({
    sources: [
      { sourceId: 'y8-new', kind: 'y8-new', url: 'https://www.y8.com/games/example' },
      { sourceId: 'gamepix-new', kind: 'gamepix-new', url: 'https://www.gamepix.com/play/example' },
    ],
  });
  assert.equal(result.type, 'online');
  assert.equal(result.browserPlayable, true);
  assert.equal(result.confidence, 'high');
});

test('classifies Steam-only rising games as wiki opportunities', () => {
  const result = classifySiteType({
    sources: [
      { sourceId: 'steam-popular-new', kind: 'steam-popular-new', url: 'https://store.steampowered.com/app/3722330/Shift_At_Midnight/' },
      { sourceId: 'itch-new-feed', kind: 'itch-new', url: 'https://example.itch.io/shift-at-midnight' },
    ],
    youtube: { videoCount: 14 },
  });
  assert.equal(result.type, 'wiki');
  assert.equal(result.browserPlayable, false);
  assert.equal(result.iframeLikely, false);
});

test('leaves generic itch feed entries pending without playability proof', () => {
  const result = classifySiteType({
    sources: [{ sourceId: 'itch-new-feed', kind: 'itch-new', url: 'https://example.itch.io/unknown' }],
  });
  assert.equal(result.type, 'pending');
});
