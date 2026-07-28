import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTrendVerdict } from '../lib/trend-verifier.mjs';

test('rejects all-zero trend demand',()=>{
  const verdict=calculateTrendVerdict({
    gameName:'Quiet Hallways',
    sevenDayCandidate:Array(20).fill(0),sevenDayAnchor:Array(20).fill(40),
    thirtyDayCandidate:Array(30).fill(0),thirtyDayAnchor:Array(30).fill(35),
  });
  assert.equal(verdict.classification,'none');
  assert.equal(verdict.score,0);
});

test('recognizes strong demand against anchor',()=>{
  const verdict=calculateTrendVerdict({
    gameName:'Quiet Hallways',
    sevenDayCandidate:[8,10,12,16,18,20,24,28],sevenDayAnchor:[40,40,42,43,44,42,41,40],
    thirtyDayCandidate:Array.from({length:30},(_,i)=>8+Math.floor(i/5)),
    thirtyDayAnchor:Array(30).fill(40),
  });
  assert.ok(['strong','rising','breakout'].includes(verdict.classification));
  assert.ok(verdict.score>=45);
});

test('recognizes clear 7-day breakout',()=>{
  const verdict=calculateTrendVerdict({
    gameName:'Sudden New Horror',
    sevenDayCandidate:[0,0,1,1,5,12,18,24],sevenDayAnchor:Array(8).fill(45),
    thirtyDayCandidate:[...Array(22).fill(0),1,1,2,4,7,10,13,16],thirtyDayAnchor:Array(30).fill(45),
  });
  assert.ok(['breakout','rising'].includes(verdict.classification));
  assert.equal(verdict.rising7||verdict.breakout7,true);
});

test('recognizes clear 30-day rise even when 7-day ratio is moderate',()=>{
  const candidate=[...Array(16).fill(1),2,2,3,3,4,5,6,7,8,9,10,12,14,16];
  const verdict=calculateTrendVerdict({
    gameName:'Slow Burn Game',
    sevenDayCandidate:candidate.slice(-8),sevenDayAnchor:Array(8).fill(55),
    thirtyDayCandidate:candidate,thirtyDayAnchor:Array(30).fill(55),
  });
  assert.ok(['breakout','rising','strong'].includes(verdict.classification));
  assert.equal(verdict.rising30||verdict.breakout30,true);
});

test('keeps isolated one-day spike weak',()=>{
  const seven=[0,0,0,0,0,40,0,0];
  const thirty=[...Array(22).fill(0),0,0,50,0,0,0,0,0];
  const verdict=calculateTrendVerdict({
    gameName:'One Day Spike',
    sevenDayCandidate:seven,sevenDayAnchor:Array(8).fill(45),
    thirtyDayCandidate:thirty,thirtyDayAnchor:Array(30).fill(45),
  });
  assert.equal(verdict.classification,'weak');
});

test('keeps sparse low-volume term weak',()=>{
  const candidate=[0,0,0,1,0,0,0,0,1,0,0,0];
  const anchor=Array(candidate.length).fill(45);
  const verdict=calculateTrendVerdict({
    gameName:'Tiny Unknown Game',
    sevenDayCandidate:candidate,sevenDayAnchor:anchor,
    thirtyDayCandidate:[...candidate,...Array(18).fill(0)],thirtyDayAnchor:Array(30).fill(45),
  });
  assert.equal(verdict.classification,'weak');
});
