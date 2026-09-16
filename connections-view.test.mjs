import test from 'node:test';
import assert from 'node:assert/strict';
import {boardRows,statusView,shortCity,destinationCity,eventDelay,planningMark} from './public/connections-view.js';
const pair={ruleId:'test',eligible:true,status:'feasible',incoming:{},outgoing:{planned:1},minutes:7};
test('only planned possible connections are displayed, including cancellations',()=>{
 const cancelled={...pair,status:'missed',incoming:{cancelled:true}};
 assert.deepEqual(boardRows([{...pair,eligible:false,status:'not-planned'},cancelled,{...pair,status:'not-applicable'},{...pair,incoming:null}]),[cancelled]);
 assert.equal(statusView(cancelled,true).label,'Geannuleerd');assert.equal(statusView(cancelled,true).kind,'missed');
 assert.equal(statusView(pair,true).kind,'unknown');
});
test('readable compact destinations and minute status',()=>{
 assert.equal(shortCity('Amsterdam Centraal'),'Amsterdam C');assert.equal(shortCity('München Hbf Gl.27-36'),'München Hbf');assert.equal(shortCity('Venezia S. Lucia'),'Venezia');
 assert.equal(statusView(pair).label,'7 min');assert.equal(statusView({...pair,status:'uncertain',minutes:0}).symbol,'?');
});

test('origins and destinations use city names only',()=>{for(const [input,expected] of [['Budapest-Keleti','Budapest'],['Hamburg-Altona','Hamburg'],['Berlin Ost','Berlin'],['Milano Centrale','Milano'],['Frankfurt(main) Hnf','Frankfurt']])assert.equal(destinationCity(input),expected);assert.equal(shortCity('Berlin Ost'),'Berlin Ost');});

test('planned time markings reflect measured delay and planned-only state',()=>{const e={planned:100000,expected:160000,realtime:true};assert.equal(eventDelay(e),1);assert.ok(planningMark(e).includes('+1'));assert.ok(planningMark({...e,expected:100000}).includes('✓'));assert.ok(planningMark({planned:100000}).includes('svg'));});

test('connections expire after 150 minutes and sort by incoming planned arrival',()=>{
 const now=10000000,rows=[
  {...pair,ruleId:'later',incoming:{planned:now+60000},outgoing:{planned:now+120000}},
  {...pair,ruleId:'older',incoming:{planned:now-150*60000},outgoing:{planned:now+300000}},
  {...pair,ruleId:'expired',incoming:{planned:now-150*60000-1},outgoing:{planned:now}}
 ];
 assert.deepEqual(boardRows(rows,now).map(r=>r.ruleId),['older','later']);
 assert.deepEqual(boardRows(rows,now+1).map(r=>r.ruleId),['later']);
});

test('one row per connection: use Düsseldorf when Köln was missed',()=>{
 const now=10000000,main={...pair,date:'2026-09-16',ruleId:'koeln-106-224',station:'koeln',status:'missed',incoming:{planned:now,number:'106'},outgoing:{planned:now+600000,number:'224'}};
 const fallback={...main,station:'duesseldorf',fallbackFor:'koeln',status:'feasible',incoming:{planned:now+1200000,number:'106'}};
 assert.deepEqual(boardRows([main,fallback],now),[fallback]);
 assert.deepEqual(boardRows([{...main,status:'feasible'},fallback],now).map(r=>r.station),['koeln']);
 assert.deepEqual(boardRows([main,{...fallback,eligible:false}],now),[main]);
 assert.deepEqual(boardRows([{...main,eligible:false,status:'not-planned'},fallback],now),[fallback]);
 assert.equal(boardRows([main,{...main}],now).length,1);
 const berlin={...main,ruleId:'berlin-178-142',station:'berlin',outgoing:{planned:now+600000,number:'142'}};
 const alternateTrain={...berlin,alternativeFor:'142',outgoing:{planned:now+660000,number:'140'},status:'feasible'};
 assert.deepEqual(boardRows([berlin,alternateTrain],now),[alternateTrain]);
});
