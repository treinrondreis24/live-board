import {currentBookings,validateEvidence} from './flora-engine.mjs';
import {dateValue,cancellationApplies} from './flora-mail-parser.mjs';

export function confirmSource(state,input,user,now){
 const fail=message=>{throw Object.assign(Error(message),{status:400});};
 const f=state.findings.find(f=>f.id===input.findingId);
 if(!f||f.fingerprint!==input.fingerprint)fail('De melding is gewijzigd. Open deze opnieuw.');
 const b=currentBookings(state.bookings).find(b=>String(b.index)===f.trip),t=b?.todos?.find(t=>t._key===f.todoKey);
 const check=state.emailChecks?.[f.trip]?.stays?.find(c=>c.todoKey===f.todoKey),source=check?.sources?.find(s=>s.id===input.messageId);
 if(!t||!source||input.confirmed!==true)fail('Kies een gevonden bron en bevestig dat je deze hebt gecontroleerd.');
 const fields=input.fields||{};
 for(const key of ['provider','reference','product','name','start','end'])if(typeof fields[key]!=='string'||!fields[key].trim()||fields[key].length>500)fail('Vul leverancier, referentie, accommodatie, naam en beide datums in vanuit het bewijs.');
 const e=validateEvidence([{trip:f.trip,todoKey:f.todoKey,source:source.url,provider:fields.provider,reference:fields.reference,start:dateValue(fields.start),end:dateValue(fields.end),name:fields.name,capacity:fields.capacity,occupants:fields.occupants,status:'confirmed',productMatch:true}])[0];
 const previous=state.evidence.filter(x=>x.id===e.id);
 if(previous.some(x=>x.status==='cancelled')||Object.values(state.emailCancellations||{}).some(c=>cancellationApplies(c,e)&&(!source.at||c.at>=source.at)))fail('Deze referentie is geannuleerd. Controleer eerst de annulering en eventuele nieuwe reservering.');
 state.evidence=state.evidence.filter(x=>x.id!==e.id).concat({...e,product:fields.product,room:String(fields.room||'').slice(0,500),messageId:source.id,document:'Handmatig beoordeelde bron',observedAt:source.at,importedAt:now,manualSourceReview:{user,at:now}});
 // A manual source decision does not erase unrelated read errors or an incomplete search.
 const unrelated=(check.errors||[]).filter(error=>error.message!==source.id);
 check.errors=unrelated;
 if(!unrelated.length&&!/limiet/i.test(check.explanation||'')){check.state='found';check.explanation='Boekingsbewijs handmatig gekoppeld; inhoudelijke controles opnieuw uitgevoerd.';}
 check.references=[...new Set([...(check.references||[]),e.reference])];
 (check.fields??=[]).push({...e,product:fields.product,document:'Handmatig beoordeelde bron'});
 (state.evidenceRevisions??=[]).push({at:now,user,evidence:previous});
 state.audit.push({at:now,user,action:'Boekingsbewijs handmatig gekoppeld',detail:f.trip+'A · '+t.title+' · '+e.reference,source:source.url});
 return e;
}
