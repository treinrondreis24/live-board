import {createHash} from 'node:crypto';
import {matchTravelerName} from './flora-names.mjs';

export function findingPriority(code,severity){
 if(severity==='alarm')return 'hoog';
 if(code.startsWith('name-')||code.startsWith('room-')||['capacity-unknown','cancelled-todo','trip-reference','todo-confirmation'].includes(code))return 'laag';
 if(/^(unlinked-|unmatched-|inactive-)/.test(code)||code==='waiting')return 'redelijk hoog';
 return 'gemiddeld';
}

export const DEFAULT_RULES={version:1,exceptionVersion:2,partialNames:'low',waitingDays:7,exceptions:['Hildebrand van Kuijeren','Nicoleta Andrei','Florentina Niculae','Marc van der Lee','Lucas Kielman','Jelle de Boer']};
export const normalize=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const exceptionName=(name,rules)=>rules.exceptions.some(n=>normalize(n)===normalize(String(name||'').replace(/\s+SH\d+\s*$/i,'')));
export const activeBooking=status=>['te verwerken','afgerond','boeking afgerond','afgehandeld','wacht op betaling','verwerkt','interrail leveren','tickets versturen'].includes(normalize(status));
export const waitingBooking=status=>['wacht op reactie klant','wacht klant'].includes(normalize(status));
export const tripNumber=s=>String(s??'').trim().replace(/a$/i,'');
export const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const alarmView=f=>!f.viewed?'new':f.viewed.signature===f.reviewSignature?'seen':'changed';
export function reviewSignature(f){return hash({code:f.code,automatic:f.automatic,detail:f.detail,stay:f.stay,evidence:(f.evidence||[]).map(({reference,start,end,name,capacity,occupants,status})=>({reference,start,end,name,capacity,occupants,status})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});}
export const categoryFor=code=>code==='missing'?'Ontbrekend boekingsbewijs':code==='duplicate'?'Mogelijk dubbel geboekt':code.startsWith('dates-')?'Verkeerde datums':code.startsWith('name-')?'Reizigersnaam':code==='capacity'?'Te weinig slaapplaatsen':code.startsWith('capacity-')?'Slaapplaatsen onbekend':code.startsWith('occupancy')?'Geboekte bezetting':code.startsWith('product-')?'Hotel of traject':code.startsWith('room-')?'Kamertype':code==='waiting'?'Wacht op klant':code==='payment'?'Betaallink zonder bevestiging':code.startsWith('unmatched-')||code.startsWith('inactive-')?'Geen actieve reis':code.startsWith('unlinked-')?'Niet gekoppeld aan todo':'Overige controles';
const day=s=>String(s||'').slice(0,10);
function teldarSingleRoomAlias(e,rows){
 if(e.provider!=='Teldar'||!/\/1$/.test(e.reference))return e.reference;
 const names=x=>(x.guestNames||[]).map(normalize).sort().join('|');
 const base=rows.find(x=>x.provider===e.provider&&x.reference===e.reference.slice(0,-2)&&x.roomCount===1&&x.start===e.start&&x.end===e.end&&(normalize(x.name)===normalize(e.name)||names(x)&&names(x)===names(e)));
 return base?base.reference:e.reference;
}
export function reservationScope(b,evidence=[],now=new Date().toISOString()){
 const end=[day(b.dateReturn),day(b.dateDeparture),...(b.todos||[]).map(t=>day(t.endDate))].filter(Boolean).sort().at(-1);
 return !end||end>=day(now)||evidence.some(e=>e.trip===tripNumber(b.index)&&e.status==='confirmed'&&e.end>=day(now));
}
const addDays=(s,n)=>new Date(new Date(day(s)+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
export function twoMonthsBefore(s){const d=new Date(day(s)+'T12:00:00Z'),wanted=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-2);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(wanted,last));return d.toISOString().slice(0,10);}
export const completedBooking=(b,evidence=[],now=new Date().toISOString())=>Boolean(b.dateReturn||(b.todos||[]).some(t=>t.endDate))&&!reservationScope(b,evidence,now);
export function controlOrder(state,trips){const rank=id=>state.findings.some(f=>f.trip===id&&f.status==='alarm')?0:state.findings.some(f=>f.trip===id&&f.status==='attention'&&f.priority==='redelijk hoog')?1:2;return [...new Set(trips)].sort((a,b)=>rank(a)-rank(b)||Number(b)-Number(a));}
export function currentBookings(docs){const byId=new Map();for(const d of docs){const id=d._id.replace(/^drafts\./,'');if(!byId.has(id)||d._id.startsWith('drafts.'))byId.set(id,d);}return [...byId.values()];}
export const informationalStay=t=>/^(booked from)/i.test(String(t.title).trim())||/\b(?:zelfde hut|same cabin)\b/i.test(t.title||'');
export function stays(booking){return (booking.todos||[]).filter(t=>(t.tag==='hotel'||t.startDate&&t.endDate&&t.supplierBookingNumber&&/hotel|premier inn|nachttrein|nightjet/i.test(t.title||''))&&!informationalStay(t)).map(t=>{const text=normalize(t.title+' '+(t.description||''));const type=/nightjet|nachttrein|nacht trein|minicabine|mini cabin|pa1am|pa1ad|ritam|ritad|chajd|atala|atwih|ligcoup|slaapcoup|\beun\b|\brit\b|\brica[0-9]\b|\bnj\b/.test(text)?'Nachttrein':/finnlines|dfds|gonordic|fjordline|stena|buitenhut|binnenhut/.test(text)?'Boot':'Hotel';const provider=/finnlines/.test(text)?'Finnlines':/dfds/.test(text)?'DFDS':/gonordic|oslo.*kopenhagen/.test(text)?'GoNordic':/stc|brig|schaffhausen|interlaken|chur|zurich|luzern|bern\b|zermatt/.test(text)?'STC (vermoedelijk)':type==='Nachttrein'?'NS Int/ÖBB':/premier/.test(text)?'Premier Inn':'Onbekend';return {...t,type,provider,start:day(t.startDate),end:day(t.endDate),confirmed:t.done===true||t.status==='done',reference:String(t.supplierBookingNumber||(/^\s*[A-Z0-9][A-Z0-9 /-]{4,}\s*$/.test(t.description||'')?t.description:(String(t.description||'').match(/\b(?:[A-Z]{3}\d{7}|\d{11,16})\b/g)||[]).join(' '))).trim()};});}
function nearToken(a,b){if(a===b)return true;if(Math.min(a.length,b.length)<5||Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return edits+(a.length-i)+(b.length-j)<=1;}
function matchName(name,passengers){const n=normalize(name);if(!n)return 'missing';const names=passengers.map(p=>normalize(p.firstName+' '+p.lastName));if(names.includes(n))return 'exact';const tokens=n.split(' ').filter(x=>x.length>2);return names.some(x=>{const parts=x.split(' ').filter(t=>t.length>2);return tokens.length&&parts.length&&(tokens.every(t=>parts.some(p=>nearToken(t,p)))||parts.every(p=>tokens.some(t=>nearToken(t,p))));})?'partial':'different';}
export const recurringFinding=f=>f.status==='alarm'||f.status==='attention'&&['missing','waiting','email-incomplete'].includes(f.code);
export function stayGroups(b){const groups=new Map();for(const t of stays(b)){const key=t.type==='Hotel'?[normalize(t.title.split('|')[0]),t.start,t.end].join('|'):t.type==='Nachttrein'&&t.title.match(/\b\d{4,5}\b/)?['train',t.title.match(/\b\d{4,5}\b/)[0],t.start,t.end].join('|'):t._key;const list=groups.get(key)||[];list.push(t);groups.set(key,list);}return [...groups.values()].map(rows=>({...rows[0],todoKeys:rows.map(t=>t._key),quantity:rows.reduce((n,t)=>n+Number(t.quantity||1),0),confirmed:rows.every(t=>t.confirmed),reference:rows.map(t=>t.reference).filter(Boolean).join(' ')}));}
export function evaluate(state,now=new Date().toISOString(),options={}){
 const previousRules=state.rules||DEFAULT_RULES,correctExceptions=previousRules.exceptionVersion!==2;
 const rules=correctExceptions?{...previousRules,exceptionVersion:2,exceptions:previousRules.exceptions.map(n=>normalize(n)==='marc van der meer'?'Marc van der Lee':n)}:previousRules;
 const completed=new Set(currentBookings(state.bookings||[]).filter(b=>completedBooking(b,state.evidence||[],now)).map(b=>tripNumber(b.index)));const selected=trip=>completed.has(trip)||correctExceptions||!options.trips||options.trips.has(trip);
 const findings=(state.findings||[]).filter(f=>!selected(f.trip)),bookings=currentBookings(state.bookings||[]),evidence=state.evidence||[],previous=new Map((state.findings||[]).map(f=>[f.id,f]));
 const byNumber=new Map();for(const b of bookings){const key=tripNumber(b.index);if(!byNumber.has(key))byNumber.set(key,[]);byNumber.get(key).push(b);}
 const duplicateNumbers=new Set([...byNumber].filter(([key,rows])=>rows.length>1&&rows.some(b=>reservationScope(b,evidence.filter(e=>e.trip===key),now))).map(([key])=>key));
 const seenDuplicates=new Set();
 const emit=(b,t,code,severity,title,detail,related=[])=>{
  const id=[tripNumber(b.index),t?._key||'booking',code].join(':'),fingerprint=hash({code,severity,detail,t,related:related.map(({importedAt,...e})=>e),passengers:b.passengers,status:b.status}),old=previous.get(id),override=old?.fingerprint===fingerprint?old.override:null;
  if(options.followup&&old?.fingerprint===fingerprint&&!recurringFinding(old)){findings.push(old);return;}
  findings.push({id,trip:tripNumber(b.index),name:[b.firstName,b.lastName].filter(Boolean).join(' '),departure:day(b.dateDeparture),todoKey:t?._key||'',stay:t?.title||'Boeking',type:t?.type||'Boeking',provider:related[0]?.provider||t?.provider||'Onbekend',country:related[0]?.country||(/STC/.test(t?.provider)?'CH (vermoedelijk)':'Onbekend'),reference:t?.reference||related[0]?.reference||'',code,category:categoryFor(code),automatic:severity,status:override?.status||severity,priority:findingPriority(code,override?.status||severity),title,detail,fingerprint,firstSeen:old?.firstSeen||now,lastChecked:now,override,history:old?.history||[],evidence:related.map(e=>({id:e.id,source:e.source,reference:e.reference,start:e.start,end:e.end,name:e.name,capacity:e.capacity,occupants:e.occupants,status:e.status})),nextCheck:code==='waiting'?(old?.nextCheck&&old.nextCheck>day(now)?old.nextCheck:addDays(now,7)):null});
 };
 for(const b of bookings){
  if(!selected(tripNumber(b.index)))continue;
  if(duplicateNumbers.has(tripNumber(b.index))){if(!seenDuplicates.has(tripNumber(b.index))){emit(b,null,'booking-number','attention','Boekingsnummer komt meermaals voor','Meerdere verschillende reizen in Sanity gebruiken dit nummer. Reserveringen niet samenvoegen; controleer de nummering.');seenDuplicates.add(tripNumber(b.index));}continue;}
  const active=activeBooking(b.status),waiting=waitingBooking(b.status);
  const linked=evidence.filter(e=>e.trip===tripNumber(b.index));
  if(!reservationScope(b,linked,now))continue;
  if(!active&&!waiting){for(const e of linked.filter(e=>e.status==='confirmed'))emit(b,null,'inactive-'+e.id,exceptionName(e.name,rules)?'attention':'alarm','Reservering bij niet-actieve boeking','Controleer annulering of wijziging van de reisstatus.',[e]);continue;}
  for(const t of stayGroups(b)){
   // Completed stays do not remain operational alarms, even while the rest of the trip continues.
   if(t.end&&t.end<day(now)&&!linked.some(e=>t.todoKeys.includes(e.todoKey)&&e.status==='confirmed'&&e.end>=day(now)))continue;
   const check=state.emailChecks?.[String(b.index)]?.stays?.find(c=>c.todoKey===t._key);
   if(check&&check.state!=='found'&&linked.some(e=>e.todoKey===t._key&&e.status==='confirmed'))emit(b,t,'email-incomplete','attention','E-mailcontrole nog niet afgerond',check.explanation);
   const all=[...new Map(linked.filter(e=>t.todoKeys.includes(e.todoKey)).sort((a,b)=>String(a.observedAt||'').localeCompare(String(b.observedAt||''))).map(e=>[e.provider+'|'+teldarSingleRoomAlias(e,linked),e])).values()],live=all.filter(e=>e.status==='confirmed');
   if(waiting&&!live.length)continue;
   if(!check&&live.some(e=>e.automaticEmail))emit(b,t,'email-incomplete','attention','Boekingsgerichte e-mailcontrole nodig','Een reservering is bij de mailboxcontrole gevonden; de volledige zoekronde voor deze overnachting volgt nog.',live);
   if(!live.length){const backup=/backup|annul|storn/i.test(t.title+' '+(t.description||''))&&all.some(e=>e.status==='cancelled');emit(b,t,backup?'cancelled-todo':'missing','attention',backup?'Geannuleerde backup: todo bijwerken':'Overnachting nog niet gecontroleerd',backup?'Annulering in de e-mail bevestigd. Deze reservering telt niet als actieve boeking; controleer de verouderde todo.':check?check.explanation:t.confirmed?'Afgevinkt in Sanity; nog niet in e-mail gezocht.':'Nog niet bevestigd of bevestiging nog niet verwerkt; nog niet in e-mail gezocht.',all);}
   // Distinct reservations may legitimately cover multiple rooms. Explicit group + total occupancy
   // is required; repeated messages for one reservation are not duplicate reservations.
   const refs=new Set(live.map(e=>e.provider+'|'+e.reference));
   const premierRoomGroup=live.length>1&&live.length===Number(t.quantity)&&live.every(e=>e.provider==='Premier Inn'&&e.messageId&&e.messageId===live[0].messageId&&e.start===live[0].start&&e.end===live[0].end);
   const namedRoomRefs=String(t.reference||'').toUpperCase().split(/[^A-Z0-9]+/);
   const listedRoomGroup=t.type==='Hotel'&&live.every(e=>namedRoomRefs.includes(e.reference.toUpperCase())&&e.start===t.start&&e.end===t.end&&e.occupants!=null)&&live.reduce((n,e)=>n+Number(e.occupants),0)===(b.passengers||[]).length;
   const voucherGroup=live.length>1&&live.every(e=>['Teldar','RateHawk'].includes(e.provider)&&e.voucherGuestsVerified&&e.start===t.start&&e.end===t.end)&&new Set(live.flatMap(e=>e.guestNames.map(normalize))).size===live.reduce((n,e)=>n+e.guestNames.length,0)&&live.reduce((n,e)=>n+e.guestNames.length,0)===(b.passengers||[]).length;
   const privateCompartments=t.type==='Nachttrein'&&Number(t.title.match(/(\d+)\s*x\s*lig-?4\s*priv/i)?.[1])===live.length&&live.every(e=>e.capacity===4);
   const miniCabinGroup=t.type==='Nachttrein'&&live.length===Number(t.title.match(/(\d+)\s*x\s*RITAM/i)?.[1])&&live.every(e=>e.capacity===1&&/mini cabin/i.test(e.room));
   const nsGroup=live.length>1&&live.every(e=>e.provider==='NS International'&&e.reference.split('/')[0]===live[0].reference.split('/')[0]&&e.start===live[0].start&&e.end===live[0].end)&&(live.reduce((n,e)=>n+Number(e.occupants||0),0)===(b.passengers||[]).length||privateCompartments||miniCabinGroup);
   if(refs.size>1&&live.some((e,i)=>live.some((x,j)=>i!==j&&e.start<x.end&&x.start<e.end))&&!voucherGroup&&!nsGroup&&!premierRoomGroup&&!listedRoomGroup&&!(live.every(e=>e.group&&e.group===live[0].group)&&(live.reduce((n,e)=>n+Number(e.occupants||0),0)===(b.passengers||[]).length||live.every(e=>e.roomGroupVerified)&&live.length===Number(t.quantity))))emit(b,t,'duplicate','alarm','Mogelijk dubbel geboekt','Meerdere actieve reserveringen. Controleer of dit verschillende kamers zijn of dat annuleringen ontbreken. Een todo-notitie sluit dit alarm niet af.',live);
   const passengers=b.passengers||[],count=passengers.length;
   if(live.length&&!count)emit(b,t,'passengers','attention','Aantal reizigers ontbreekt','Kamercapaciteit kan niet worden vastgesteld.',live);
   if(live.length&&live.every(e=>Number.isFinite(e.capacity))&&live.reduce((n,e)=>n+e.capacity,0)<count)emit(b,t,'capacity','alarm','Te weinig slaapplaatsen',`${count} reizigers; ${live.reduce((n,e)=>n+e.capacity,0)} bevestigde slaapplaatsen.`,live);
   // Missing capacity alone is not evidence of a shortage. Known shortages remain alarms above.
   if(live.length&&live.some(e=>e.occupants==null))emit(b,t,'occupancy-unknown','attention','Bezetting niet aangetoond','Het geboekte aantal personen ontbreekt.',live);
   else if(live.length&&live.reduce((n,e)=>n+e.occupants,0)<count)emit(b,t,'occupancy','attention','Te weinig personen aangemeld',`${count} reizigers; ${live.reduce((n,e)=>n+e.occupants,0)} personen op de bevestiging. Neem contact op met de accommodatie.`,live);
   for(const e of live){
    const start=t.provider==='Finnlines'&&t.start?addDays(t.start,1):t.start;
    const next=(b.todos||[]).find(x=>/zelfde hut|same cabin/i.test(x.title||'')&&day(x.startDate)===t.end);
    const end=t.provider==='Finnlines'&&next?day(next.endDate):t.end;
    if(!start||!end)emit(b,t,'todo-dates','attention','Datums ontbreken in todo','Controleer de verblijfsdatums.',[e]);
    else if(!e.start||!e.end){
     emit(b,t,'dates-incomplete-'+e.id,'attention','Verblijfsdatums niet volledig aangetoond','Reservering gevonden, maar de bron vermeldt niet alle verblijfsdatums. Ontbrekende datums worden niet uit de todo overgenomen.',[e]);
     if(e.start&&e.start!==start)emit(b,t,'dates-'+e.id,'alarm','Verkeerde aankomstdatum',`Todo verwacht ${start}; de bron vermeldt ${e.start}.`,[e]);
    }
    else if(e.start!==start||e.end!==end){
     const shifted=d=>String(Number(d.slice(0,4))+1)+d.slice(4),oldYear=end<day(now)&&e.start===shifted(start)&&e.end===shifted(end);
     emit(b,t,'dates-'+e.id,oldYear?'attention':'alarm',oldYear?'Vermoedelijk verkeerd jaar in todo':'Verkeerde verblijfsdatums',oldYear?`Todo ${start} t/m ${end} ligt in het verleden; de bevestiging heeft dezelfde dagen een jaar later (${e.start} t/m ${e.end}). Werk het todo-jaar bij.`:`Todo verwacht ${start} t/m ${end}; reservering ${e.start} t/m ${e.end}.`,[e]);
    }
    if(!e.productMatch)emit(b,t,'product-'+e.id,'attention','Accommodatie of traject nog te beoordelen','Bevestig de juiste accommodatie of een passend alternatief. Bij een alternatief hoort doorgaans een todo-notitie.',[e]);
    if(t.type==='Nachttrein'&&e.direction==='outbound'&&e.originCountry!=='NL')emit(b,t,'origin-'+e.id,e.originCountry?'alarm':'attention','Vertrekstation heenreis controleren','De heenreis moet geboekt zijn vanaf een Nederlands station.',[e]);
    if(t.type==='Nachttrein'&&!e.direction)emit(b,t,'direction-'+e.id,'attention','Reisrichting ontbreekt','Stel heen- of terugreis vast; Wien Meidling is toegestaan voor de terugreis.',[e]);
    if(e.roomMismatch)emit(b,t,'room-'+e.id,'attention','Kamertype wijkt af','Voldoende capaciteit, maar ander kamertype dan de todo.',[e]);
    if(e.tripReferenceMismatch)emit(b,t,'trip-reference','attention','Afwijkend Treinrondreis-boekingsnummer',`De bron noemt ${e.tripReferenceMismatch}A; naam, accommodatie en datums koppelen deze reservering eenduidig aan ${b.index}A.`,[e]);
    const nm=matchTravelerName(e.name,passengers,{truncated:e.provider==='NS International'||e.nameTruncated===true});
    if(nm!=='exact')emit(b,t,'name-'+e.id,'attention',nm==='partial'?'Mogelijke roepnaam of naamafwijking':'Naam controleren','Vergelijk met de formele naam van alle reizigers. Ontbrekende latere voornamen en boeken op de tweede reiziger zijn toegestaan; een mogelijke roepnaam blijft een laag aandachtspunt.',[e]);
   }
   if(b.floraPaymentLinkCreated&&!t.confirmed&&t.type==='Hotel'&&!(/backup|annul|storn/i.test(t.title+' '+(t.description||''))&&all.some(e=>e.status==='cancelled')&&!live.length)){
    const proven=t.todoKeys.length>1&&live.length&&count>0&&live.every(e=>e.start===t.start&&e.end===t.end&&e.productMatch&&e.occupants!=null&&e.capacity!=null)&&live.reduce((n,e)=>n+e.occupants,0)===count&&live.reduce((n,e)=>n+e.capacity,0)>=count;
    emit(b,t,proven?'todo-confirmation':'payment',proven?'attention':'alarm',proven?'Hotel bevestigd: todo bijwerken':'Betaallink aangemaakt, hotel niet bevestigd',proven?'De bevestigingen dekken alle reizigers en datums. Niet alle bijbehorende todo-regels zijn afgevinkt.':'Bevestig het hotel voordat betaling wordt gevraagd.',live);
   }
  }
  if(waiting&&linked.some(e=>e.status==='confirmed')){
   const id=tripNumber(b.index)+':booking:waiting',old=previous.get(id),first=old?.firstSeen||now,deadline=addDays(first,rules.waitingDays),defer=state.deferrals?.[tripNumber(b.index)],latest=b.dateDeparture?twoMonthsBefore(b.dateDeparture):'';
   const deferred=defer&&defer.until<=latest&&defer.until>day(now);
   emit(b,null,'waiting',day(now)>=deadline&&!deferred?'alarm':'attention','Reservering wacht op acceptatie klant',`Eerst gevonden ${day(first)}. Na ${deadline} acceptatie of annulering controleren.${deferred?' Uitgesteld tot '+defer.until+': '+defer.reason:''}`,linked.filter(e=>e.status==='confirmed'));
  }
 }
 for(const e of evidence.filter(e=>selected(e.trip||'onbekend')&&e.status==='confirmed'&&e.end>=day(now)&&!bookings.some(b=>tripNumber(b.index)===e.trip))){const b={index:e.trip||'onbekend',firstName:e.name};emit(b,null,'unmatched-'+e.id,e.linkReview||exceptionName(e.name,rules)?'attention':'alarm',e.linkReview?'Koppeling reservering beoordelen':'Reservering zonder gekoppelde reis',e.linkReview||'Geen overeenkomstige boeking in de ingelezen Sanity-selectie; controleer de koppeling en reisstatus.',[e]);}
 for(const e of evidence.filter(e=>selected(e.trip||'onbekend')&&e.status==='confirmed')){const b=bookings.find(b=>tripNumber(b.index)===e.trip);if(b&&!duplicateNumbers.has(tripNumber(b.index))&&reservationScope(b,evidence,now)&&e.end>=day(now)&&!stays(b).some(t=>t._key===e.todoKey))emit(b,null,'unlinked-'+e.id,'attention','Reservering zonder gekoppelde overnachting','Koppel de bevestiging aan de juiste todo voordat deze als gecontroleerd telt.',[e]);}
 const summaries=bookings.map(b=>{const f=findings.filter(x=>x.trip===tripNumber(b.index)),ss=stayGroups(b),covered=ss.length>0&&ss.every(t=>evidence.some(e=>e.trip===tripNumber(b.index)&&t.todoKeys.includes(e.todoKey)&&e.status==='confirmed'));return {trip:tripNumber(b.index),name:[b.firstName,b.lastName].filter(Boolean).join(' '),departure:day(b.dateDeparture),archived:completedBooking(b,evidence,now),status:b.status,overnights:ss.length,checked:!completedBooking(b,evidence,now)&&covered&&!f.some(x=>x.status!=='checked'),alarms:f.filter(x=>x.status==='alarm').length,attention:f.filter(x=>x.status==='attention').length};});
 const archived=[...(state.archived||[])];for(const old of state.findings||[])if(!findings.some(f=>f.id===old.id))archived.push({...old,resolvedAt:now});
 for(const f of findings){f.reviewSignature=reviewSignature(f);f.viewed=previous.get(f.id)?.viewed||null;f.viewStatus=alarmView(f);}
 return {findings,summary:summaries,archived,rules};
}

export function validateEvidence(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>2000)throw Error('Importeer 1 tot 2000 reserveringen.');
 return rows.map((r,i)=>{const fail=s=>{throw Error(`Regel ${i+1}: ${s}`);};
  for(const k of ['provider','reference','source','status'])if(typeof r[k]!=='string'||!r[k].trim())fail(`${k} ontbreekt`);
  if(!['confirmed','cancelled'].includes(r.status))fail('status moet confirmed of cancelled zijn');
  for(const k of ['start','end'])if(!/^\d{4}-\d{2}-\d{2}$/.test(r[k]||'')||!Number.isFinite(Date.parse(r[k]))||new Date(r[k]).toISOString().slice(0,10)!==r[k])fail(`${k}: gebruik een geldige datum jjjj-mm-dd`);
  if(r.end<=r.start)fail('einddatum moet na begindatum liggen');
  for(const k of ['capacity','occupants'])if(r[k]!=null&&r[k]!==''&&(!Number.isInteger(Number(r[k]))||Number(r[k])<1||Number(r[k])>1000))fail(`${k}: positief geheel getal vereist`);
  const e={};for(const k of ['provider','reference','source','status','start','end','name','todoKey','country','group','originCountry','direction'])e[k]=String(r[k]||'').trim().slice(0,1000);
  e.trip=tripNumber(r.trip);e.capacity=r.capacity==null||r.capacity===''?null:Number(r.capacity);e.occupants=r.occupants==null||r.occupants===''?null:Number(r.occupants);
  e.productMatch=r.productMatch===true||r.productMatch==='true';e.roomMismatch=r.roomMismatch===true||r.roomMismatch==='true';
  e.id=hash([e.provider,e.reference,e.trip,e.todoKey]);return e;
 });
}
