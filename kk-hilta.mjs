import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {kkGet,kkPut,kkInsert,kkLimit,kkPreviousProof} from './kk-store.mjs';
import {canUseProof} from './kk-password.mjs';
const network=JSON.parse(readFileSync(new URL('./hilta-network.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
export const hiltaNotice='Deze kilometerberekening is een inschatting van Hilta. Hilta kan fouten maken. Aan deze inschatting kunnen geen rechten worden ontleend. Controleer de trajecten altijd zelf. De organisatie stelt de definitieve score vast.';
const parent=network.edges.find(e=>e.id==='score2026-76');
export const hiltaEdges=network.edges.flatMap(e=>e.id!==parent.id?[e]:[{...e,id:e.id+'-zuid-west',scorecardId:e.id,to:'Amsterdam Zuid',km:9.2},{...e,id:e.id+'-zuid-oost',scorecardId:e.id,from:'Amsterdam Zuid',km:0.8}]);
export const hiltaScoreEdges=[...network.edges,...hiltaEdges.filter(e=>e.scorecardId)];
export const hiltaStations=[...new Set(hiltaEdges.flatMap(e=>[e.from,e.to]))].sort((a,b)=>a.localeCompare(b,'nl'));
const normal=s=>String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const stationAliases=new Map([['den haag hs','Den Haag Hollands Spoor'],['schiphol airport','Schiphol'],['breda-prinsenbeek','Breda Prinsenbeek'],['alphen a/d rijn','Alphen aan den Rijn'],['den haag laan v noi','Den Haag Laan van NOI']]);
function station(s){const canonical=stationAliases.get(normal(s))||s;const found=hiltaStations.find(n=>normal(n)===normal(canonical));if(!found)fail('Hilta kan station "'+String(s||'onbekend').slice(0,100)+'" nog niet aan een scorekaarttraject koppelen. Je bewijs blijft bewaard; laat dit deel door de organisatie controleren.');return found;}
function shortest(from,to){
 const dist=new Map([[from,0]]),previous=new Map(),done=new Set();
 while(true){let at=null,best=Infinity;for(const [n,d] of dist)if(!done.has(n)&&d<best){at=n;best=d;}if(at===null)fail('Geen verbinding gevonden in de scorekaart.');if(at===to)break;done.add(at);
 for(const edge of hiltaEdges){const next=edge.from===at?edge.to:edge.to===at?edge.from:null;if(!next)continue;const d=best+Math.round(edge.km*10);if(d<(dist.get(next)??Infinity)){dist.set(next,d);previous.set(next,{edge,from:at,to:next});}}
 }
 const path=[];for(let at=to;at!==from;){const step=previous.get(at);path.unshift({...step.edge,from:step.from,to:step.to});at=step.from;}return path;
}
export function calculateHilta(from,to,via=[]){
 if(!Array.isArray(via)||via.length>20||via.some(s=>typeof s!=='string'||s.length>200))fail('Gebruik maximaal 20 via-stations, in reisvolgorde.');
 const points=[from,...via,to].map(station),segments=[];for(let i=1;i<points.length;i++)segments.push(...shortest(points[i-1],points[i]));
 return {from:points[0],to:points.at(-1),via:points.slice(1,-1),segments,km:segments.reduce((n,e)=>n+Math.round(e.km*10),0)/10,method:'shortest-scorecard-path',sourceHash:network.sha256,source:network.source,notice:hiltaNotice};
}
async function proof(user,id){if(!canUseProof(user))fail('Privébewijs is beschikbaar na goedkeuring.',403);const row=await kkGet('submission',id);if(!row||row.owner!==user.id||row.value.kind!=='proof')fail('Bewijs niet gevonden.',404);return row;}
export async function hiltaContext(user,id){const row=await proof(user,id),previous=await kkPreviousProof(row),current=await kkGet('hilta-current',id);return {proofId:id,to:row.value.station||row.value.text,from:previous?(previous.value.station||previous.value.text):user.station||'',previousProofId:previous?.id||null,previousReceivedAt:previous?Number(previous.created):null,receivedAt:Number(row.created),stations:hiltaStations,notice:hiltaNotice,current:current?.value||null};}
export async function proposeHilta(user,data){const context=await hiltaContext(user,data.proofId);if(!await kkLimit('hilta:'+user.id,120,3600000))fail('Te veel berekeningen. Probeer later opnieuw.',429);const from=context.previousProofId?context.from:String(data.startStation||context.from);const route=calculateHilta(from,context.to,data.via||[]);const proposal={...route,id:randomUUID(),proofId:data.proofId,previousProofId:context.previousProofId,previousReceivedAt:context.previousReceivedAt,receivedAt:context.receivedAt,createdAt:Date.now(),status:'proposed'};await kkPut('hilta-proposal',proposal.id,user.id,proposal);await kkPut('hilta-current',proposal.proofId,user.id,proposal);return proposal;}
export async function confirmHilta(user,data){if(data.reviewed!==true)fail('Vink aan dat je de trajecten en volgorde zelf hebt nagekeken.');const row=await kkGet('hilta-proposal',data.proposalId);if(!row||row.owner!==user.id)fail('Routevoorstel niet gevonden.',404);await proof(user,row.value.proofId);const current=await kkGet('hilta-current',row.value.proofId);if(current?.value.id!==data.proposalId)fail('Er is een nieuwer voorstel. Controleer en bevestig dat voorstel.',409);const existing=await kkGet('hilta-confirmation',data.proposalId);if(existing)return existing.value;const confirmed={...row.value,status:'participant-confirmed',confirmedAt:Date.now(),confirmedBy:user.id,noticeAccepted:hiltaNotice};await kkInsert('hilta-confirmation',confirmed.id,user.id,confirmed);await kkPut('hilta-current',confirmed.proofId,user.id,confirmed);return confirmed;}
