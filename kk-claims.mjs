import {kkGet,kkPut,kkList} from './kk-store.mjs';
import {canUseProof} from './kk-password.mjs';
import {startTimestamp} from './kk-scoreboard.mjs';
import {authorizedMediaUrl} from './kk-media.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export async function saveClaim(user,data){
 if(!canUseProof(user))fail('Je aanmelding moet eerst worden goedgekeurd.',403);
 if(!/^[a-f0-9-]{36}$/.test(data.submissionKey||''))fail('Ongeldige inzending.');
 const existing=await kkGet('claim',user.id);if(existing?.value.submissionKey===data.submissionKey)return existing.value;
 const startDate=user.startDate||'2026-09-19',startTime=user.startTime,startStation=user.station||'',start=startTimestamp(startDate,startTime);
 if(start===null||!startStation.trim())fail('Vul eerst je startstation en starttijd in bij Mijn deelname.');
 if(start>Date.now())fail('Je kunt je eindclaim pas indienen nadat je starttijd is verstreken. Controleer je starttijd bij Mijn deelname.');
 const km=Number(data.km),endDate=String(data.endDate||''),endTime=String(data.endTime||''),end=startTimestamp(endDate,endTime),endStation=String(data.endStation||'').trim().slice(0,200),phone=String(data.phone||'').trim();
 if(data.km===''||data.km==null||!Number.isFinite(km)||km<0||km>10000)fail('Vul geldige geclaimde kilometers in.');
 if(end===null||end<start||!endStation)fail('Vul een eindstation en geldige einddatum en eindtijd na de start in.');
 if(!/^[+0-9() .-]{6,40}$/.test(phone)||phone.replace(/\D/g,'').length<6)fail('Vul een telefoonnummer in voor eventuele vragen.');
 if(data.reviewed!==true)fail('Bevestig dat je de eindclaim hebt gecontroleerd.');
 const attachments={};for(const key of ['scorecard','planning','extra']){const ids=Array.isArray(data[key])?[...new Set(data[key])]:[];if(ids.length>8||key!=='extra'&&!ids.length)fail('Voeg een scorekaart en gerealiseerde reisplanning toe (maximaal 8 bestanden per onderdeel).');attachments[key]=[];for(const id of ids){const m=await kkGet('media',id);if(!m||m.owner!==user.id||!m.value.claimOnly)fail('Een bijlage is niet beschikbaar voor jouw eindclaim.',403);attachments[key].push({id,name:m.value.filename||'Bestand',kind:m.value.kind});}}
 const claim={id:user.id,submissionKey:data.submissionKey,name:user.fullName||user.displayName,email:user.email,edition:user.edition,startDate,startTime,startStation,km,endDate,endTime,endStation,phone,attachments,notes:String(data.notes||'').trim().slice(0,3000),receivedAt:Date.now(),reviewed:true};
 await kkPut('claim',user.id,user.id,claim);return claim;
}
export async function ownClaim(user){if(!canUseProof(user))fail('Je aanmelding moet eerst worden goedgekeurd.',403);return (await kkGet('claim',user.id))?.value||null;}
export async function claimFile(user,claimId,fileId,admin=false){if(!admin&&(!canUseProof(user)||user.id!==claimId))fail('Geen toegang.',403);const claim=await kkGet('claim',claimId);if(!claim||!Object.values(claim.value.attachments).flat().some(f=>f.id===fileId))fail('Bijlage niet gevonden.',404);const m=await kkGet('media',fileId);if(!m||m.owner!==claim.owner)fail('Bijlage niet gevonden.',404);return authorizedMediaUrl(m.owner,m.id,m.value.filename||'bijlage');}
export async function listClaims(){return (await kkList('claim')).map(r=>r.value).sort((a,b)=>b.km-a.km||a.receivedAt-b.receivedAt);}
