import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initKKStore,kkPut} from './kk-store.mjs';
import {liveRow,liveboard} from './kk-liveboard.mjs';
import {startTimestamp} from './kk-scoreboard.mjs';
import {saveClaim} from './kk-claims.mjs';
const p={id:'p',fullName:'Test',approval:'approved',startDate:'2026-09-19',startTime:'03:59',station:'Zwolle',edition:24,distance:800};
const row={participant:p,proofs:2};
test('elapsed crosses midnight, claim freezes at end rather than receipt',()=>{
 const now=startTimestamp('2026-09-20','02:59');
 assert.equal(liveRow(row,null,now).elapsed,23*60);
 const c={km:500,endDate:'2026-09-20',endTime:'02:59',receivedAt:now+3600000};
 assert.equal(liveRow(row,c,now+7200000).elapsed,23*60);
 assert.equal(liveRow(row,c,now).km,500);
 assert.equal(liveRow(row,null,now-24*3600000).state,'waiting');
});
test('liveboard includes participants without proof or claim; server blocks future start',async()=>{
 await initKKStore({sqlite:new DatabaseSync(':memory:')});
 await kkPut('participant','p','p',p);
 const board=await liveboard();assert.equal(board.rows.length,1);assert.equal(board.rows[0].proofs,0);assert.equal(board.rows[0].km,null);
 await assert.rejects(saveClaim({...p,startDate:'2099-09-19'},{submissionKey:'12345678-1234-1234-1234-123456789abc'}),/pas indienen nadat je starttijd/);
});
test('Hilta totals count confirmed routes once per proof, including repeated journeys, separately from claim',async()=>{
 await initKKStore({sqlite:new DatabaseSync(':memory:')});
 await kkPut('participant','p','p',p);
 for(const id of ['a','b','c'])await kkPut('submission',id,'p',{kind:'proof'});
 for(const id of ['a','b'])await kkPut('hilta-current',id,'p',{status:'participant-confirmed',km:25});
 await kkPut('hilta-current','c','p',{status:'proposed',km:100});
 let result=(await liveboard()).rows[0];assert.equal(result.hiltaKm,50);assert.equal(result.pendingRoutes,1);assert.equal(result.km,null);
 await kkPut('hilta-current','a','p',{status:'participant-confirmed',km:30});
 await kkPut('claim','p','p',{km:48,endDate:'2026-09-20',endTime:'02:59'});
 result=(await liveboard()).rows[0];assert.equal(result.hiltaKm,55);assert.equal(result.km,48);
});
