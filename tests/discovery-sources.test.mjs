import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSteamSearch } from '../lib/steam-discovery.mjs';
import { cleanQuery, isLikelyGameName } from '../lib/rising-discovery.mjs';

test('parses Steam search result titles and app URLs',()=>{
  const html=`<a class="search_result_row ds_collapse_flag" href="https://store.steampowered.com/app/123456/Quiet_Hallways/"><div><span class="title">Quiet Hallways</span></div></a>`;
  const entries=parseSteamSearch(html);
  assert.equal(entries.length,1);
  assert.equal(entries[0].gameName,'Quiet Hallways');
  assert.match(entries[0].url,/\/app\/123456\//);
});

test('keeps likely game names from rising queries',()=>{
  assert.equal(cleanQuery('Play Quiet Hallways game online'),'Quiet Hallways game');
  assert.equal(isLikelyGameName('Quiet Hallways game','indie game'),true);
});

test('rejects generic rising queries',()=>{
  assert.equal(isLikelyGameName('best free browser games 2026','browser game'),false);
  assert.equal(isLikelyGameName('how to download itch io games','itch io'),false);
});
