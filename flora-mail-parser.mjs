import {dfdsSender,parseDFDS,dfdsCabinMismatch} from './flora-dfds.mjs';
import {nsOption} from './flora-options.mjs';
import {hotelIdentity,nightTrainCodeMatch,trainRoom,trainStations,cityFrom,adjacentNightStay} from './flora-identity.mjs';
import {normalize,hash,validateEvidence,stays} from './flora-engine.mjs';
import {matchTravelerName,referenceBackedNSName} from './flora-names.mjs';
import {directSupplier,replyHead,supplierDocument} from './flora-suppliers.mjs';
const num=(s,re)=>{const m=s.match(re);return m?Number(m[1]):null;};
export function dateValue(s){const iso=String(s).match(/\b20\d{2}-\d{2}-\d{2}\b/);if(iso)return iso[0];const numeric=String(s).match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);if(numeric)return `${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`;const m=String(s).toLowerCase().match(/\b(\d{1,2})\s+(jan\w*|feb\w*|mar\w*|maa\w*|apr\w*|may|mei|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|okt\w*|nov\w*|dec\w*)\.?\s+(20\d{2})/);if(!m)return '';const month={jan:1,feb:2,mar:3,maa:3,apr:4,may:5,mei:5,jun:6,jul:7,aug:8,sep:9,oct:10,okt:10,nov:11,dec:12}[m[2].slice(0,3)];return `${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
const numericDate='\\d{1,2}[./-]\\d{1,2}[./-]20\\d{2}';
function afterDate(s,label){const m=s.match(new RegExp(label+'[^\\d]{0,25}('+numericDate+')','i'));return m?dateValue(m[1]):'';}
export function voucherNames(s,provider){const block=provider==='Teldar'?s.match(/PASS[AE]NGER NAMES:\s*(.*?)(?=\s+Note that|\s+CHECKIN:|\s+HOTEL NAME:|$)/i)?.[1]:s.match(/Gasten:\s*(.*?)(?=\s+Belangrijk|\s+Incheck|$)/i)?.[1];if(!block)return [];const names=block.split(/\s*[,;|]\s*|\s+&\s+/).map(n=>n.trim()).filter(Boolean);return names.length&&names.every(n=>/^[\p{L} .'-]+$/u.test(n)&&n.trim().split(/\s+/).length>=2)?[...new Set(names)]:[];}
export function roomCapacity(s){
 if(/\b(?:PA1AD|PA1AM|RITAD)\b/i.test(s))return 2;
 const explicit=String(s).match(/\bup to (\d+) guests\b/i);if(explicit)return Number(explicit[1]);
 const alternatives=String(s).split(/\s+(?:of|or|oder)\s+/i);if(alternatives.length>1){const values=alternatives.map(roomCapacity);return values.every(v=>v!=null)?Math.min(...values):null;}
 const beds=[...String(s).matchAll(/(\d+)\s*(tweepersoonsbed(?:den)?|eenpersoonsbed(?:den)?|double beds?|single beds?|queen(?: beds?)?|king(?: beds?)?)/gi)];
 if(beds.length)return beds.reduce((n,m)=>n+Number(m[1])*(/eenpersoons|single/i.test(m[2])?1:2),0);
 if(/\b1 twee-$/i.test(s))return 2;
 if(/triple|driepersoons/i.test(s))return 3;if(/double|twin|tweepersoons|doppelzimmer/i.test(s))return 2;if(/single|eenpersoons|einzelzimmer/i.test(s))return 1;return null;
}
export function hotelReplyReview(message){
 const provider=directSupplier(message.from);
 const head=message.docs.filter(d=>d.label==='E-mail').map(d=>d.text).join(' ').replace(/\s+/g,' ').split(/Best regards|Sincerely|Kind regards|\bVon:|\bFrom:|\bDa:|\bOn .{0,100}wrote:|\bOp .{0,100}schreef:/i)[0];
 return provider&&/confirm|reserv|book|cancel|storn|annul|room|date|fully booked/i.test(head)?provider:'';
}
function directHotel(s,message){
 const provider=directSupplier(message.from);
 if(!provider)return null;
 // Only the hotel's own opening reply can confirm; never a quoted older reply or our request.
 const head=replyHead(s);
 if(!/\bwe confirm\b|\b(?:reservation|booking|crossing)\s+[\w(). -]{0,35}\b(?:confirmed|booked|has been made|made as requested)\b|\bnew confirmation:/i.test(head)||/cannot|can't|not confirm|shall we|would|could|\?|cancel|storn|annul/i.test(head))return null;
 const requests=[...s.matchAll(/Arrival date:\s*(.*?)\s*Departure date:\s*(.*?)\s*Customer name:\s*(.*?)\s*Rooms:\s*(.*?)\s*Persons:\s*(.*?)\s*Our reference:\s*(\d{4,6})A/gi)];
 if(!requests.length||new Set(requests.map(m=>JSON.stringify(m.slice(1)))).size!==1)return null;
 const r=requests[0],trip=message.subject.match(/\b(\d{4,6})A\b/i)?.[1];if(trip!==r[6])return null;
 // Amendments need their own explicit dates and room interpretation; do not reuse an older request.
 if(/new confirmation|chang|instead|rather|different|tomorrow|earlier|later|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\b\d{1,2}[./-]\d{1,2}\b/i.test(head))return null;
 const qty=Number(r[4].match(/^(\d+)\s*x/i)?.[1]||0);if(!qty)return null;
 const room=roomCapacity(head)!=null?head:r[4],occupants=[...r[5].matchAll(/\([^)]*\)/g)].length;
 return {provider,reference:head.match(/HCN:\s*(\w+)/i)?.[1]||message.subject.match(/\bF\d{9}\b/)?.[0]||'EMAIL-'+trip+'-'+dateValue(r[1]),start:dateValue(r[1]),end:dateValue(r[2]),name:r[3],occupants:occupants||null,capacity:roomCapacity(room)==null?null:qty*roomCapacity(room),room,product:provider+(provider==='Premier Inn'?' '+cityFrom(message.subject+' '+message.from):''),tripHint:trip};
}
// Supported supplier layouts and explicit hotel replies produce evidence; requests alone never do.
export function parseDocument(doc,message){
 if(nsOption(message))return null;
 if(doc.label==='E-mail'&&/cancel|annul|refund|storn/i.test(message.subject)&&!(/@teldartravel\.com\b/i.test(message.from)&&/days to cancel|without charge/i.test(message.subject))){
  const c=cancellation(message);if(c?.provider!=='Premier Inn')return null;
  const text=doc.text.replace(/\s+/g,' '),germanDate=s=>dateValue(String(s||'').replace(/(\d)\.\s+/g,'$1 ').replace(/Dezember/gi,'December').replace(/Oktober/gi,'October').replace(/März/gi,'March'));
  try{return {...validateEvidence([{...c,source:c.source,status:'cancelled',start:germanDate(text.match(/Check-in\s+(.*?)\s+-/i)?.[1]),end:germanDate(text.match(/Check-out\s+(.*?)\s+-/i)?.[1])}])[0],product:'Premier Inn',messageId:message.id,document:doc.label,observedAt:message.at};}catch{return null;}
 }
 // Join only pages from the same Teldar attachment; train pages remain separate legs.
 const group=doc.label.match(/^(.*?) · pagina \d+$/)?.[1];
 const siblings=group&&/@teldartravel\.com\b/i.test(message.from)?(message.docs||[]).filter(d=>d.label.startsWith(group+' · pagina ')):[];
 if(siblings.length>1&&siblings[0]!==doc)return null;
 const s=(siblings.length>1?siblings.map(d=>d.text).join(' '):doc.text).replace(/\s+/g,' ').trim(),n=normalize(s);let e=null;
 if(doc.label==='E-mail'&&/@balehotels\.ch\b/i.test(message.from)&&/Reservation confirmed.*Hotel Victoria/i.test(message.subject)&&/pleased to confirm the following booking/i.test(s)){
  const englishDate=label=>{const m=s.match(new RegExp(label+'\\s+(?:[A-Za-z]+,\\s*)?([A-Za-z]+)\\s+(\\d{1,2}),\\s*(20\\d{2})','i'));return m?dateValue(`${m[2]} ${m[1]} ${m[3]}`):'';};
  const room=s.match(/ROOM TYPE\s+(.*?)\s+NIGHTLY RATE/i)?.[1]||'';
  e={provider:'Hotel Victoria',reference:s.match(/RESERVATION NUMBER\s+(\d+)/i)?.[1],name:s.match(/GUEST NAME\s+(.*?)\s+RESERVATION NUMBER/i)?.[1]||'',start:englishDate('ARRIVAL DATE'),end:englishDate('DEPARTURE DATE'),room,capacity:roomCapacity(room),product:'Hotel Victoria Basel'};
 }else if(/expediataap\./i.test(message.from)&&/Naar aanleiding van je verzoek hebben we je boeking gewijzigd/i.test(s)&&/Je reservering is geboekt/i.test(s)){
  const d=s.match(/(\d{1,2} \w+\.? 20\d{2})\s*-\s*(\d{1,2} \w+\.? 20\d{2})\s*\|\s*Reisplannummer\s+(\d+)/i),guest=s.match(/Geboekt voor\s+(.+?)\s+(\d+)\s+volwassen(?:e|en)(?:,?\s*(\d+)\s+kind(?:eren)?)?/i),room=s.match(/\bKamer\s+(.*?)\s+Geboekt voor/)?.[1]||'';
  if(!/\b1 kamer\b/i.test(s))return null;
  e={provider:'Expedia',reference:d?.[3],start:dateValue(d?.[1]),end:dateValue(d?.[2]),name:guest?.[1]||'',occupants:guest?Number(guest[2])+Number(guest[3]||0):null,capacity:roomCapacity(room),roomCount:1,room,product:s.match(/Verblijf bij\s+(.*?)\s+(?:Naar aanleiding|\d{1,2} \w+)/i)?.[1]||''};
 }else if(/expediataap\./i.test(message.from)&&/je boeking is bevestigd/i.test(s)&&/Reisplannummer\s+\d+/i.test(s)){
  const d=s.match(/Boekingsdatums\s+(.*?)\s+-\s+(.*?)\s+Reisplannummer/i);
  const blocks=[...s.matchAll(/Geboekt voor\s+(.+?)\s+(\d+)\s+volwassen(?:e|en)(?:,?\s*(\d+)\s+kind(?:eren)?)?\s+Kamer\s+(.*?)(?=Kamervoorkeuren)/gi)];
  const capacities=blocks.map(m=>roomCapacity(m[4]));
  e={provider:'Expedia',reference:s.match(/Reisplannummer\s+(\d+)/i)[1],start:dateValue(d?.[1]),end:dateValue(d?.[2]),name:blocks[0]?.[1]||'',occupants:blocks.length?blocks.reduce((n,m)=>n+Number(m[2])+Number(m[3]||0),0):null,capacity:capacities.length&&capacities.every(n=>n!=null)?capacities.reduce((a,b)=>a+b,0):null,roomCount:blocks.length||null,product:s.match(/Hoteloverzicht\s+(.+?)\s+\d/i)?.[1]||s.match(/Itinerary:\s*(.*?)\s+Bedankt/i)?.[1]||'',room:blocks.map(m=>m[4].split(/Inbegrepen voorzieningen/i)[0].trim()).join('; ')};
 }else if(doc.label!=='E-mail'&&/Booking confirmed/i.test(s)&&/Premier Inn/i.test(s)){
  e={provider:'Premier Inn',reference:s.match(/Booking reference\s+(\d+)/i)?.[1],start:dateValue(s.match(/Check-in:(.*?)Check-out:/i)?.[1]),end:dateValue(s.match(/Check-out:(.*?)Your booking/i)?.[1]),name:s.match(/Hello\s+(.*?)\s+Thank you/i)?.[1]||'',occupants:num(s,/(\d+)\s+adult/i),capacity:roomCapacity(s.match(/Booked room details(.*?)This is/i)?.[1]||''),product:s.match(/Premier Inn\s+(.+?)\s+(?:Hello|[A-Z][a-z]+\s+[A-Z][a-z]+|\d+ adult)/)?.[0]||'Premier Inn',room:s.match(/Booked room details(.*?)This is/i)?.[1]||''};
 }else if(doc.label!=='E-mail'&&/FINNLINES/i.test(s)&&/Booking Confirmation/i.test(s)){
  const route=s.match(/(TRAVEM[ÜU]NDE[-–]HELSINKI|HELSINKI[-–]TRAVEM[ÜU]NDE)\s+(\d{2}\/\d{2}\/20\d{2})\s+\d{2}:\d{2}\s+(\d{2}\/\d{2}\/20\d{2})/i),c=s.match(/(?:Outside|Inside) cabin,\s*(\d+) beds\s+(\d+)/i);
  e={provider:'Finnlines',reference:s.match(/\bF\d{9}\b/)?.[0],start:dateValue(route?.[2]),end:dateValue(route?.[3]),name:s.match(/Booking Holder:\s*(.*?)\s+Issuing Date/i)?.[1]||'',occupants:num(s,/Passenger\s+A\s+Adult\s+(\d+)/i),capacity:c?Number(c[1])*Number(c[2]):null,product:route?.[1]||'',room:c?.[0]||''};
 }else if(doc.label!=='E-mail'&&/VERVOERBEWIJS\s*\+\s*RESERVERING/i.test(s)&&/NIGHTJET/i.test(s)){
  const dnr=s.match(/DNR:\s*([A-Z0-9]+)\s+ID:\s*(\d+)/),route=s.match(/(\d{2}\.\d{2})\s+(\d{2}:\d{2})\s+(.+?)\s*->\s*(.+?)(\d{2}\.\d{2})\s+(\d{2}:\d{2})/),anchor=message.subject.match(/vertrekdatum:\s*(\d{2})\/(\d{2})\/(20\d{2})/i),year=anchor&&route?String(Number(anchor[3])+(Number(anchor[2])===12&&Number(route[1].slice(3))===1?1:0)):doc.year||s.match(/\b20\d{2}\b/)?.[0],name=s.match(/NIGHTJET\s+([^\d]+?)\s*\d+\s+VOLWASSENE(?:N)?\b/i),places=s.match(/(?:LIGPLAATS|BEDPLAATS)\s+([\d\s-]+?)(?=NIET|AFD|DO\b|\d+ RIT)/i);let capacity=null;if(places){const p=places[1].trim();const range=p.match(/^(\d+)\s*-\s*(\d+)$/);capacity=range?Number(range[2])-Number(range[1])+1:p.split(/\s+/).filter(Boolean).length;}
  const origin=route?.[3]||'',dest=route?.[4]||'',nl=/UTRECHT|AMSTERDAM|ARNHEM|DEVENTER|AMERSFOORT|ROTTERDAM/i;
  e={provider:'NS International',reference:dnr?dnr[1]+'/'+dnr[2]:null,start:year&&route?dateValue(route[1]+'.'+year):'',end:year&&route?dateValue(route[5]+'.'+year):'',name:name?.[1]?.replace(/^([^,]+),\s*(.+)$/,'$2 $1')||'',occupants:num(s,/(\d+)\s+VOLWASSENE(?:N)?\b/i),capacity,product:trainStations(origin+' → '+dest),direction:nl.test(origin)?'outbound':nl.test(dest)?'inbound':'',originCountry:nl.test(origin)?'NL':'',room:/MINI ?CABIN/i.test(s)?'Mini Cabin':/VIER LIGPL/i.test(s)?'Couchette 4':/BEDPLAATS/i.test(s)?'Private compartment':'',guestText:s.match(/PASSAGIERS?\s*:?\s*(.*?)(?=VOORWAARDEN|$)/i)?.[1]||''};
 }else if(doc.label!=='E-mail'&&/RESERVIERUNG/i.test(s)&&/Nightjet/i.test(s)&&/zur Buchung/i.test(s)){
  const ref=s.match(/zur Buchung\s+(\d[\d ]{12,22})/i),name=s.match(/für\s+(.*?)\s*,\s*\.?\s*\d+ Plätze/i),route=s.match(/Von\s+([A-ZÄÖÜ ]+)\s*\.\s*\.\s*Von Bahnsteig.*?Nach\s+([A-ZÄÖÜ ]+)/);
  const flat=s.replace(/\*/g,' ').replace(/\s+/g,' '),table=flat.match(/(\d{2}\.\d{2})\s+\d{2}:\d{2}\s+(.+?)\s*->\s*->\s*(.+?)\s+(\d{2}\.\d{2})\s+\d{2}:\d{2}/),year=s.match(/Gültig:\s*(20\d{2})/)?.[1];const origin=route?.[1]?.trim()||table?.[2]?.trim()||'',dest=route?.[2]?.trim()||table?.[3]?.trim()||'',nl=/UTRECHT|AMSTERDAM|ARNHEM/i,places=num(s,/(\d+)\s+PLÄTZE/i);
  e={provider:'ÖBB',reference:ref?.[1].replace(/\s/g,''),start:afterDate(s,'Abfahrt am')||(table&&year?dateValue(table[1]+'.'+year):''),end:afterDate(s,'Ankunft am')||(table&&year?dateValue(table[4]+'.'+year):''),name:name?.[1]||s.match(/inkl\. Frühstück\s+(.*?)\s+\d+ PLÄTZE/i)?.[1]||'',capacity:places,occupants:places,product:origin+' → '+dest,direction:nl.test(origin)?'outbound':nl.test(dest)?'inbound':'',originCountry:nl.test(origin)?'NL':'',room:/Mini Cabin/i.test(s)?'Mini Cabin':''};
 }else if(doc.label!=='E-mail'&&/Deze accommodatie is geboekt door onze partner/i.test(s)&&/Reservering\s+\d+/i.test(s)){
  e={provider:'RateHawk',reference:s.match(/Reservering\s+(\d+)/i)?.[1],start:afterDate(s,'Inchecken'),end:afterDate(s,'Uitchecken:'),name:s.match(/Gasten:\s*(.*?)(?:,|Belangrijk)/i)?.[1]||'',occupants:num(s,/voor\s+(\d+)\s+volwassenen/i),capacity:roomCapacity(s.match(/Klassiek(.*?)Gasten:/i)?.[0]||''),product:s.match(/door onze partner\s+(.*?)\s+\d{4,}/i)?.[1]||'',room:s.match(/Klassiek(.*?)Gasten:/i)?.[0]||''};
 }else if(doc.label!=='E-mail'&&/Voucher\s*\/\s*Confirmation/i.test(s)&&/Switzerland Travel Centre/i.test(s)){
  e={provider:'STC',reference:s.match(/Booking\s+(TRR\d+)/i)?.[1],start:afterDate(s,'Check in day'),end:afterDate(s,'Check out day'),name:s.match(/Booking name\s+(?:Ms\.|Mr\.)?\s*(.*?),/i)?.[1]||'',occupants:num(s,/Occupancy\s+(\d+)\s+adults/i),capacity:roomCapacity(s.match(/Room description\s+(.*?)Room type/i)?.[1]||''),product:s.match(/Hotel\/Service\s+(.*?)\s+(?:Bleicheplatz|Via|[A-Z][a-z]+strasse)/i)?.[1]||'',room:s.match(/Room description\s+(.*?)Room type/i)?.[1]||''};
 }else e=parseDFDS(doc,message,dateValue)||supplierDocument(s,message,doc,{dateValue,roomCapacity})||(doc.label==='E-mail'?directHotel(s,message):null);
 if(e?.reference?.startsWith('EMAIL-')&&(message.docs||[]).some(d=>d!==doc&&supplierDocument(d.text.replace(/\s+/g,' '),message,d,{dateValue,roomCapacity})?.provider===e.provider))return null;
 if(e?.partialEvidence&&e.reference&&e.start)return {...e,id:hash([e.provider,e.reference]),source:message.url,status:'confirmed',messageId:message.id,document:doc.label,observedAt:message.at,tripHint:'',sourceText:s.slice(0,7000)};
 if(e?.provider==='NS International'&&e.start&&e.end&&e.end<e.start&&e.start.slice(5,7)==='12'&&e.end.slice(5,7)==='01')e.end=String(Number(e.start.slice(0,4))+1)+e.end.slice(4);
 if(!e?.reference||!e.start||!e.end)return null;
 try{return {...validateEvidence([{...e,source:message.url,status:'confirmed'}])[0],product:e.product,room:e.room,alternateReferences:e.alternateReferences||[],guestText:e.guestText||'',guestNames:['Teldar','RateHawk'].includes(e.provider)?voucherNames(s,e.provider):[],roomCount:e.roomCount||null,messageId:message.id,document:doc.label,observedAt:message.at,ticketLink:doc.link||'',tripHint:message.subject.match(/\b(\d{4,6})A\b/i)?.[1]||s.match(/(?:\bRef:|Our reference:)\s*(\d{4,6})A\b/i)?.[1]||'',sourceText:s.slice(0,7000)};}catch{return null;}
}
export function cancellation(message){
 const text=message.docs.filter(d=>d.label==='E-mail').map(d=>d.text).join(' ');let provider='',reference='';
 if(/@teldartravel\.com\b/i.test(message.from)&&/HOTEL BOOKING CANCELLATION/i.test(message.subject)&&/Booking\s+[A-Z0-9/]+\s+for\s+Hotel\b.*?\bwas cancel(?:led|ed)\b/is.test(text)){
  const reference=text.match(/Booking\s+([A-Z0-9/]+)/i)?.[1];
  if(reference)return {provider:'Teldar',reference,at:message.at,source:message.url,start:dateValue(text.match(/Checkin:\s*(\S+)/i)?.[1]),end:dateValue(text.match(/Checkout:\s*(\S+)/i)?.[1]),name:message.subject.match(/CANCELLATION:\s*[A-Z0-9/]+\s*-\s*(.*)/i)?.[1]||''};
 }
 if(dfdsSender(message.from)&&/Je boeking is geannuleerd/i.test(message.subject)&&/De boeking van jouw klant is geannuleerd/i.test(text)){provider='DFDS';reference=text.match(/Boekingsnummer:\s*(\d{6,10})/i)?.[1];}
 if(/@oebb\.at\b/i.test(message.from)&&/refund/i.test(message.subject)&&/refund.*processed successfully/i.test(text)&&/refunded tickets become invalid/i.test(text)){provider='ÖBB';reference=text.match(/Booking code:\s*([\d ]{16,25})/i)?.[1]?.replace(/\s/g,'');}
 if(/@expediataap\.nl\b/i.test(message.from)&&/Annuleringsbevestiging/i.test(message.subject)&&/Je hebt geannuleerd|Je hotelkamer is geannuleerd/i.test(text)){provider='Expedia';reference=text.match(/TAAP-reisplannummer:\s*(\d+)/i)?.[1];}
 if(/@(?:[\w-]+\.)*premierinn\.com\b/i.test(message.from)&&/Stornierung|Cancellation/i.test(message.subject)&&/Buchung storniert|booking (?:has been |is )?cancelled/i.test(text)){provider='Premier Inn';reference=text.match(/(?:Buchungsnummer|Booking reference)\s*:?\s*([A-Z0-9]+)/i)?.[1];}
 return reference?{provider,reference,at:message.at,source:message.url}:null;
}
export function cancellationApplies(c,e){
 if(c.provider!==e.provider)return false;
 if(c.reference===e.reference)return true;
 if(c.provider==='DFDS'&&e.reference.split('/')[0]===c.reference)return true;
 // A room /1 cancellation also identifies a single-room voucher with its base reference.
 // Never cancel other room suffixes or an aggregate voucher from that room notice.
 return c.provider==='Teldar'&&c.reference===e.reference+'/1'&&Number(e.roomCount)===1&&!!c.start&&c.start===e.start&&c.end===e.end&&!!normalize(c.name)&&normalize(c.name)===normalize(e.name);
}
export function passengerMatches(name,p){const match=matchTravelerName(name,[p]);return match==='exact'||match==='partial'&&normalize(name).split(' ').includes(normalize(p.firstName).split(' ')[0]);}
// A supplier's explicit amendment in the same conversation can replace a booking
// number. Require one old and one new room for the same guest, hotel and arrival.
export function amendedHotelEvidence(events,messages){
 const replacements=new Map(),single=e=>e.roomCount===1||e.roomCount==null&&e.capacity===2&&e.occupants===2;
 for(const m of messages){
  if(directSupplier(m.from)!=='Premier Inn'||!m.threadId||m.issues?.length)continue;
  const head=replyHead((m.docs||[]).filter(d=>d.label==='E-mail').map(d=>d.text).join(' '));
  if(!/we have (?:updated|amended) the reservation as requested/i.test(head))continue;
  const fresh=events.filter(e=>e.messageId===m.id&&e.provider==='Premier Inn'&&e.status==='confirmed'&&single(e));
  if(fresh.length!==1)continue;const next=fresh[0];
  const prior=events.filter(e=>e.provider===next.provider&&e.reference!==next.reference&&e.status==='confirmed'&&e.observedAt<m.at&&single(e)&&e.start===next.start&&normalize(e.name)===normalize(next.name)&&normalize(e.product)===normalize(next.product)&&messages.some(source=>source.id===e.messageId&&source.threadId===m.threadId));
  if(new Set(prior.map(e=>e.reference)).size===1)for(const e of prior)replacements.set(e.provider+'|'+e.reference,next.reference);
 }
 return events.map(e=>replacements.has(e.provider+'|'+e.reference)?{...e,status:'superseded',supersededBy:replacements.get(e.provider+'|'+e.reference)}:e);
}
// Premier Inn cancellation receipts use a NEW cancellation number, not the booking reference.
// Only associate them when guest, stay dates and hotel identify exactly one earlier booking.
export function receiptCancellations(messages,evidence){const result=[];for(const m of messages){if(!/@(?:[\w-]+\.)*(?:whitbread|premierinn)\.com\b/i.test(m.from))continue;for(const d of m.docs||[]){const s=d.text.replace(/\s+/g,' ');if(!/Booking cancelled.*Cancellation reference/i.test(s))continue;const name=s.match(/Hello\s+(.*?)\s+We're/i)?.[1],dates=s.match(/\((\d{2}\.\d{2}\.20\d{2})\s*[–-]\s*(\d{2}\.\d{2}\.20\d{2})\)/),hotel=s.match(/(Premier Inn.*?)\s+Cancelled room details/i)?.[1];if(!name||!dates||!hotel)continue;const matched=evidence.filter(e=>e.provider==='Premier Inn'&&e.observedAt<=m.at&&normalize(e.name)===normalize(name)&&e.start===dateValue(dates[1])&&e.end===dateValue(dates[2])&&normalize(e.product).includes(normalize(hotel)));const refs=[...new Set(matched.map(e=>e.reference))];if(refs.length===1)result.push({provider:'Premier Inn',reference:refs[0],at:m.at,source:m.url});}}return result;}
export function latestNSTickets(events,messages){const latest=new Map();for(const m of messages){if(nsOption(m)||!/@confirmation\.nsinternational\.nl\b/i.test(m.from)||m.issues?.length||!m.hasLinks)continue;const ref=m.subject.match(/boekingscode:\s*([A-Z0-9]+)/i)?.[1];if(ref&&(!latest.has(ref)||latest.get(ref).at<m.at))latest.set(ref,m);}return events.map(e=>{const m=e.provider==='NS International'&&latest.get(e.reference.split('/')[0]);return m&&e.ticketLink&&e.observedAt<=m.at&&!m.docs.some(d=>d.link===e.ticketLink)?{...e,status:'cancelled',source:m.url,observedAt:m.at}:e;});}
const quoted=s=>'"'+String(s).replace(/["\\{}\r\n]/g,' ').trim()+'"';
export function supplierReferences(value){
 const text=String(value||'').replace(/\b(\d{4}) (\d{4}) (\d{4}) (\d{4})\b/g,'$1$2$3$4');
 return [...new Set((text.match(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g)||[]).filter(r=>r.length>=5&&r.length<=40&&(/\d/.test(r)||/^[A-Z]{6,7}$/.test(r))))];
}
export function bookingQuery(b){const ss=stays(b),dfdsRefs=ss.some(t=>t.provider==='DFDS')?String(b.notes||'').split(/\n/).filter(line=>/DFDS/i.test(line)).flatMap(line=>line.match(/\b\d{8}\b/g)||[]).map(quoted):[],terms=[...dfdsRefs,quoted(String(b.index)+'A'),...ss.flatMap(t=>supplierReferences(t.reference)).map(quoted),...(b.passengers||[]).filter(p=>passengerMatches(p.firstName+' '+p.lastName,p)).map(p=>'('+quoted(p.firstName.trim().split(/\s+/)[0])+' '+quoted(p.lastName)+')')];return '('+[...new Set(terms)].join(' OR ')+') -in:spam -in:trash';}
export function referenceMatches(reference,note){const ref=String(reference).toUpperCase();return String(note||'').toUpperCase().split(/[^A-Z0-9/]+/).some(r=>r.length>=5&&(ref===r||ref.startsWith(r+'/')||!ref.includes('/')&&r.startsWith(ref+'/')));}
export function resolveEvidence(e,bookings){
 const matches=bookings.map(b=>matchEvidence(e,b)).filter(Boolean);if(matches.length===1)return matches[0];
 const known=bookings.filter(b=>(b.passengers||[]).some(p=>passengerMatches(e.name,p))&&b.dateDeparture&&e.end>=b.dateDeparture&&e.start<=(b.dateReturn||[...(b.todos||[]).map(t=>t.endDate||''),b.dateDeparture].sort().at(-1)));
 const trip=matches.length===0&&known.length===1?String(known[0].index):'';
 return {...e,trip,todoKey:'',id:hash([e.provider,e.reference,trip,'']),linkReview:matches.length>1?'Meerdere mogelijke reizen; de koppeling is niet eenduidig.':trip?'Reiziger en reisperiode gevonden, maar geen eenduidige todo. Controleer accommodatie en de reisreferentie op de bevestiging.':e.tripHint?'De reisreferentie of reizigersnaam sluit niet eenduidig aan bij Sanity.':''};
}
export function matchEvidence(e,b){const wrongHint=e.tripHint&&e.tripHint!==String(b.index),nameMatch=e.provider==='NS International'&&referenceBackedNSName(e.name,b.passengers,e.reference,b.notes)||(b.passengers||[]).some(p=>passengerMatches(e.name,p)||e.provider==='NS International'&&matchTravelerName(e.name,[p],{truncated:true})==='exact');if(wrongHint&&!nameMatch)return null;const known=(b.passengers||[]).map(p=>normalize(p.lastName)).filter(n=>n.length>=2&&!['nnb','onbekend','unknown','tbd'].includes(n));if(e.tripHint&&!wrongHint&&known.length&&normalize(e.name)&&!nameMatch&&!known.some(n=>(' '+normalize(e.name)+' ').includes(' '+n+' ')))return null;const ss=stays(b),exact=ss.filter(t=>[e.reference,...(e.alternateReferences||[])].some(r=>referenceMatches(r,t.reference)));let candidates=exact;
 if(e.provider==='DFDS'){
  const refMatch=referenceMatches(e.reference,b.notes)||exact.length>0;
  if(!refMatch&&!nameMatch&&!e.tripHint)return null;
  const ferry=ss.filter(t=>t.provider==='DFDS'&&/newcastle|ijmuiden/i.test(t.title));
  const dated=ferry.filter(t=>t.start===e.start&&t.end===e.end);
  const route=ferry.filter(t=>normalize(t.title).includes(normalize(e.product)));
  candidates=dated.length?dated:route.length?route:ferry;
 }
 // Direction alone never identifies a traveler: an unrelated outbound confirmation
 // must not attach to every booking with an outbound night train.
 if(['NS International','ÖBB'].includes(e.provider)&&!exact.length&&!nameMatch&&!e.tripHint)return null;
 // A dossier reference can cover both directions: route and dates select the leg.
 if(['NS International','ÖBB'].includes(e.provider)&&e.direction){const train=ss.filter(t=>t.type==='Nachttrein'),dated=train.filter(t=>t.start===e.start);const directional=train.filter(t=>e.direction==='outbound'?t.start===b.dateDeparture:t.end===b.dateReturn);if(directional.length===1)candidates=directional;else if(dated.length===1)candidates=dated;}
 if(!candidates.length){if(b.dateDeparture&&b.dateReturn&&(Date.parse(e.end)<Date.parse(b.dateDeparture)-60*86400000||Date.parse(e.start)>Date.parse(b.dateReturn)+60*86400000))return null;const name=normalize(e.name);if(!e.tripHint&&!nameMatch)return null;const productWords=normalize(e.product).split(' ').filter(w=>w.length>3&&!['hotel','premier','international','centraal','intercityhotel','leonardo','mercure','holidayinn','hilton','hampton','western'].includes(w));candidates=ss.filter(t=>e.provider==='NS International'||e.provider==='ÖBB'?t.type==='Nachttrein'&&((e.direction==='outbound'&&t.start===b.dateDeparture)||(e.direction==='inbound'&&t.end===b.dateReturn)||t.start===e.start):e.provider==='Finnlines'?t.provider==='Finnlines':productWords.some(w=>normalize(t.title).includes(w))||(t.type==='Hotel'&&t.start===e.start&&t.end===e.end&&hotelIdentity(t,e,b)));}
 if(candidates.length>1){const dated=candidates.filter(t=>t.start===e.start);if(dated.length===1)candidates=dated;}
 if(candidates.length>1&&['NS International','ÖBB'].includes(e.provider)&&trainRoom(e.room)){const rooms=candidates.filter(t=>trainRoom(t.title)===trainRoom(e.room));if(rooms.length===1)candidates=rooms;}
 if(candidates.length>1&&candidates.every(t=>t.type==='Hotel'&&t.start===candidates[0].start&&t.end===candidates[0].end&&normalize(t.title.split('|')[0])===normalize(candidates[0].title.split('|')[0])))candidates=[candidates[0]];
 if(candidates.length!==1)return null;const t=candidates[0];if(wrongHint&&(t.start!==e.start||t.end!==e.end))return null;const words=normalize(e.product).split(' ').filter(w=>w.length>3&&!['hotel','international'].includes(w)),same=words.length>0&&words.every(w=>normalize(t.title).includes(w))||normalize(t.title.split('|')[0]).replace(/roma/g,'rome').split(' ').filter(w=>w.length>3&&!['hotel','teldar','mecure','stc'].includes(w)).filter(w=>normalize(e.product).includes(w)).length>=2||normalize(b.notes).includes(normalize(e.product))&&normalize(e.product).length>10;
 const supplierIdentity=e.provider==='Hotel ABC Chur'&&/hotelabc|abc.*chur/i.test(t.title)||e.provider==='Hotel Post Chur'&&/post\s*chur/i.test(t.title)||e.provider==='Best Western Montpellier'&&/western.*(?:montpellier|saint.?roch)|comedie.*roch/i.test(t.title);
 const productMatch=e.provider==='DFDS'?(t.provider==='DFDS'&&(normalize(t.title).includes(normalize(e.product))||/naar\s*(?:->|→)?\s*(Newcastle|IJmuiden)/i.test(t.title)&&normalize(t.title.match(/naar\s*(?:->|→)?\s*(Newcastle|IJmuiden)/i)[1])===(e.direction==='outbound'?'newcastle':'ijmuiden'))):(t.type==='Hotel'?hotelIdentity(t,e,b):false)||supplierIdentity||(t.type==='Nachttrein'&&!!e.direction&&(nightTrainCodeMatch(t,e)||!!cityFrom(t.title)||adjacentNightStay(e,b)||!!t.reference))||(e.provider==='Finnlines'&&/helsinki/i.test(e.product)&&(/helsinki/i.test(t.title)||stays(b).some(x=>x.start===e.end&&/helsinki/i.test(x.title))))||(t.type!=='Hotel'&&same&&!(cityFrom(t.title)&&cityFrom(e.product)&&cityFrom(t.title)!==cityFrom(e.product)));
 if(wrongHint&&!productMatch)return null;
 const guests=e.guestText?(b.passengers||[]).filter(p=>p.firstName&&p.lastName&&(' '+normalize(e.guestText)+' ').includes(' '+normalize(p.firstName+' '+p.lastName)+' ')).map(p=>p.firstName+' '+p.lastName):e.guestNames||[],verified=['Teldar','RateHawk'].includes(e.provider)&&guests.length>0&&guests.every(n=>(b.passengers||[]).some(p=>passengerMatches(n,p)));
 return {...e,...(verified?{capacity:Math.max(e.capacity||0,guests.length),occupants:Math.max(e.occupants||0,guests.length),voucherGuestsVerified:true,guestNames:guests}:{}),trip:String(b.index),todoKey:t._key,productMatch,tripReferenceMismatch:wrongHint?e.tripHint:'',roomMismatch:e.provider==='DFDS'?dfdsCabinMismatch(t.title,e.room):t.type==='Nachttrein'&&trainRoom(t.title)&&trainRoom(e.room)?trainRoom(t.title)!==trainRoom(e.room)&&!(trainRoom(t.title)==='couchette4'&&trainRoom(e.room)==='mini'&&e.capacity>=(b.passengers||[]).length&&!/priv/i.test(t.title)):roomCapacity(t.title)!==null&&roomCapacity(e.room)!==null&&roomCapacity(e.room)<roomCapacity(t.title),id:hash([e.provider,e.reference,String(b.index),t._key])};
}

export function conversationCancellations(messages,evidence){
 const result=[];for(const m of messages){const provider=directSupplier(m.from);if(!provider)continue;const head=replyHead((m.docs||[]).filter(d=>d.label==='E-mail').map(d=>d.text).join(' '));
 if(/not cancelled|not canceled|niet geannuleerd|nicht storniert|cannot cancel|please cancel|kunt u.*annul|could you.*cancel/i.test(head))continue;
 const explicit=/\b(?:we have cancelled|we have canceled|booking (?:has been |is )cancelled|reservation (?:has been |is )cancelled|cancellation (?:has been )?(?:confirmed|processed|accepted)|annulering (?:is )?(?:verwerkt|bevestigd|akkoord)|reservering (?:is )?geannuleerd|stornierung (?:ist )?(?:bestatigt|bestätigt|bearbeitet)|reservierung (?:wurde |ist )?storniert)\b/i.test(head);if(!explicit)continue;
 const matches=evidence.filter(e=>e.provider===provider&&e.observedAt<=m.at&&(head.includes(e.reference)||m.threadId&&messages.some(source=>source.id===e.messageId&&source.threadId===m.threadId)));
 const refs=[...new Set(matches.map(e=>e.reference))];if(refs.length===1)result.push({provider,reference:refs[0],at:m.at,source:m.url});
 }return result;
}
