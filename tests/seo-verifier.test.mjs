import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuckResults, calculateSeoVerdict, cleanGameName } from '../lib/seo-verifier.mjs';

test('parses DuckDuckGo result blocks',()=>{
  const html=`<div class="result results_links"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.itch.io%2Fnight-room">Night Room by Dev - itch.io</a></h2><a class="result__snippet">Play Night Room, a browser horror game.</a></div></body>`;
  const results=parseDuckResults(html);
  assert.equal(results.length,1);
  assert.match(results[0].url,/example\.itch\.io/);
});

test('strips itch feed metadata and platform suffixes from titles',()=>{
  assert.equal(cleanGameName('ROLLA [Free] [Action] [Windows]'),'ROLLA');
  assert.equal(cleanGameName('Midnight Scenes: The Highway [$3.99]'),'Midnight Scenes: The Highway');
  assert.equal(cleanGameName('The Hive [75% Off] [$4.99] [Strategy]'),'The Hive');
  assert.equal(cleanGameName('Seat and Destroy (Web)'),'Seat and Destroy');
});

test('rejects news-dominated ambiguous phrase',()=>{
  const news=Array.from({length:7},(_,i)=>({url:`https://www.reuters.com/world/story-${i}`,title:'Military strike latest news',snippet:'War conflict and attack updates'}));
  const games=[{url:'https://www.y8.com/games/military_strike',title:'Military Strike Game',snippet:'Play online game'}];
  const verdict=calculateSeoVerdict({gameName:'Military Strike',exactResults:[...news,...games],gameResults:games,suggestions:[],discoveryScore:14});
  assert.equal(verdict.classification,'reject');
  assert.ok(verdict.exactNewsRatio>=0.5);
});

test('rejects song-dominated phrase even when an itch game exists',()=>{
  const exact=[
    {url:'https://bitsofwisdom.itch.io/seat-and-destroy-web',title:'Seat and Destroy',snippet:'A browser game on itch.io'},
    {url:'https://genius.com/Metallica-seek-and-destroy-lyrics',title:'Seek & Destroy Lyrics',snippet:'Metallica song lyrics'},
    {url:'https://open.spotify.com/track/123',title:'Seek & Destroy',snippet:'Song by Metallica'},
    {url:'https://en.wikipedia.org/wiki/Seek_%26_Destroy',title:'Seek & Destroy',snippet:'A heavy metal song released in 1983'}
  ];
  const games=[exact[0]];
  const verdict=calculateSeoVerdict({gameName:'Seat and Destroy (Web)',exactResults:exact,gameResults:games,suggestions:['seat and destroy game','seek and destroy lyrics'],discoveryScore:10});
  assert.equal(verdict.classification,'reject');
  assert.ok(verdict.exactNonGameRatio>=0.5);
  assert.equal(verdict.entityConflict,true);
});

test('recommends unique game name when exact SERP is game-heavy',()=>{
  const exact=[
    {url:'https://dev.itch.io/quiet-hallways',title:'Quiet Hallways by Dev',snippet:'Horror game'},
    {url:'https://www.youtube.com/watch?v=1',title:'Quiet Hallways gameplay',snippet:'Full playthrough'},
    {url:'https://www.reddit.com/r/games/quiet-hallways',title:'Quiet Hallways discussion',snippet:'Indie game'},
    {url:'https://gamejolt.com/games/quiet-hallways/1',title:'Quiet Hallways',snippet:'Play game'}
  ];
  const verdict=calculateSeoVerdict({gameName:'Quiet Hallways',exactResults:exact,gameResults:exact,suggestions:['quiet hallways game','quiet hallways walkthrough'],discoveryScore:10});
  assert.equal(verdict.classification,'independent');
  assert.ok(verdict.score>=68);
});

test('downgrades ambiguous generic name even when game results are strong',()=>{
  const exact=[
    {url:'https://www.y8.com/games/up_hero',title:'Up Hero Game',snippet:'Play online game'},
    {url:'https://www.gamepix.com/play/up-hero',title:'Up Hero',snippet:'Browser game'},
    {url:'https://www.youtube.com/watch?v=2',title:'Up Hero gameplay',snippet:'Game video'}
  ];
  const verdict=calculateSeoVerdict({gameName:'Up Hero',exactResults:exact,gameResults:exact,suggestions:['up hero game','up hero bike price'],discoveryScore:12});
  assert.notEqual(verdict.classification,'independent');
  assert.ok(verdict.nameRisk>=13);
});
