import assert from 'node:assert/strict';
import {calculateHilta,hiltaStations} from './kk-hilta.mjs';
import {buildScorecard} from './kk-scorecard.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {withdrawalDetails} from './kk-withdrawal.mjs';
import {liveRow} from './kk-liveboard.mjs';
import {startTimestamp} from './kk-scoreboard.mjs';
assert.ok(hiltaStations.includes('Amsterdam Zuid'));
assert.equal(calculateHilta('Schiphol Airport','Amsterdam Zuid').km,9.2);
assert.equal(calculateHilta('Amsterdam Zuid','Amsterdam RAI').km,0.8);
assert.equal(calculateHilta('Amsterdam RAI','Schiphol').km,10);
for(const station of hiltaStations){try{calculateHilta('Schiphol',station);}catch{continue;}assert.ok(Number.isFinite(calculateHilta('Amsterdam Zuid',station).km));}
const u={id:'test',fullName:'Test',edition:24,startDate:'2026-09-19',startTime:'03:59'};
const row=(id,from,to,previous)=>({id,created:Date.now(),proof:{station:to},route:{...calculateHilta(from,to),status:'participant-confirmed',confirmedBy:u.id,previousProofId:previous}});
function km(rows){const xml=strFromU8(unzipSync(buildScorecard(u,rows,'not-yet'))['xl/worksheets/sheet1.xml']);return Number(xml.match(/<x:c[^>]*r="G76"[^>]*>[\s\S]*?<x:v>([^<]*)/)[1]);}
assert.equal(km([row('a','Schiphol','Amsterdam Zuid',null)]),9.2);
assert.equal(km([row('a','Schiphol','Amsterdam Zuid',null),row('b','Amsterdam Zuid','Amsterdam RAI','a')]),10);
assert.equal(km([row('a','Schiphol','Amsterdam Zuid',null),row('b','Amsterdam Zuid','Schiphol','a')]),9.2);
const old=row('a','Schiphol','Amsterdam RAI',null);old.route.segments=[{id:'score2026-76',from:'Schiphol',to:'Amsterdam RAI',km:10}];assert.equal(km([old]),10);
const now=startTimestamp('2026-09-20','04:00');
const withdrawal=withdrawalDetails(u,{endStation:'Zwolle',endDate:'2026-09-20',endTime:'02:59'},now);
const live=liveRow({participant:{...u,withdrawal},proofs:1},null,now);assert.equal(live.state,'withdrawn');assert.equal(live.elapsed,1380);
assert.throws(()=>withdrawalDetails(u,{endStation:'Zwolle',endDate:'2026-09-21',endTime:'02:59'},now));
console.log('PASS Zuid routing all stations, partial scorecard/caps/legacy, withdrawal overnight and validation');
