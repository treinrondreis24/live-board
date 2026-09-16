import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
const resolver=source.slice(source.indexOf('async function resolveItalyJourney'),source.indexOf('function msValue'));

test('each Italy scan fetches current train details while reusing the selected journey',async()=>{
 const cached=new Map(),candidate={label:'151 today',value:'151-S06000-1780000000000'};
 let autocompleteCalls=0,detailCalls=0;
 const context=vm.createContext({
  italyDayKey:()=> '2026-09-16',
  italyJourneyCache:{get:key=>cached.get(key),set:(key,value)=>cached.set(key,value)},
  italyFetch:async()=>{autocompleteCalls++;return 'candidate';},
  parseAutocomplete:()=>[candidate],
  fetchItalyTrainDetail:async()=>({delay:++detailCalls}),
  findItalyStop:()=>({}),
  sleep:async()=>{}
 });
 vm.runInContext(resolver,context);
 const config={number:'151',station:'Milano Centrale'};
 const first=await context.resolveItalyJourney(config);
 const second=await context.resolveItalyJourney(config);
 assert.equal(first.data.delay,1);
 assert.equal(second.data.delay,2);
 assert.equal(autocompleteCalls,1);
 assert.equal(detailCalls,2);
 assert.equal(cached.get('2026-09-16|151|Milano Centrale'),candidate);
});
