import {currentBookings,evaluate,hash} from './flora-engine.mjs';
import {parseDocument,matchEvidence,cancellation} from './flora-mail-parser.mjs';

export const INTERPRETATION_VERSION=6;
// Reuse the actual saved source documents, never infer corrected fields from a todo.
// Preserve the prior evidence in an audit snapshot before replacing automatic interpretations.
export function rebuildStoredEvidence(state,messages,now=new Date().toISOString()){
 const bookings=currentBookings(state.bookings||[]),latest=new Map(),retired=new Set(),map=state.emailCancellations??={};
 for(const m of messages){
  for(const link of m.retiredLinks||[])retired.add(link);
  const c=cancellation(m);if(c){const key=c.provider+'|'+c.reference;if(!map[key]||map[key].at<c.at)map[key]=c;}
  for(const d of m.docs||[]){const e=parseDocument(d,m);if(!e)continue;const key=e.provider+'|'+e.reference;if(!latest.has(key)||latest.get(key).observedAt<=e.observedAt)latest.set(key,e);}
 }
 const replaced=new Set(latest.keys());
 const old=state.evidence||[];
 state.evidence=old.filter(e=>!e.automaticEmail||!replaced.has(e.provider+'|'+e.reference));
 for(let e of latest.values()){
  const c=map[e.provider+'|'+e.reference];if(c&&e.observedAt<=c.at)e={...e,status:'cancelled',source:c.source,observedAt:c.at};
  if(retired.has(e.ticketLink))e={...e,status:'cancelled'};
  const matches=bookings.map(b=>matchEvidence(e,b)).filter(Boolean);
  const assigned=matches.length===1?matches[0]:{...e,trip:'',todoKey:'',id:hash([e.provider,e.reference,'','']),linkReview:matches.length>1?'Meerdere mogelijke reizen; de koppeling is niet eenduidig.':e.tripHint?'De reisreferentie of reizigersnaam sluit niet eenduidig aan bij Sanity.':''};
  state.evidence.push({...assigned,automaticEmail:true,interpretationVersion:INTERPRETATION_VERSION,importedAt:now});
 }
 for(const e of state.evidence){const c=map[e.provider+'|'+e.reference];if(c&&(!e.observedAt||e.observedAt<=c.at)){e.status='cancelled';e.source=c.source;e.observedAt=c.at;}}
 state.evidence=[...new Map(state.evidence.map(e=>[e.id,e])).values()];
 for(const [trip,check] of Object.entries(state.emailChecks||{}))for(const stay of check.stays||[]){const rows=state.evidence.filter(e=>e.trip===trip&&e.todoKey===stay.todoKey);stay.references=rows.map(e=>e.reference);stay.fields=rows.map(e=>({reference:e.reference,provider:e.provider,start:e.start,end:e.end,name:e.name,capacity:e.capacity,occupants:e.occupants,product:e.product,document:e.document,source:e.source}));if(!rows.length&&stay.state==='found'){stay.state='candidates';stay.explanation='Eerdere koppeling niet bevestigd door de bijgewerkte regels; opnieuw beoordelen.';}}
 (state.evidenceRevisions??=[]).push({at:now,version:INTERPRETATION_VERSION,evidence:old});
 state.interpretationVersion=INTERPRETATION_VERSION;
 Object.assign(state,evaluate(state,now));
 (state.audit??=[]).push({at:now,user:'FloRA',action:'Opgeslagen bronnen opnieuw beoordeeld',detail:`Uitlegversie ${INTERPRETATION_VERSION}: ${messages.length} opgeslagen berichten; ${latest.size} reserveringen opnieuw uit bron gelezen. Vorige interpretaties bewaard.`});
}
