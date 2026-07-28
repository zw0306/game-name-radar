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
  assert.ok(['strong','rising'].includes(verdict.classification));
  assert.ok(verdict.score>=45);
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
