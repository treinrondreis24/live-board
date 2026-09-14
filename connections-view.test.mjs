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

test('overflow expires connections strictly after 90 minutes from incoming plan',()=>{const now=10000000,rows=Array.from({length:8},(_,i)=>({...pair,ruleId:String(i),incoming:{planned:now-90*60000},outgoing:{planned:now+i}}));assert.equal(boardRows(rows,now).length,8);assert.equal(boardRows(rows,now+1).length,0);assert.equal(boardRows(rows.slice(0,7),now+1).length,7);});
