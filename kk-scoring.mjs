import {readFileSync} from 'node:fs';
import {hiltaEdges,hiltaScoreEdges} from './kk-hilta.mjs';
import {testEdition} from './kk-edition-context.mjs';
import {validTestRoute,testScore} from './hilta-next/test-edition.mjs';
const network=JSON.parse(readFileSync(new URL('./hilta-network.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
export const scoringVersions=Object.freeze({
 '2026-12-v1':Object.freeze({year:2026,edition:12,unit:'km',status:'active'}),
 '2026-24-v1':Object.freeze({year:2026,edition:24,unit:'km',status:'active'}),
 '2028-24-draft':Object.freeze({year:2028,edition:24,unit:'km',status:'draft',maxPassages:1,jokerMaxPerTrajectory:1,jokerCount:null,checkpoint:null,startEarliest:'00:00',startLatest:'04:00',durationSeconds:86399}),
 '2028-12-draft':Object.freeze({year:2028,edition:12,unit:'points',status:'draft',jokerCount:null})
});
export function scoringRule(user){
 const year=Number(user.competitionYear||2026),edition=Number(user.edition||24);
 const key=user.scoringVersion||`${year}-${edition}-v1`,rule=scoringVersions[key];
 if(!rule||rule.year!==year||rule.edition!==edition||rule.status!=='active')throw Object.assign(Error('Voor deze wedstrijdeditie zijn nog geen definitieve rekenregels beschikbaar.'),{status:409});
 return {id:key,...rule};
}
export const isCheckpoint=s=>/^rotterdam (centraal|c)$/i.test(String(s||'').trim())||!!testEdition()&&String(s||'').trim().toLowerCase()==='rtd';
export function validScoringRoute(user,route,previous){
 if(testEdition())return validTestRoute(user,route,previous);
 return !!((route?.status==='admin-confirmed'||route?.status==='participant-confirmed'&&route.confirmedBy===user.id)&&route.sourceHash===network.sha256&&route.previousProofId===previous&&Array.isArray(route.segments)&&route.segments.every(seg=>hiltaScoreEdges.some(e=>e.id===seg.id&&(route.status==='admin-confirmed'?Number.isFinite(seg.km)&&seg.km>0&&seg.km<=e.km:e.km===seg.km&&((e.from===seg.from&&e.to===seg.to)||(e.from===seg.to&&e.to===seg.from))))));
}
// Pure calculation; never modifies routes, evidence, claims or historical records.
export function calculateScore(user,input,checkpoint='auto'){
 if(testEdition())return testScore(user,input,scoringRule(user),network,checkpoint);
 const rules=scoringRule(user),received=[...input].sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));
 const previous=new Map(received.map((r,i)=>[r.id,i?received[i-1].id:null]));
 const rows=[...input].sort((a,b)=>(a.proof.journeyAt??a.created)-(b.proof.journeyAt??b.created)||a.id.localeCompare(b.id));
 const checkpoints=rows.filter(r=>isCheckpoint(r.proof.station||r.proof.text));
 if(checkpoint==='auto')checkpoint=checkpoints[0]?.id||'not-yet';
 const cut=checkpoint==='not-yet'?rows.length:rows.findIndex(r=>r.id===checkpoint&&isCheckpoint(r.proof.station||r.proof.text));
 if(cut<0)throw Object.assign(Error('Selecteer het bewijs van je bezoek aan meldpunt Rotterdam, of kies dat je daar nog niet bent geweest.'),{status:400});
 const counts=new Map(hiltaEdges.map(e=>[e.id,[0,0]]));let confirmed=0,pending=0;
 for(const [i,r] of rows.entries()){
  if(!validScoringRoute(user,r.route,previous.get(r.id))){pending++;continue;}
  confirmed++;const side=i<=cut?0:1;
  for(const seg of r.route.segments){const parts=seg.id==='score2026-76'?hiltaEdges.filter(e=>e.scorecardId===seg.id):[seg];
   for(const part of parts)counts.get(part.id)[side]+=r.route.status==='admin-confirmed'&&seg.partial?seg.km/hiltaScoreEdges.find(e=>e.id===seg.id).km:1;
  }
 }
 const edges=network.edges.map(edge=>{const parts=hiltaEdges.filter(e=>e.id===edge.id||e.scorecardId===edge.id),limit=edge.maxCount/2;
  const raw=[0,1].map(side=>parts.reduce((n,e)=>n+counts.get(e.id)[side]*e.km,0)/edge.km);
  const used=[0,1].map(side=>Math.round(parts.reduce((n,e)=>n+Math.min(counts.get(e.id)[side],limit)*e.km,0)*10)/10/edge.km);
  return {id:edge.id,raw,used,validKm:Math.round(edge.km*(used[0]+used[1])*10)/10,travelledKm:Math.round(edge.km*(raw[0]+raw[1])*10)/10};
 });
 const sum=key=>edges.reduce((n,e)=>n+Math.round(e[key]*10),0)/10,validKm=sum('validKm'),travelledKm=sum('travelledKm');
 return {rulesVersion:rules.id,unit:rules.unit,validKm,travelledKm,excludedKm:Math.round((travelledKm-validKm)*10)/10,pending,confirmed,checkpoint,checkpointMissing:checkpoint==='not-yet',checkpointAmbiguous:checkpoints.length>1,counts,edges};
}
export function scoreSummary(score){const {counts,edges,...summary}=score;return summary;}
