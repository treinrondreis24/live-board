import {scoredParticipants} from './kk-scoring-service.mjs';
import {kkScoreRows,kkList} from './kk-store.mjs';
import {startTimestamp} from './kk-scoreboard.mjs';

export function liveRow(row,claim,now){
 const p=row.participant,start=startTimestamp(p.startDate||'2026-09-19',p.startTime);
 const finish=claim||p.withdrawal;const end=finish?startTimestamp(finish.endDate,finish.endTime):null;
 return {id:p.id,name:p.fullName||p.displayName||p.email,edition:p.edition,startStation:p.station||'',endStation:claim?.endStation||p.withdrawal?.endStation||'',startTime:p.startTime,startDate:p.startDate||'2026-09-19',start,
 elapsed:start===null?null:Math.max(0,Math.floor(((end??now)-start)/60000)),
 withdrawal:p.withdrawal||null,state:claim?'finished':p.withdrawal?'withdrawn':start===null?'unknown':start>now?'waiting':'travelling',
 ...row.score,hiltaKm:row.km??0,pendingRoutes:row.pending??0,
 km:claim?.km??null,distance:p.distance??null,rotterdamTime:p.rotterdamTime||'',proofs:row.proofs,
 claim:claim?{receivedAt:claim.receivedAt,endDate:claim.endDate,endTime:claim.endTime}:null};
}
export async function liveboard(){
 const [rows,claims]=await Promise.all([scoredParticipants(),kkList('claim')]);
 const byId=new Map(claims.map(c=>[c.id,c.value])),now=Date.now();
 return {at:now,rows:rows.filter(r=>!r.participant.deleting).map(r=>liveRow(r,byId.get(r.participant.id),now))};
}
