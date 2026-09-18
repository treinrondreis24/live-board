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
