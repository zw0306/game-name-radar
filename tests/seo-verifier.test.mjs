import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuckResults, calculateSeoVerdict } from '../lib/seo-verifier.mjs';

test('parses DuckDuckGo result blocks',()=>{
  const html=`<div class="result results_links"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.itch.io%2Fnight-room">Night Room by Dev - itch.io</a></h2><a class="result__snippet">Play Night Room, a browser horror game.</a></div></body>`;
  const results=parseDuckResults(html);
  assert.equal(results.length,1);
  assert.match(results[0].url,/example\.itch\.io/);
});

test('rejects news-dominated ambiguous phrase',()=>{
  const news=Array.from({length:7},(_,i)=>({url:`https://www.reuters.com/world/story-${i}`,title:'Military strike latest news',snippet:'War conflict and attack updates'}));
  const games=[{url:'https://www.y8.com/games/military_strike',title:'Military Strike Game',snippet:'Play online'}];
  const verdict=calculateSeoVerdict({gameName:'Military Strike',exactResults:[...news,...games],gameResults:games,suggestions:[],discoveryScore:14});
  assert.equal(verdict.classification,'reject');
  assert.ok(verdict.exactNewsRatio>=0.5);
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
