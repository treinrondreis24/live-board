import {testEdition} from '../kk-edition-context.mjs';
import {calculate,graph,resolve} from './core.mjs';
const round=n=>Math.round(n*10)/10;
export function testStations(){return testEdition().network.stations.map(s=>s.name).sort((a,b)=>a.localeCompare(b,'nl'));}
export function testEdges(){const {network}=testEdition(),names=new Map(network.stations.map(s=>[s.code,s.name]));return graph(network).map(e=>({...e,from:names.get(e.from),to:names.get(e.to),km:e.metres/1000,label:network.trajectories.find(t=>t.id===e.scorecardId).label}));}
export function calculateTestRoute(from,to,via=[],choices={}){
 const config=testEdition(),net=config.network;
 const result=calculate(net,{from,to,via,choices,date:'2026-09-19'}),names=new Map(net.stations.map(s=>[s.code,s.name]));
 return {from:names.get(resolve(net,from)),to:names.get(resolve(net,to)),via:via.map(s=>names.get(resolve(net,s))),segments:result.segments.map(e=>({...e,from:names.get(e.from),to:names.get(e.to),km:e.metres/1000,label:net.trajectories.find(t=>t.id===e.scorecardId).label})),km:result.metres/1000,sourceHash:config.hash,source:'Testnetwerk · '+net.revision,networkVersion:net.revision,editionId:config.id,method:'shortest-station-path',questions:result.questions,answers:choices,warnings:result.warnings,needsConfirmation:result.needsConfirmation};
}
export function assertTestConfirmable(route){if(route.needsConfirmation)throw Object.assign(Error('Beantwoord eerst de routevraag en bereken het voorstel opnieuw.'),{status:400});if(route.warnings?.length)throw Object.assign(Error('Dit voorstel bevat nog niet goedgekeurde netwerktrajecten: '+route.warnings.join('; ')),{status:400});}
export function validTestRoute(user,route,previous){
 const ctx=testEdition();if(!route||route.sourceHash!==ctx.hash||route.previousProofId!==previous||route.needsConfirmation||route.warnings?.length||!Array.isArray(route.segments))return false;
 if(!(route.status==='admin-confirmed'||route.status==='participant-confirmed'&&route.confirmedBy===user.id))return false;
 const edges=new Map(testEdges().map(e=>[e.id,e]));
 return route.segments.every(s=>{const e=edges.get(s.id);return e&&s.scorecardId===e.scorecardId&&((e.from===s.from&&e.to===s.to)||(e.from===s.to&&e.to===s.from))&&Number.isFinite(s.km)&&s.km>0&&(route.status==='admin-confirmed'?s.km<=e.km:s.km===e.km);});
}
export function testScore(user,input,rules,legacyNetwork,checkpoint='auto'){
 const checkpointStation=s=>{try{return resolve(testEdition().network,s)==='rtd';}catch{return false;}};
 const received=[...input].sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id)),previous=new Map(received.map((r,i)=>[r.id,i?received[i-1].id:null]));
 const rows=[...input].sort((a,b)=>(a.proof.journeyAt??a.created)-(b.proof.journeyAt??b.created)||a.id.localeCompare(b.id));
 const checkpoints=rows.filter(r=>checkpointStation(r.proof.station||r.proof.text));
 if(checkpoint==='auto')checkpoint=checkpoints[0]?.id||'not-yet';
 const cut=checkpoint==='not-yet'?rows.length:rows.findIndex(r=>r.id===checkpoint&&checkpointStation(r.proof.station||r.proof.text));
 if(cut<0)throw Object.assign(Error('Selecteer het bewijs van meldpunt Rotterdam.'),{status:400});
 const edges=testEdges(),counts=new Map(edges.map(e=>[e.id,[0,0]]));let confirmed=0,pending=0;
 for(const [i,r]of rows.entries()){if(!validTestRoute(user,r.route,previous.get(r.id))){pending++;continue;}confirmed++;for(const s of r.route.segments){const edge=edges.find(e=>e.id===s.id);counts.get(s.id)[i<=cut?0:1]+=s.km/edge.km;}}
 const totals=legacyNetwork.edges.map(parent=>{const parts=edges.filter(e=>e.scorecardId===parent.id),limit=parent.maxCount/2;
  const kilometres=cap=>[0,1].map(side=>round(parts.reduce((n,e)=>n+(cap?Math.min(counts.get(e.id)[side],limit):counts.get(e.id)[side])*e.km,0)));
  const rawKm=kilometres(false),usedKm=kilometres(true);
  return {id:parent.id,raw:rawKm.map(km=>km/parent.km),used:usedKm.map(km=>km/parent.km),validKm:round(usedKm[0]+usedKm[1]),travelledKm:round(rawKm[0]+rawKm[1])};
 });
 const sum=key=>round(totals.reduce((n,e)=>n+e[key],0)),validKm=sum('validKm'),travelledKm=sum('travelledKm');
 return {rulesVersion:rules.id,networkVersion:testEdition().network.revision,editionId:'test-2026',unit:'km',validKm,travelledKm,excludedKm:round(travelledKm-validKm),confirmed,pending,checkpoint,checkpointMissing:checkpoint==='not-yet',checkpointAmbiguous:checkpoints.length>1,counts,edges:totals};
}
