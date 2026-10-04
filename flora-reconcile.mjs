import {currentBookings,evaluate} from './flora-engine.mjs';
import {parseDocument,resolveEvidence,cancellation} from './flora-mail-parser.mjs';

export const INTERPRETATION_VERSION=7;
// Reuse the actual saved source documents, never infer corrected fields from a todo.
// Preserve the prior evidence in an audit snapshot before replacing automatic interpretations.
export function rebuildStoredEvidence(state,messages,now=new Date().toISOString(),options={}){
 const bookings=currentBookings(state.bookings||[]),latest=new Map(),retired=new Set(),map=state.emailCancellations??={};
 for(const m of messages){
  for(const link of m.retiredLinks||[])retired.add(link);
  const c=cancellation(m);if(c){const key=c.provider+'|'+c.reference;if(!map[key]||map[key].at<c.at)map[key]=c;}
  for(const d of m.docs||[]){const e=parseDocument(d,m);if(!e)continue;const key=e.provider+'|'+e.reference,prior=latest.get(key);if(!prior||(!e.partialEvidence||prior.partialEvidence)&&prior.observedAt<=e.observedAt||prior.partialEvidence&&!e.partialEvidence)latest.set(key,e);}
 }
 const old=state.evidence||[];
 const selected=e=>!options.trips||options.trips.has(e.trip||'onbekend');
 const affected=options.trips?new Set(options.trips):null;
 const replacements=[];
 for(let e of latest.values()){
  const c=map[e.provider+'|'+e.reference];if(c&&e.observedAt<=c.at)e={...e,status:'cancelled',source:c.source,observedAt:c.at};
  if(retired.has(e.ticketLink))e={...e,status:'cancelled'};
  const assigned=resolveEvidence(e,bookings);
  if(!selected(assigned)&&!old.some(x=>selected(x)&&x.provider===e.provider&&x.reference===e.reference))continue;
  affected?.add(assigned.trip||'onbekend');
  const existing=old.find(x=>x.provider===assigned.provider&&x.reference===assigned.reference&&!x.partialEvidence);
  if(assigned.partialEvidence&&existing&&assigned.start===existing.start)continue;
  replacements.push({...assigned,automaticEmail:true,interpretationVersion:INTERPRETATION_VERSION,importedAt:now});
 }
 const replaced=new Set(replacements.map(e=>e.provider+'|'+e.reference));
 state.evidence=old.filter(e=>!selected(e)||!e.automaticEmail||!replaced.has(e.provider+'|'+e.reference)).map(e=>({...e})).concat(replacements);
 for(const e of state.evidence){if(!selected(e))continue;const c=map[e.provider+'|'+e.reference];if(c&&(!e.observedAt||e.observedAt<=c.at)){e.status='cancelled';e.source=c.source;e.observedAt=c.at;}}
 state.evidence=[...new Map(state.evidence.map(e=>[e.id,e])).values()];
 for(const [trip,check] of Object.entries(state.emailChecks||{}))for(const stay of check.stays||[]){if(options.trips&&!options.trips.has(trip))continue;const rows=state.evidence.filter(e=>e.trip===trip&&e.todoKey===stay.todoKey);stay.references=rows.map(e=>e.reference);stay.fields=rows.map(e=>({reference:e.reference,provider:e.provider,start:e.start,end:e.end,name:e.name,capacity:e.capacity,occupants:e.occupants,product:e.product,document:e.document,source:e.source}));if(rows.length&&stay.state!=='incomplete'&&!stay.errors?.length){stay.state='found';stay.explanation='Opgeslagen bron opnieuw gelezen met de huidige regels; zie Meldingen voor resterende onzekerheden.';}if(!rows.length&&stay.state==='found'){stay.state='candidates';stay.explanation='Eerdere koppeling niet bevestigd door de bijgewerkte regels; opnieuw beoordelen.';}}
 (state.evidenceRevisions??=[]).push({at:now,version:INTERPRETATION_VERSION,trips:options.trips?[...options.trips]:null,evidence:old.filter(selected)});
 if(!options.trips)state.interpretationVersion=INTERPRETATION_VERSION;
 Object.assign(state,evaluate(state,now,affected?{...options,trips:affected}:options));
 (state.audit??=[]).push({at:now,user:'FloRA',action:'Opgeslagen bronnen opnieuw beoordeeld',detail:`Uitlegversie ${INTERPRETATION_VERSION}: ${messages.length} opgeslagen berichten; ${latest.size} reserveringen opnieuw uit bron gelezen. Vorige interpretaties bewaard.`});
}
