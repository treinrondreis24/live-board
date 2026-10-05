// Supplier-specific evidence, using only explicit source fields.
export function directSupplier(from){
 const domain=String(from).match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase();
 if(/^(?:[\w-]+\.)*(?:premierinn|whitbread)\.com$/.test(domain||''))return 'Premier Inn';
 return ({'bernerhof-interlaken.ch':'Hotel Bernerhof','hotel-federale.ch':'Hotel Federale','hotelabc.ch':'Hotel ABC Chur','postchur.ch':'Hotel Post Chur','hotelpostchur.ch':'Hotel Post Chur','lhotel-montpellier.com':'Best Western Montpellier','finnlines.com':'Finnlines'})[domain]||'';
}
export const replyHead=s=>s.split(/Best regards|Sincerely|Kind regards|Herzliche Grüße|POSTal regards|\bVon:|\bFrom:|\bDa:|\bDe\s*:|\bOn .{0,100}wrote:|\bOp .{0,100}schreef:/i)[0];
export function supplierDocument(s,message,doc,{dateValue,roomCapacity}){

 if(/@(?:[\w-]+\.)*(?:premierinn|whitbread)\.com\b/i.test(message.from)){
  const ordinalDate=value=>dateValue(String(value||'').replace(/(\d)(?:st|nd|rd|th)\b/gi,'$1'));
  const product=s.match(/Premier Inn\s+Wien\s+City\s+Hauptbahnhof/i)?.[0]||'';
  if(doc.label!=='E-mail'&&product&&/We are pleased to confirm your reservation as follows:/i.test(s)){
   const room=s.match(/Room:\s*(\d+)\s+(.+?)\s+Persons per Room:\s*(\d+)\s+Adults/i),start=ordinalDate(s.match(/Arrival:\s*(.*?)\s+Departure:/i)?.[1]),end=ordinalDate(s.match(/Departure:\s*(.*?)\s+Guest name:/i)?.[1]);
   if(!room||Number(room[1])!==1||!start||!end)return null;
   return {provider:'Premier Inn',reference:s.match(/CONFIRMATION:\s*([A-Z0-9]+)/i)?.[1],start,end,name:s.match(/Guest name:\s*(.*?)\s+Room:/i)?.[1]||'',room:room[2],roomCount:1,occupants:Number(room[3]),capacity:roomCapacity(room[2]),product};
  }
  const head=replyHead(s);
  if(doc.label==='E-mail'&&product&&/\b(?:we (?:would like to (?:kindly )?)?confirm the reservation for)\b/i.test(head)&&! /cannot|can't|not confirm|cancel|annul|storn|\?/i.test(head)){
   const dates=head.match(/Stay:\s*(\d{1,2}\.\d{1,2}\.20\d{2})\s*[–-]\s*(\d{1,2}\.\d{1,2}\.20\d{2})/i),room=head.match(/\b(\d+)\s*x\s*(Twin|Double|Single)\s+Room/i),reference=head.match(/Hotel Confirmation Number:\s*([A-Z0-9]+)/i)?.[1],name=head.match(/confirm the reservation for\s+(?:(?:Mrs|Mr|Ms)\.?\s+)?([^:]+):/i)?.[1];
   if(!dates||!room||Number(room[1])!==1||!reference||!name)return null;
   return {provider:'Premier Inn',reference,start:dateValue(dates[1]),end:dateValue(dates[2]),name,room:room[2],roomCount:1,capacity:roomCapacity(room[2]),occupants:null,product};
  }
 }
 if(doc.label!=='E-mail'&&/@teldartravel\.com\b/i.test(message.from)&&/YOUR VOUCHER/.test(s)&&/confirmed by Teldar Travel/i.test(s)){
 const row=s.match(/Pax names Adult\(s\) Children Type of room\(s\)\s+(.*?)\s+(\d+)\s+(\d+)\s+(.*?)\s+FOR HOTEL USE ONLY/i);if(!row)return null;
 return {provider:'Teldar',reference:s.match(/Reference\s+([A-Z0-9]+)/i)?.[1],alternateReferences:[s.match(/Supplier Booking Number\s*:?\s*([A-Z0-9]+)/i)?.[1]].filter(Boolean),start:dateValue(s.match(/Arrival\s+(\S+)/i)?.[1]),end:dateValue(s.match(/Departure\s+(\S+)/i)?.[1]),name:row[1].split(/[,;|]/)[0],guestText:row[1],occupants:Number(row[2])+Number(row[3]),capacity:roomCapacity(row[4]),room:row[4],product:s.match(/paid directly at hotel check-out\s+(.*?)\s+Phone number:/i)?.[1]||'',roomCount:1};
 }

 const provider=directSupplier(message.from),isMail=doc.label==='E-mail';
 if(isMail&&/@(?:[\w-]+\.)*(?:premierinn|whitbread)\.com\b/i.test(message.from)&&/your booking is confirmed/i.test(message.subject)){
  const dates=s.match(/(\d{1,2} \w+ 20\d{2})\s+Check-in from.*?(\d{1,2} \w+ 20\d{2})\s+Check\s*out by/i),block=s.split(/Booking summary/i)[1]||'',count=Number(s.match(/You have booked\s+(\d+) rooms?/i)?.[1]);
  const rows=[...block.matchAll(/([\p{L}][\p{L} .'-]+?)\s+(\d+) adults?\s+in a\s+(.+?)(?=\s+(?:&pound;|£|\d+[.,]\d{2}))/giu)];
  if(!dates||!count||rows.length!==count)return null;
  const capacities=rows.map(r=>roomCapacity(r[3]));
  return {provider:'Premier Inn',reference:s.match(/Booking reference:\s*([A-Z0-9]+)/i)?.[1],start:dateValue(dates[1]),end:dateValue(dates[2]),name:rows[0][1].trim(),guestText:rows.map(r=>r[1].trim()).join('; '),occupants:rows.reduce((n,r)=>n+Number(r[2]),0),capacity:capacities.every(n=>n!=null)?capacities.reduce((a,b)=>a+b,0):null,room:rows.map(r=>r[3]).join('; '),product:'Premier Inn '+(s.match(/Your stay with us\s+(.+?)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d)/i)?.[1]||''),roomCount:count};
 }
 if(provider==='Hotel Post Chur'&&!isMail&&/BUCHUNGSBESTÄTIGUNG/.test(s)){
  const rows=[...s.matchAll(/Gastname:\s*(.*?)\s*Anreise:\s*(\S+)\s*Abreise:\s*(\S+)\s*Zimmerkategorie:\s*(.*?)\s*Personen:\s*(\d+)/gi)];
  if(!rows.length||new Set(rows.map(r=>r[2]+'|'+r[3])).size!==1)return null;
  const capacities=rows.map(r=>/s\.use|single/i.test(r[4])?1:/doppel/i.test(r[4])?2:roomCapacity(r[4]));
  return {provider,reference:s.match(/Reservierungsnummer:\s*(\d+)/i)?.[1],name:rows[0][1].replace(/^([^,]+),\s*(.+)$/,'$2 $1'),start:dateValue(rows[0][2]),end:dateValue(rows[0][3]),capacity:capacities.every(c=>c!=null)?capacities.reduce((a,b)=>a+b,0):null,occupants:rows.reduce((n,r)=>n+Number(r[5]),0),room:rows.map(r=>r[4]).join('; '),product:provider,roomCount:rows.length};
 }
 if(isMail&&/@teldartravel\.com\b/i.test(message.from)&&/days to cancel|without charge/i.test(message.subject)&&/HOTEL NAME:/i.test(s)){
  return {provider:'Teldar',reference:s.match(/reservation\s+([A-Z0-9]+\/\d+)/i)?.[1],name:s.match(/PASS[AE]NGER NAMES:\s*(.*?)(?:,|\s+Note that)/i)?.[1]||'',start:dateValue(s.match(/CHECKIN:\s*(\S+)/i)?.[1]),end:dateValue(s.match(/CHECKOUT:\s*(\S+)/i)?.[1]),product:s.match(/HOTEL NAME:\s*(.*?)\s*CITY:/i)?.[1]||'',room:'',capacity:null,occupants:null};
 }
 if(provider==='Finnlines'&&isMail){
  const head=replyHead(s.replace(/^[-\s]+/,'')),request=s.replace(/\*/g,''),rows=[...request.matchAll(/Departure date:\s*(.*?)\s*Arrival date:\s*(.*?)\s*Customer name:\s*(.*?)\s*Rooms:\s*(.*?)\s*Persons:\s*(.*?)\s*Our reference:\s*(\d{4,6})A/gi)];
  if(/(?:crossing|booking|reservation) has been (?:booked|confirmed)|we confirm/i.test(head)&&!/(?:not|cannot|can't|could|would)\s|\?/i.test(head)&&rows.length===1){
   const r=rows[0],route=request.match(/(?:from\s+)?(Trav(?:el|e)m[üu]nde)\s+(?:to|-|–)\s+(Helsinki)/i)||request.match(/(?:from\s+)?(Helsinki)\s+(?:to|-|–)\s+(Trav(?:el|e)m[üu]nde)/i);
   if(!route)return null;
   return {provider,reference:message.subject.match(/\bF\d{9}\b/)?.[0]||'EMAIL-'+r[6]+'-'+dateValue(r[1]),start:dateValue(r[1]),end:dateValue(r[2]),name:r[3],occupants:[...r[5].matchAll(/\([^)]*\)/g)].length||null,capacity:null,room:r[4],product:route[1]+' → '+route[2],tripHint:r[6]};
  }
 }
 if(provider==='Hotel ABC Chur'&&isMail&&/thank you for your reservation/i.test(s)){
  return {provider,reference:s.match(/reservation number\s+(\d+)/i)?.[1],name:s.match(/Hello\s+(.+?)!/i)?.[1]||'',start:dateValue(s.match(/Your arrival day:\s*(\S+)/i)?.[1]),end:'',product:provider,room:'',capacity:null,occupants:null,partialEvidence:true};
 }
 if(provider==='Best Western Montpellier'&&/Booking confirmation\s+\d+/i.test(s)&&/Guest name:/i.test(s)){
  // This hotel's English template uses US month-day-year; verify against nights.
  const block=s.slice(s.search(/Booking confirmation\s+\d+/i)),us=v=>{const m=v?.match(/(\d{2})-(\d{2})-(20\d{2})/);return m?`${m[3]}-${m[1]}-${m[2]}`:'';};
  const start=us(block.match(/Arrival date:\s*(\S+)/i)?.[1]),end=us(block.match(/Departure date:\s*(\S+)/i)?.[1]),nights=Number(block.match(/Number of night\(s\):\s*(\d+)/i)?.[1]);
  if(!start||!end||(Date.parse(end)-Date.parse(start))/86400000!==nights)return null;
  const room=block.match(/Room type:\s*(.*?)\s*Number of person/i)?.[1]||'';
  return {provider,reference:block.match(/Booking confirmation\s+(\d+)/i)?.[1],start,end,name:(block.match(/Guest name:\s*(.*?)\s*Arrival date:/i)?.[1]||'').split('|')[0].replace(/^([^,]+),\s*(.+)$/,'$2 $1'),occupants:Number(block.match(/Number of person\(s\):\s*(\d+)/i)?.[1])||null,capacity:roomCapacity(room),room,product:provider};
 }
 if(isMail&&/@(?:[\w-]+\.)?oebb\.at\b/i.test(message.from)&&/nightjet\.com (?:Buchung|booking)/i.test(message.subject)){
  const clean=s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  const route=clean.match(/Ihre Buchungen\s+(.+?)\s*(?:&rsaquo;|›|→)\s*(.+?)\s+gilt am\s+(\d{2}\.\d{2}\.20\d{2})\s+um\s+\d{2}:\d{2}\s+(.+?)\s+Wagennummer/i);
  if(!route||[...s.matchAll(/gilt am\s+\d/g)].length!==1)return null;
  const nl=/amsterdam|utrecht|arnhem|rotterdam|deventer|amersfoort/i;
  return {provider:'ÖBB',reference:s.match(/Buchungscode:\s*([\d ]{16,24})/i)?.[1]?.replace(/\s/g,''),start:dateValue(route[3]),end:'',partialEvidence:true,name:route[4].split(',')[0].trim(),product:route[1]+' → '+route[2],direction:nl.test(route[1])?'outbound':nl.test(route[2])?'inbound':'',originCountry:nl.test(route[1])?'NL':'',occupants:route[4].split(',').length,capacity:null,room:''};
 }
 return null;
}
