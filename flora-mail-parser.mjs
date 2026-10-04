import {normalize,hash,validateEvidence,stays} from './flora-engine.mjs';
const num=(s,re)=>{const m=s.match(re);return m?Number(m[1]):null;};
export function dateValue(s){const numeric=String(s).match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);if(numeric)return `${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`;const m=String(s).toLowerCase().match(/\b(\d{1,2})\s+(jan\w*|feb\w*|mar\w*|maa\w*|apr\w*|may|mei|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|okt\w*|nov\w*|dec\w*)\.?\s+(20\d{2})/);if(!m)return '';const month={jan:1,feb:2,mar:3,maa:3,apr:4,may:5,mei:5,jun:6,jul:7,aug:8,sep:9,oct:10,okt:10,nov:11,dec:12}[m[2].slice(0,3)];return `${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
const numericDate='\\d{1,2}[./-]\\d{1,2}[./-]20\\d{2}';
function afterDate(s,label){const m=s.match(new RegExp(label+'[^\\d]{0,25}('+numericDate+')','i'));return m?dateValue(m[1]):'';}
export function roomCapacity(s){
 const explicit=String(s).match(/\bup to (\d+) guests\b/i);if(explicit)return Number(explicit[1]);
 const alternatives=String(s).split(/\s+(?:of|or|oder)\s+/i);if(alternatives.length>1){const values=alternatives.map(roomCapacity);return values.every(v=>v!=null)?Math.min(...values):null;}
 const beds=[...String(s).matchAll(/(\d+)\s*(tweepersoonsbed(?:den)?|eenpersoonsbed(?:den)?|double beds?|single beds?|queen(?: beds?)?|king(?: beds?)?)/gi)];
 if(beds.length)return beds.reduce((n,m)=>n+Number(m[1])*(/eenpersoons|single/i.test(m[2])?1:2),0);
 if(/\b1 twee-$/i.test(s))return 2;
 if(/triple|driepersoons/i.test(s))return 3;if(/double|twin|tweepersoons|doppelzimmer/i.test(s))return 2;if(/single|eenpersoons|einzelzimmer/i.test(s))return 1;return null;
}
export function hotelReplyReview(message){
 const domain=message.from.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase(),provider=domain==='bernerhof-interlaken.ch'?'Hotel Bernerhof':domain==='hotel-federale.ch'?'Hotel Federale':'';
 const head=message.docs.filter(d=>d.label==='E-mail').map(d=>d.text).join(' ').replace(/\s+/g,' ').split(/Best regards|Sincerely|Kind regards|\bVon:|\bFrom:|\bDa:|\bOn .{0,100}wrote:|\bOp .{0,100}schreef:/i)[0];
 return provider&&/confirm|reserv|book|cancel|storn|annul|room|date|fully booked/i.test(head)?provider:'';
}
function directHotel(s,message){
 const domain=message.from.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase(),provider=domain==='bernerhof-interlaken.ch'?'Hotel Bernerhof':domain==='hotel-federale.ch'?'Hotel Federale':'';
 if(!provider)return null;
 // Only the hotel's own opening reply can confirm; never a quoted older reply or our request.
 const head=s.split(/Best regards|Sincerely|Kind regards|\bVon:|\bFrom:|\bDa:|\bOn .{0,100}wrote:|\bOp .{0,100}schreef:/i)[0];
 if(!/\bwe confirm\b|\b(?:reservation|booking)\s+[\w(). -]{0,35}\bconfirmed\b|\bnew confirmation:/i.test(head)||/cannot|can't|not confirm|shall we|would|could|\?|cancel|storn|annul/i.test(head))return null;
 const requests=[...s.matchAll(/Arrival date:\s*(.*?)\s*Departure date:\s*(.*?)\s*Customer name:\s*(.*?)\s*Rooms:\s*(.*?)\s*Persons:\s*(.*?)\s*Our reference:\s*(\d{4,6})A/gi)];
 if(!requests.length||new Set(requests.map(m=>JSON.stringify(m.slice(1)))).size!==1)return null;
 const r=requests[0],trip=message.subject.match(/\b(\d{4,6})A\b/i)?.[1];if(trip!==r[6])return null;
 // Amendments need their own explicit dates and room interpretation; do not reuse an older request.
 if(/new confirmation|chang|instead|rather|different|tomorrow|earlier|later|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\b\d{1,2}[./-]\d{1,2}\b/i.test(head))return null;
 const qty=Number(r[4].match(/^(\d+)\s*x/i)?.[1]||0);if(qty!==1)return null;
 const room=roomCapacity(head)!=null?head:r[4],occupants=[...r[5].matchAll(/\([^)]*\d{4}\)/g)].length;
 return {provider,reference:head.match(/HCN:\s*(\w+)/i)?.[1]||'EMAIL-'+trip,start:dateValue(r[1]),end:dateValue(r[2]),name:r[3],occupants:occupants||null,capacity:roomCapacity(room),room,product:provider,tripHint:trip};
}
// Supported supplier layouts and explicit hotel replies produce evidence; requests alone never do.
export function parseDocument(doc,message){
 if(doc.label==='E-mail'&&/cancel|annul|refund|storn/i.test(message.subject)){
  const c=cancellation(message);if(c?.provider!=='Premier Inn')return null;
  const text=doc.text.replace(/\s+/g,' '),germanDate=s=>dateValue(String(s||'').replace(/(\d)\.\s+/g,'$1 ').replace(/Dezember/gi,'December').replace(/Oktober/gi,'October').replace(/März/gi,'March'));
  try{return {...validateEvidence([{...c,source:c.source,status:'cancelled',start:germanDate(text.match(/Check-in\s+(.*?)\s+-/i)?.[1]),end:germanDate(text.match(/Check-out\s+(.*?)\s+-/i)?.[1])}])[0],product:'Premier Inn',messageId:message.id,document:doc.label,observedAt:message.at};}catch{return null;}
 }
 const s=doc.text.replace(/\s+/g,' ').trim(),n=normalize(s);let e=null;
 if(/expediataap\./i.test(message.from)&&/Naar aanleiding van je verzoek hebben we je boeking gewijzigd/i.test(s)&&/Je reservering is geboekt/i.test(s)){
  const d=s.match(/(\d{1,2} \w+\.? 20\d{2})\s*-\s*(\d{1,2} \w+\.? 20\d{2})\s*\|\s*Reisplannummer\s+(\d+)/i),guest=s.match(/Geboekt voor\s+(.+?)\s+(\d+)\s+volwassen(?:e|en)(?:,?\s*(\d+)\s+kind(?:eren)?)?/i),room=s.match(/\bKamer\s+(.*?)\s+Geboekt voor/)?.[1]||'';
  if(!/\b1 kamer\b/i.test(s))return null;
  e={provider:'Expedia',reference:d?.[3],start:dateValue(d?.[1]),end:dateValue(d?.[2]),name:guest?.[1]||'',occupants:guest?Number(guest[2])+Number(guest[3]||0):null,capacity:roomCapacity(room),roomCount:1,room,product:s.match(/Verblijf bij\s+(.*?)\s+(?:Naar aanleiding|\d{1,2} \w+)/i)?.[1]||''};
 }else if(/expediataap\./i.test(message.from)&&/je boeking is bevestigd/i.test(s)&&/Reisplannummer\s+\d+/i.test(s)){
  const d=s.match(/Boekingsdatums\s+(.*?)\s+-\s+(.*?)\s+Reisplannummer/i);
  const blocks=[...s.matchAll(/Geboekt voor\s+(.+?)\s+(\d+)\s+volwassen(?:e|en)(?:,?\s*(\d+)\s+kind(?:eren)?)?\s+Kamer\s+(.*?)(?=Kamervoorkeuren)/gi)];
  const capacities=blocks.map(m=>roomCapacity(m[4]));
  e={provider:'Expedia',reference:s.match(/Reisplannummer\s+(\d+)/i)[1],start:dateValue(d?.[1]),end:dateValue(d?.[2]),name:blocks[0]?.[1]||'',occupants:blocks.length?blocks.reduce((n,m)=>n+Number(m[2])+Number(m[3]||0),0):null,capacity:capacities.length&&capacities.every(n=>n!=null)?capacities.reduce((a,b)=>a+b,0):null,roomCount:blocks.length||null,product:s.match(/Hoteloverzicht\s+(.+?)\s+(?:[A-Z][a-z]+\s+)?\d/i)?.[1]||s.match(/Itinerary:\s*(.*?)\s+Bedankt/i)?.[1]||'',room:blocks.map(m=>m[4].split(/Inbegrepen voorzieningen/i)[0].trim()).join('; ')};
 }else if(doc.label!=='E-mail'&&/Booking confirmed/i.test(s)&&/Premier Inn/i.test(s)){
  e={provider:'Premier Inn',reference:s.match(/Booking reference\s+(\d+)/i)?.[1],start:dateValue(s.match(/Check-in:(.*?)Check-out:/i)?.[1]),end:dateValue(s.match(/Check-out:(.*?)Your booking/i)?.[1]),name:s.match(/Hello\s+(.*?)\s+Thank you/i)?.[1]||'',occupants:num(s,/(\d+)\s+adult/i),capacity:roomCapacity(s.match(/Booked room details(.*?)This is/i)?.[1]||''),product:s.match(/Premier Inn\s+(.+?)\s+(?:Hello|[A-Z][a-z]+\s+[A-Z][a-z]+|\d+ adult)/)?.[0]||'Premier Inn',room:s.match(/Booked room details(.*?)This is/i)?.[1]||''};
 }else if(doc.label!=='E-mail'&&/FINNLINES/i.test(s)&&/Booking Confirmation/i.test(s)){
  const route=s.match(/(TRAVEM[ÜU]NDE[-–]HELSINKI|HELSINKI[-–]TRAVEM[ÜU]NDE)\s+(\d{2}\/\d{2}\/20\d{2})\s+\d{2}:\d{2}\s+(\d{2}\/\d{2}\/20\d{2})/i),c=s.match(/(?:Outside|Inside) cabin,\s*(\d+) beds\s+(\d+)/i);
  e={provider:'Finnlines',reference:s.match(/\bF\d{9}\b/)?.[0],start:dateValue(route?.[2]),end:dateValue(route?.[3]),name:s.match(/Booking Holder:\s*(.*?)\s+Issuing Date/i)?.[1]||'',occupants:num(s,/Passenger\s+A\s+Adult\s+(\d+)/i),capacity:c?Number(c[1])*Number(c[2]):null,product:route?.[1]||'',room:c?.[0]||''};
 }else if(doc.label!=='E-mail'&&/VERVOERBEWIJS\s*\+\s*RESERVERING/i.test(s)&&/NIGHTJET/i.test(s)){
  const dnr=s.match(/DNR:\s*([A-Z0-9]+)\s+ID:\s*(\d+)/),route=s.match(/(\d{2}\.\d{2})\s+(\d{2}:\d{2})\s+(.+?)\s*->\s*(.+?)(\d{2}\.\d{2})\s+(\d{2}:\d{2})/),year=doc.year||s.match(/\b20\d{2}\b/)?.[0],name=s.match(/NIGHTJET\s+([^\d]+?)\s*\d+\s+VOLWASSENEN/i),places=s.match(/(?:LIGPLAATS|BEDPLAATS)\s+([\d\s-]+?)(?=NIET|AFD|DO\b|\d+ RIT)/i);let capacity=null;if(places){const p=places[1].trim();const range=p.match(/^(\d+)\s*-\s*(\d+)$/);capacity=range?Number(range[2])-Number(range[1])+1:p.split(/\s+/).filter(Boolean).length;}
  const origin=route?.[3]||'',dest=route?.[4]||'',nl=/UTRECHT|AMSTERDAM|ARNHEM|DEVENTER|AMERSFOORT|ROTTERDAM/i;
  e={provider:'NS International',reference:dnr?dnr[1]+'/'+dnr[2]:null,start:year&&route?dateValue(route[1]+'.'+year):'',end:year&&route?dateValue(route[5]+'.'+year):'',name:name?.[1]?.replace(/^([^,]+),\s*(.+)$/,'$2 $1')||'',occupants:num(s,/(\d+)\s+VOLWASSENEN/i),capacity,product:origin+' → '+dest,direction:nl.test(origin)?'outbound':nl.test(dest)?'inbound':'',originCountry:nl.test(origin)?'NL':'',room:/MINI CABIN/i.test(s)?'Mini Cabin':/VIER LIGPL/i.test(s)?'Couchette 4':''};
 }else if(doc.label!=='E-mail'&&/RESERVIERUNG/i.test(s)&&/Nightjet/i.test(s)&&/zur Buchung/i.test(s)){
  const ref=s.match(/zur Buchung\s+(\d[\d ]{12,22})/i),name=s.match(/für\s+(.*?)\s*,\s*\.?\s*\d+ Plätze/i),route=s.match(/Von\s+([A-ZÄÖÜ ]+)\s*\.\s*\.\s*Von Bahnsteig.*?Nach\s+([A-ZÄÖÜ ]+)/);
  const flat=s.replace(/\*/g,' ').replace(/\s+/g,' '),table=flat.match(/(\d{2}\.\d{2})\s+\d{2}:\d{2}\s+(.+?)\s*->\s*->\s*(.+?)\s+(\d{2}\.\d{2})\s+\d{2}:\d{2}/),year=s.match(/Gültig:\s*(20\d{2})/)?.[1];const origin=route?.[1]?.trim()||table?.[2]?.trim()||'',dest=route?.[2]?.trim()||table?.[3]?.trim()||'',nl=/UTRECHT|AMSTERDAM|ARNHEM/i,places=num(s,/(\d+)\s+PLÄTZE/i);
  e={provider:'ÖBB',reference:ref?.[1].replace(/\s/g,''),start:afterDate(s,'Abfahrt am')||(table&&year?dateValue(table[1]+'.'+year):''),end:afterDate(s,'Ankunft am')||(table&&year?dateValue(table[4]+'.'+year):''),name:name?.[1]||s.match(/inkl\. Frühstück\s+(.*?)\s+\d+ PLÄTZE/i)?.[1]||'',capacity:places,occupants:places,product:origin+' → '+dest,direction:nl.test(origin)?'outbound':nl.test(dest)?'inbound':'',originCountry:nl.test(origin)?'NL':'',room:/Mini Cabin/i.test(s)?'Mini Cabin':''};
 }else if(doc.label!=='E-mail'&&/Deze accommodatie is geboekt door onze partner/i.test(s)&&/Reservering\s+\d+/i.test(s)){
  e={provider:'RateHawk',reference:s.match(/Reservering\s+(\d+)/i)?.[1],start:afterDate(s,'Inchecken'),end:afterDate(s,'Uitchecken:'),name:s.match(/Gasten:\s*(.*?)(?:,|Belangrijk)/i)?.[1]||'',occupants:num(s,/voor\s+(\d+)\s+volwassenen/i),capacity:roomCapacity(s.match(/Klassiek(.*?)Gasten:/i)?.[0]||''),product:s.match(/door onze partner\s+(.*?)\s+\d{4,}/i)?.[1]||'',room:s.match(/Klassiek(.*?)Gasten:/i)?.[0]||''};
 }else if(doc.label!=='E-mail'&&/Voucher\s*\/\s*Confirmation/i.test(s)&&/Switzerland Travel Centre/i.test(s)){
  e={provider:'STC',reference:s.match(/Booking\s+(TRR\d+)/i)?.[1],start:afterDate(s,'Check in day'),end:afterDate(s,'Check out day'),name:s.match(/Booking name\s+(?:Ms\.|Mr\.)?\s*(.*?),/i)?.[1]||'',occupants:num(s,/Occupancy\s+(\d+)\s+adults/i),capacity:roomCapacity(s.match(/Room description\s+(.*?)Room type/i)?.[1]||''),product:s.match(/Hotel\/Service\s+(.*?)\s+(?:Bleicheplatz|Via|[A-Z][a-z]+strasse)/i)?.[1]||'',room:s.match(/Room description\s+(.*?)Room type/i)?.[1]||''};
 }else if(doc.label==='E-mail')e=directHotel(s,message);
 if(!e?.reference||!e.start||!e.end)return null;
 try{return {...validateEvidence([{...e,source:message.url,status:'confirmed'}])[0],product:e.product,room:e.room,roomCount:e.roomCount||null,messageId:message.id,document:doc.label,observedAt:message.at,ticketLink:doc.link||'',tripHint:message.subject.match(/\b(\d{4,6})A\b/i)?.[1]||s.match(/(?:\bRef:|Our reference:)\s*(\d{4,6})A\b/i)?.[1]||'',sourceText:s.slice(0,7000)};}catch{return null;}
}
export function cancellation(message){
 const text=message.docs.filter(d=>d.label==='E-mail').map(d=>d.text).join(' ');let provider='',reference='';
 if(/@oebb\.at\b/i.test(message.from)&&/refund/i.test(message.subject)&&/refund.*processed successfully/i.test(text)&&/refunded tickets become invalid/i.test(text)){provider='ÖBB';reference=text.match(/Booking code:\s*([\d ]{16,25})/i)?.[1]?.replace(/\s/g,'');}
 if(/@expediataap\.nl\b/i.test(message.from)&&/Annuleringsbevestiging/i.test(message.subject)&&/Je hebt geannuleerd|Je hotelkamer is geannuleerd/i.test(text)){provider='Expedia';reference=text.match(/TAAP-reisplannummer:\s*(\d+)/i)?.[1];}
 if(/@(?:[\w-]+\.)*premierinn\.com\b/i.test(message.from)&&/Stornierung|Cancellation/i.test(message.subject)&&/Buchung storniert|booking (?:has been |is )?cancelled/i.test(text)){provider='Premier Inn';reference=text.match(/(?:Buchungsnummer|Booking reference)\s*:?\s*([A-Z0-9]+)/i)?.[1];}
 return reference?{provider,reference,at:message.at,source:message.url}:null;
}
export function passengerMatches(name,p){const first=normalize(p.firstName).split(' ')[0],last=normalize(p.lastName);return first.length>=2&&last.length>=2&&!['nnb','onbekend','unknown','tbd'].includes(first)&&!['nnb','onbekend','unknown','tbd'].includes(last)&&normalize(name).split(' ').includes(first)&&(' '+normalize(name)+' ').includes(' '+last+' ');}
const quoted=s=>'"'+String(s).replace(/["\\{}\r\n]/g,' ').trim()+'"';
export function bookingQuery(b){const ss=stays(b),terms=[quoted(String(b.index)+'A'),...ss.map(t=>t.reference).filter(r=>r.length>=5).map(quoted),...(b.passengers||[]).filter(p=>passengerMatches(p.firstName+' '+p.lastName,p)).map(p=>'('+quoted(p.firstName.trim().split(/\s+/)[0])+' '+quoted(p.lastName)+')')];return '('+[...new Set(terms)].join(' OR ')+') -in:spam -in:trash';}
export function referenceMatches(reference,note){const ref=String(reference).toUpperCase();return String(note||'').toUpperCase().split(/[^A-Z0-9/]+/).some(r=>r.length>=5&&(ref===r||ref.startsWith(r+'/')));}
export function resolveEvidence(e,bookings){
 const matches=bookings.map(b=>matchEvidence(e,b)).filter(Boolean);if(matches.length===1)return matches[0];
 const known=bookings.filter(b=>(b.passengers||[]).some(p=>passengerMatches(e.name,p))&&b.dateDeparture&&e.end>=b.dateDeparture&&e.start<=(b.dateReturn||[...(b.todos||[]).map(t=>t.endDate||''),b.dateDeparture].sort().at(-1)));
 const trip=matches.length===0&&known.length===1?String(known[0].index):'';
 return {...e,trip,todoKey:'',id:hash([e.provider,e.reference,trip,'']),linkReview:matches.length>1?'Meerdere mogelijke reizen; de koppeling is niet eenduidig.':trip?'Reiziger en reisperiode gevonden, maar geen eenduidige todo. Controleer accommodatie en de reisreferentie op de bevestiging.':e.tripHint?'De reisreferentie of reizigersnaam sluit niet eenduidig aan bij Sanity.':''};
}
export function matchEvidence(e,b){if(e.tripHint&&e.tripHint!==String(b.index))return null;const known=(b.passengers||[]).map(p=>normalize(p.lastName)).filter(n=>n.length>=2&&!['nnb','onbekend','unknown','tbd'].includes(n));if(e.tripHint&&known.length&&normalize(e.name)&&!known.some(n=>(' '+normalize(e.name)+' ').includes(' '+n+' ')))return null;const ss=stays(b),exact=ss.filter(t=>referenceMatches(e.reference,t.reference));let candidates=exact;
 if(!candidates.length){if(b.dateDeparture&&b.dateReturn&&(Date.parse(e.end)<Date.parse(b.dateDeparture)-60*86400000||Date.parse(e.start)>Date.parse(b.dateReturn)+60*86400000))return null;const name=normalize(e.name);if(!e.tripHint&&!(b.passengers||[]).some(p=>passengerMatches(name,p)))return null;const productWords=normalize(e.product).split(' ').filter(w=>w.length>3&&!['hotel','premier','international','centraal','intercityhotel','leonardo','mercure','holidayinn','hilton','hampton','western'].includes(w));candidates=ss.filter(t=>e.provider==='NS International'||e.provider==='ÖBB'?t.type==='Nachttrein'&&((e.direction==='outbound'&&t.start===b.dateDeparture)||(e.direction==='inbound'&&t.end===b.dateReturn)||t.start===e.start):e.provider==='Finnlines'?t.provider==='Finnlines':productWords.some(w=>normalize(t.title).includes(w)));}
 if(candidates.length>1){const dated=candidates.filter(t=>t.start===e.start);if(dated.length===1)candidates=dated;}
 if(candidates.length!==1)return null;const t=candidates[0];const words=normalize(e.product).split(' ').filter(w=>w.length>3&&!['hotel','international'].includes(w)),same=words.length>0&&words.every(w=>normalize(t.title).includes(w))||normalize(t.title.split('|')[0]).replace(/roma/g,'rome').split(' ').filter(w=>w.length>3&&!['hotel','teldar','mecure','stc'].includes(w)).filter(w=>normalize(e.product).includes(w)).length>=2||normalize(b.notes).includes(normalize(e.product))&&normalize(e.product).length>10;
 const productMatch=(t.type==='Nachttrein'&&!!e.direction)||(e.provider==='Finnlines'&&/helsinki/i.test(e.product)&&(/helsinki/i.test(t.title)||stays(b).some(x=>x.start===e.end&&/helsinki/i.test(x.title))))||same;
 return {...e,trip:String(b.index),todoKey:t._key,productMatch,roomMismatch:roomCapacity(t.title)!==null&&roomCapacity(e.room)!==null&&roomCapacity(t.title)!==roomCapacity(e.room),id:hash([e.provider,e.reference,String(b.index),t._key])};
}
