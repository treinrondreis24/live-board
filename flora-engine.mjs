import {createHash} from 'node:crypto';

export const DEFAULT_RULES={version:1,partialNames:'low',waitingDays:7,exceptions:['Hildebrand van Kuijeren','Nicoleta Andrei','Florentina Niculae','Marc van der Meer','Lucas Kielman','Jelle de Boer']};
export const normalize=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const tripNumber=s=>String(s??'').trim().replace(/a$/i,'');
export const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const categoryFor=code=>code==='missing'?'Ontbrekend boekingsbewijs':code==='duplicate'?'Mogelijk dubbel geboekt':code.startsWith('dates-')?'Verkeerde datums':code.startsWith('name-')?'Reizigersnaam':code==='capacity'?'Te weinig slaapplaatsen':code.startsWith('capacity-')?'Slaapplaatsen onbekend':code.startsWith('occupancy')?'Geboekte bezetting':code.startsWith('product-')?'Hotel of traject':code.startsWith('room-')?'Kamertype':code==='waiting'?'Wacht op klant':code==='payment'?'Betaallink zonder bevestiging':code.startsWith('unmatched-')||code.startsWith('inactive-')?'Geen actieve reis':code.startsWith('unlinked-')?'Niet gekoppeld aan todo':'Overige controles';
const day=s=>String(s||'').slice(0,10);
const addDays=(s,n)=>new Date(new Date(day(s)+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
export function twoMonthsBefore(s){const d=new Date(day(s)+'T12:00:00Z'),wanted=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-2);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(wanted,last));return d.toISOString().slice(0,10);}
export function currentBookings(docs){const byId=new Map();for(const d of docs){const id=d._id.replace(/^drafts\./,'');if(!byId.has(id)||d._id.startsWith('drafts.'))byId.set(id,d);}return [...byId.values()];}
export function stays(booking){return (booking.todos||[]).filter(t=>t.tag==='hotel'&&!/^(booked from|zelfde hut|same cabin)/i.test(String(t.title).trim())).map(t=>{const text=normalize(t.title+' '+(t.description||''));const type=/nightjet|nachttrein|nacht trein|minicabine|mini cabin|pa1am|ligcoup|slaapcoup|\beun\b|\brit\b|\brica[0-9]\b|\bnj\b/.test(text)?'Nachttrein':/finnlines|dfds|gonordic|fjordline|stena|buitenhut|binnenhut/.test(text)?'Boot':'Hotel';const provider=/finnlines/.test(text)?'Finnlines':/dfds/.test(text)?'DFDS':/gonordic|oslo.*kopenhagen/.test(text)?'GoNordic':/stc|brig|schaffhausen|interlaken|chur|zurich|luzern|bern\b|zermatt/.test(text)?'STC (vermoedelijk)':type==='Nachttrein'?'NS Int/ÖBB':/premier/.test(text)?'Premier Inn':'Onbekend';return {...t,type,provider,start:day(t.startDate),end:day(t.endDate),confirmed:t.done===true||t.status==='done',reference:String(t.supplierBookingNumber||(/^\s*[A-Z0-9][A-Z0-9 /-]{4,}\s*$/.test(t.description||'')?t.description:'')).trim()};});}
function nearToken(a,b){if(a===b)return true;if(Math.min(a.length,b.length)<5||Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return edits+(a.length-i)+(b.length-j)<=1;}
function matchName(name,passengers){const n=normalize(name);if(!n)return 'missing';const names=passengers.map(p=>normalize(p.firstName+' '+p.lastName));if(names.includes(n))return 'exact';const tokens=n.split(' ').filter(x=>x.length>2);return names.some(x=>{const parts=x.split(' ').filter(t=>t.length>2);return tokens.length&&parts.length&&(tokens.every(t=>parts.some(p=>nearToken(t,p)))||parts.every(p=>tokens.some(t=>nearToken(t,p))));})?'partial':'different';}
export const recurringFinding=f=>f.status==='alarm'||f.status==='attention'&&['missing','waiting','email-incomplete'].includes(f.code);
export function evaluate(state,now=new Date().toISOString(),options={}){
 const selected=trip=>!options.trips||options.trips.has(trip);
 const rules=state.rules||DEFAULT_RULES,findings=(state.findings||[]).filter(f=>!selected(f.trip)),bookings=currentBookings(state.bookings||[]),evidence=state.evidence||[],previous=new Map((state.findings||[]).map(f=>[f.id,f]));
 const emit=(b,t,code,severity,title,detail,related=[])=>{
  const id=[tripNumber(b.index),t?._key||'booking',code].join(':'),fingerprint=hash({code,severity,detail,t,related:related.map(({importedAt,...e})=>e),passengers:b.passengers,status:b.status}),old=previous.get(id),override=old?.fingerprint===fingerprint?old.override:null;
  if(options.followup&&old?.fingerprint===fingerprint&&!recurringFinding(old)){findings.push(old);return;}
  findings.push({id,trip:tripNumber(b.index),name:[b.firstName,b.lastName].filter(Boolean).join(' '),departure:day(b.dateDeparture),todoKey:t?._key||'',stay:t?.title||'Boeking',type:t?.type||'Boeking',provider:t?.provider||related[0]?.provider||'Onbekend',country:related[0]?.country||(/STC/.test(t?.provider)?'CH (vermoedelijk)':'Onbekend'),reference:t?.reference||related[0]?.reference||'',code,category:categoryFor(code),automatic:severity,status:override?.status||severity,priority:severity==='alarm'?'hoog':code.startsWith('name-')&&title==='Naam wijkt licht af'?'laag':'normaal',title,detail,fingerprint,firstSeen:old?.firstSeen||now,lastChecked:now,override,history:old?.history||[],evidence:related.map(e=>({id:e.id,source:e.source,reference:e.reference,start:e.start,end:e.end,name:e.name,capacity:e.capacity,occupants:e.occupants,status:e.status})),nextCheck:code==='waiting'?(old?.nextCheck&&old.nextCheck>day(now)?old.nextCheck:addDays(now,7)):null});
 };
 for(const b of bookings){
  if(!selected(tripNumber(b.index)))continue;
  const active=normalize(b.status)==='te verwerken',waiting=normalize(b.status)==='wacht op reactie klant';
  const linked=evidence.filter(e=>e.trip===tripNumber(b.index));
  if(!active&&!waiting){for(const e of linked.filter(e=>e.status==='confirmed'))emit(b,null,'inactive-'+e.id,rules.exceptions.some(n=>normalize(n)===normalize(e.name))?'attention':'alarm','Reservering bij niet-actieve boeking','Controleer annulering of wijziging van de reisstatus.',[e]);continue;}
  for(const t of stays(b)){
   const check=state.emailChecks?.[String(b.index)]?.stays?.find(c=>c.todoKey===t._key);
   if(check&&check.state!=='found'&&linked.some(e=>e.todoKey===t._key&&e.status==='confirmed'))emit(b,t,'email-incomplete','attention','E-mailcontrole nog niet afgerond',check.explanation);
   const all=linked.filter(e=>e.todoKey===t._key),live=all.filter(e=>e.status==='confirmed');
   if(!check&&live.some(e=>e.automaticEmail))emit(b,t,'email-incomplete','attention','Boekingsgerichte e-mailcontrole nodig','Een reservering is bij de mailboxcontrole gevonden; de volledige zoekronde voor deze overnachting volgt nog.',live);
   if(!live.length)emit(b,t,'missing','attention','Overnachting nog niet gecontroleerd',check?check.explanation:t.confirmed?'Afgevinkt in Sanity; nog niet in e-mail gezocht.':'Nog niet bevestigd of bevestiging nog niet verwerkt; nog niet in e-mail gezocht.',all);
   // Distinct reservations may legitimately cover multiple rooms. Explicit group + total occupancy
   // is required; repeated messages for one reservation are not duplicate reservations.
   const refs=new Set(live.map(e=>e.provider+'|'+e.reference));
   if(refs.size>1&&!(live.every(e=>e.group&&e.group===live[0].group)&&(live.reduce((n,e)=>n+Number(e.occupants||0),0)===(b.passengers||[]).length||live.every(e=>e.roomGroupVerified)&&live.length===Number(t.quantity))))emit(b,t,'duplicate','alarm','Mogelijk dubbel geboekt','Meerdere actieve reserveringen. Controleer of dit verschillende kamers zijn of dat annuleringen ontbreken. Een todo-notitie sluit dit alarm niet af.',live);
   const passengers=b.passengers||[],count=passengers.length;
   if(live.length&&!count)emit(b,t,'passengers','attention','Aantal reizigers ontbreekt','Kamercapaciteit kan niet worden vastgesteld.',live);
   if(live.length&&live.every(e=>Number.isFinite(e.capacity))&&live.reduce((n,e)=>n+e.capacity,0)<count)emit(b,t,'capacity','alarm','Te weinig slaapplaatsen',`${count} reizigers; ${live.reduce((n,e)=>n+e.capacity,0)} bevestigde slaapplaatsen.`,live);
   if(live.length&&live.some(e=>e.capacity==null))emit(b,t,'capacity-unknown','attention','Kamercapaciteit niet aangetoond','Controleer het kamertype en het aantal slaapplaatsen.',live);
   if(live.length&&live.some(e=>e.occupants==null))emit(b,t,'occupancy-unknown','attention','Bezetting niet aangetoond','Het geboekte aantal personen ontbreekt.',live);
   else if(live.length&&live.reduce((n,e)=>n+e.occupants,0)<count)emit(b,t,'occupancy','attention','Te weinig personen aangemeld',`${count} reizigers; ${live.reduce((n,e)=>n+e.occupants,0)} personen op de bevestiging. Neem contact op met de accommodatie.`,live);
   for(const e of live){
    const start=t.provider==='Finnlines'&&t.start?addDays(t.start,1):t.start;
    const next=(b.todos||[]).find(x=>/zelfde hut|same cabin/i.test(x.title||'')&&day(x.startDate)===t.end);
    const end=t.provider==='Finnlines'&&next?day(next.endDate):t.end;
    if(!start||!end)emit(b,t,'todo-dates','attention','Datums ontbreken in todo','Controleer de verblijfsdatums.',[e]);
    else if(e.start!==start||e.end!==end)emit(b,t,'dates-'+e.id,'alarm','Verkeerde verblijfsdatums',`Todo verwacht ${start} t/m ${end}; reservering ${e.start} t/m ${e.end}.`,[e]);
    if(!e.productMatch)emit(b,t,'product-'+e.id,'attention','Accommodatie of traject nog te beoordelen','Bevestig de juiste accommodatie of een passend alternatief. Bij een alternatief hoort doorgaans een todo-notitie.',[e]);
    if(t.type==='Nachttrein'&&e.direction==='outbound'&&e.originCountry!=='NL')emit(b,t,'origin-'+e.id,e.originCountry?'alarm':'attention','Vertrekstation heenreis controleren','De heenreis moet geboekt zijn vanaf een Nederlands station.',[e]);
    if(t.type==='Nachttrein'&&!e.direction)emit(b,t,'direction-'+e.id,'attention','Reisrichting ontbreekt','Stel heen- of terugreis vast; Wien Meidling is toegestaan voor de terugreis.',[e]);
    if(e.roomMismatch)emit(b,t,'room-'+e.id,'attention','Kamertype wijkt af','Voldoende capaciteit, maar ander kamertype dan de todo.',[e]);
    const nm=matchName(e.name,passengers);
    if(nm==='missing'||nm==='different'||nm==='partial'&&rules.partialNames==='low')emit(b,t,'name-'+e.id,'attention',nm==='partial'?'Naam wijkt licht af':'Naam controleren','Vergelijk met alle reizigers; een reservering op naam van de tweede reiziger is toegestaan.',[e]);
   }
   if(b.floraPaymentLinkCreated&&!t.confirmed&&t.type==='Hotel')emit(b,t,'payment','alarm','Betaallink aangemaakt, hotel niet bevestigd','Bevestig het hotel voordat betaling wordt gevraagd.',live);
  }
  if(waiting&&linked.some(e=>e.status==='confirmed')){
   const id=tripNumber(b.index)+':booking:waiting',old=previous.get(id),first=old?.firstSeen||now,deadline=addDays(first,rules.waitingDays),defer=state.deferrals?.[tripNumber(b.index)],latest=b.dateDeparture?twoMonthsBefore(b.dateDeparture):'';
   const deferred=defer&&defer.until<=latest&&defer.until>day(now);
   emit(b,null,'waiting',day(now)>=deadline&&!deferred?'alarm':'attention','Reservering wacht op acceptatie klant',`Eerst gevonden ${day(first)}. Na ${deadline} acceptatie of annulering controleren.${deferred?' Uitgesteld tot '+defer.until+': '+defer.reason:''}`,linked.filter(e=>e.status==='confirmed'));
  }
 }
 for(const e of evidence.filter(e=>selected(e.trip||'onbekend')&&e.status==='confirmed'&&!bookings.some(b=>tripNumber(b.index)===e.trip))){const b={index:e.trip||'onbekend',firstName:e.name};emit(b,null,'unmatched-'+e.id,rules.exceptions.some(n=>normalize(n)===normalize(e.name))?'attention':'alarm','Reservering zonder gekoppelde reis','Geen overeenkomstige boeking in de ingelezen Sanity-selectie; controleer de koppeling en reisstatus.',[e]);}
 for(const e of evidence.filter(e=>selected(e.trip||'onbekend')&&e.status==='confirmed')){const b=bookings.find(b=>tripNumber(b.index)===e.trip);if(b&&!stays(b).some(t=>t._key===e.todoKey))emit(b,null,'unlinked-'+e.id,'attention','Reservering zonder gekoppelde overnachting','Koppel de bevestiging aan de juiste todo voordat deze als gecontroleerd telt.',[e]);}
 const summaries=bookings.map(b=>{const f=findings.filter(x=>x.trip===tripNumber(b.index)),ss=stays(b),covered=ss.length>0&&ss.every(t=>evidence.some(e=>e.trip===tripNumber(b.index)&&e.todoKey===t._key&&e.status==='confirmed'));return {trip:tripNumber(b.index),name:[b.firstName,b.lastName].filter(Boolean).join(' '),departure:day(b.dateDeparture),status:b.status,overnights:ss.length,checked:covered&&!f.some(x=>x.status!=='checked'),alarms:f.filter(x=>x.status==='alarm').length,attention:f.filter(x=>x.status==='attention').length};});
 const archived=[...(state.archived||[])];for(const old of state.findings||[])if(!findings.some(f=>f.id===old.id))archived.push({...old,resolvedAt:now});
 return {findings,summary:summaries,archived};
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
