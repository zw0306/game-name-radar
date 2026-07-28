import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteDocument, deriveGameName, normalizeGameName, calculateCandidateScore } from '../lib/scanner.mjs';

test('parses sitemap entries',()=>{const out=parseRemoteDocument('<?xml version="1.0"?><urlset><url><loc>https://a.com/game/alpha-run</loc><lastmod>2026-07-28</lastmod></url></urlset>','https://a.com/sitemap.xml','sitemap');assert.equal(out.entries.length,1)});
test('parses itch title links',()=>{const out=parseRemoteDocument('<a class="title game_link" href="https://dev.itch.io/star-fall">Star Fall</a>','https://itch.io/games','itch-listing');assert.equal(out.entries[0].title,'Star Fall')});
test('parses Poki game links only',()=>{const html='<a href="/en/new">New</a><a href="/en/g/ball-vs-block">Ball vs Block</a><a href="/en/categories">Categories</a>';const out=parseRemoteDocument(html,'https://poki.com/en/new','poki-listing');assert.deepEqual(out.entries.map(x=>x.title),['Ball vs Block'])});
test('cleans Y8 ratings and New badge',()=>{const html='<a href="/games/military_strike">New Military Strike 8.4</a>';const out=parseRemoteDocument(html,'https://www.y8.com/new/games','y8-listing');assert.equal(out.entries[0].title,'Military Strike')});
test('derives and normalizes game names',()=>{assert.equal(deriveGameName({url:'https://site.com/game/neon-dungeon-online',title:''}),'Neon Dungeon');assert.equal(normalizeGameName('Play Neon Dungeon Online'),'neon dungeon')});
test('cross portal signal reaches high score',()=>{const c={gameName:'Neon Dungeon',sources:[{kind:'poki-new'},{kind:'crazygames-new'}]};assert.ok(calculateCandidateScore(c)>=12)});
