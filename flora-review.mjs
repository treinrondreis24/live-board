import {evaluate} from './flora-engine.mjs';

const normal=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const cities=['Wenen|Wien|Vienna','Rome|Roma','Praag|Prague|Praha','München|Munich','Luxemburg|Luxembourg','Neurenberg|Nürnberg|Nuremberg','Milaan|Milano|Milan','Venetië|Venezia|Venice','Edinburgh','Chur','Interlaken','Brig','Lugano','Zürich|Zurich','Basel','Schaffhausen','Montpellier','Krakau|Krakow','Wroclaw','Vejle','Arezzo','Verona','Budapest','Zaragoza','Granada','Cádiz|Cadiz','Madrid','Málaga|Malaga','Córdoba|Cordoba','Ronda','Koblenz','Hamburg','Osnabrück|Osnabruck','Agrigento','Cefalù|Cefalu','Oslo','Trondheim','Bodø|Bodo','Narvik','Stockholm','Shrewsbury','Helsinki','Newcastle','IJmuiden','Kopenhagen|Copenhagen','Parijs|Paris','Berlijn|Berlin','Arnhem','Amsterdam','Utrecht','Rotterdam','Innsbruck','Salzburg','Luzern|Lucerne','Tirano','Zermatt','Chamonix'];
export function cityFrom(text){const value=' '+normal(text)+' ',matches=cities.filter(row=>row.split('|').some(alias=>value.includes(' '+normal(alias)+' ')));return matches.length===1?matches[0].split('|')[0]:'';}
export function findingComparison(state,f){
 const bookings=state.bookings.filter(b=>String(b.index)===f.trip),b=bookings.find(b=>b._id.startsWith('drafts.')&&(b.todos||[]).some(t=>t._key===f.todoKey))||bookings.find(b=>(b.todos||[]).some(t=>t._key===f.todoKey));
 const t=b?.todos?.find(t=>t._key===f.todoKey),todo={title:t?.title||f.stay||'',start:t?.startDate?.slice(0,10)||'',end:t?.endDate?.slice(0,10)||'',note:t?.description||'',reference:t?.supplierBookingNumber||''};todo.city=cityFrom(todo.title);
 return {todo,booked:(f.evidence||[]).map(proof=>{const e=state.evidence.find(e=>e.id===proof.id)||proof,city=cityFrom(e.product),known=todo.start&&todo.end&&e.start&&e.end;return {...proof,product:e.product||'',room:e.room||'',city,cityMatch:todo.city&&city?(normal(todo.city)===normal(city)?'same':'different'):'unknown',dateMatch:known?(todo.start===e.start&&todo.end===e.end?'same':'different'):'unknown'};})};
}
export function applyBulkReview(state,input,user,now=new Date().toISOString()){
 if(!['checked','accepted'].includes(input.status)||typeof input.reason!=='string'||input.reason.trim().length<5)throw Object.assign(Error('Kies een afhandeling en geef een toelichting van minimaal 5 tekens.'),{status:400});
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>20000||new Set(input.items.map(i=>i.id)).size!==input.items.length)throw Object.assign(Error('Selecteer geldige meldingen.'),{status:400});
 const targets=input.items.map(i=>state.findings.find(f=>f.id===i.id&&f.fingerprint===i.fingerprint&&['alarm','attention'].includes(f.status)));
 if(targets.some(f=>!f))throw Object.assign(Error('Een geselecteerde melding is gewijzigd of afgehandeld. Vernieuw de selectie; er is niets gearchiveerd.'),{status:409});
 const reason=input.reason.trim().slice(0,2000);
 for(const f of targets){f.override={status:input.status,reason,user,at:now};f.history.push({at:now,user,status:input.status,reason});}
 state.audit.push({at:now,user,action:'Meldingen gearchiveerd',detail:`${targets.length} meldingen: ${input.status==='checked'?'Gecontroleerd':'Geaccepteerd zonder controle'}. ${reason}`,ids:targets.map(f=>f.id)});
 Object.assign(state,evaluate(state,now));return targets.length;
}
