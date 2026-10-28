import assert from 'node:assert/strict';
import {confirmedDailyBars} from './build.mjs';
import {buildSentimentAnomaly,buildDivergenceStudy} from '../lib/pattern-recognition.mjs';
const bars=Array.from({length:30},(_,i)=>({t:new Date(Date.UTC(2026,9,i+1)).toISOString().slice(0,10),c:100*1.01**i}));
const failures=[];
for(const [name,fn] of [
 ['after-hours completed daily bar is retained',()=>assert.equal(confirmedDailyBars(bars,'POSTPOST',new Date('2026-10-30T23:00:00Z')).length,bars.length)],
 ['missing sentiment is not extreme fear',()=>{const s=buildSentimentAnomaly(bars.map(b=>({date:b.t,score:null})),bars);assert.equal(s.state,'unavailable');assert.equal(s.fear.n,0);}]
]) {try {fn();console.log('PASS '+name);}catch(e){failures.push(name);console.error('FAIL '+name+': '+e.message);}}
const coverage=buildDivergenceStudy([{symbol:'SHORT',dates:bars.map(b=>b.t),closes:bars.map(b=>b.c)}]).coverage;
assert.equal(coverage[0].status,'under-80-sessions');
console.log('PASS actual coverage identifies names excluded for short history');
if(failures.length)throw Error(failures.join('; '));
