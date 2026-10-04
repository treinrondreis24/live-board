import {hash,normalize} from './flora-engine.mjs';
const iso=(d,m,y)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const months={jan:1,feb:2,mrt:3,mar:3,apr:4,mei:5,jun:6,jul:7,aug:8,sep:9,okt:10,nov:11,dec:12};
const station=s=>String(s||'').trim().replace(/\s+/g,' ');
export const passagePage=s=>/ditisgeenvervoerbewijs|ditpassageticket/i.test(String(s).replace(/\s+/g,''));
const subjectDate=s=>{const m=s.match(/vertrekdatum\s*:\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/i);return m?{year:Number(m[3]),month:Number(m[2])}:null;};
export function parseNSTrains(message,trip,{allowUnlinked=false}={}){
 if(!/^no-reply@confirmation\.nsinternational\.nl$/i.test(message.from.trim())&&!/<no-reply@confirmation\.nsinternational\.nl>/i.test(message.from))return [];
 if(!allowUnlinked&&!new RegExp('\\b'+trip+'A\\b','i').test(message.subject))return [];
 if(/optie|annul|cancel|refund|storn/i.test(message.subject))return [];
 if(message.retiredLinks?.length&&!message.docs?.some(d=>d.label!=='E-mail'))return [];
 const reference=message.subject.match(/boekingscode\s*:?\s*([A-Z0-9]+)/i)?.[1]||'',rows=[];
 const add=r=>rows.push({...r,id:hash([trip,reference,r.date,r.number,r.from,r.to,r.departure,r.arrival]),trip,reference,source:message.url,messageId:message.id,observedAt:message.at,status:'Te beoordelen'});
 const anchor=subjectDate(message.subject);
 for(const doc of message.docs||[]){if(doc.label==='E-mail'||passagePage(doc.text))continue;const s=doc.text.replace(/\s+/g,' '),year=s.match(/\b\d{2}\.\d{2}\.(20\d{2})\b/)?.[1]||anchor?.year||doc.year;if(!year)continue;
 const route=/(\d{2})\.(\d{2})(?:\.20\d{2})?\s+(\d{2}:\d{2})\s+(.+?)\s*(?:->|→)\s*(.+?)\s+(\d{2})\.(\d{2})(?:\.20\d{2})?\s+(\d{2}:\d{2})([\s\S]*?)(?=\d{2}\.\d{2}\s+\d{2}:\d{2}|$)/g;
 for(const m of s.matchAll(route)){const number=m[9].match(/\b(?:TREIN|TRAIN|ZUG)\s+(\d{1,6})\b/i)?.[1];if(!number)continue;const printed=m[0].match(/^\d{2}\.\d{2}\.(20\d{2})/),departureYear=printed?Number(printed[1]):Number(year)+(anchor?.month===12&&Number(m[2])===1&&!s.match(/\b\d{2}\.\d{2}\.20\d{2}\b/)?1:0);let arrivalYear=departureYear;if(Number(m[7])<Number(m[2]))arrivalYear++;add({date:iso(m[1],m[2],departureYear),arrivalDate:iso(m[6],m[7],arrivalYear),departure:m[3],arrival:m[8],from:station(m[4]),to:station(m[5]),number,document:doc.label,kind:/RESERVERING/i.test(s)?'Reservering / ticket':'Ticket'});}
 // Integrated tickets print each service in a dated itinerary table.
 const schedule=s.split('Uw reisschema en geboekte reservering(en)')[1]?.split(/Overzicht:|Passagierslijst:|Gebruiksvoorwaarden:/)[0]||'';
 const legs=/(\d{2})\/(\d{2})\/(20\d{2})\s+(\d{2}:\d{2})\s+(.+?)\s*->\s*(\d{2}:\d{2})\s+(.+?)\s+([A-Z]*\d[A-Z0-9]*)(?=\s+(?:\d+|\*))/g;
 for(const m of schedule.matchAll(legs)){const date=iso(m[1],m[2],m[3]),number=m[8].replace(/^(?:ICE|IC|EC|ECE|RJX|RJ|RE|RB)(?=\d)/,'');const arrival=new Date(date+'T00:00:00Z');if(m[6]<m[4])arrival.setUTCDate(arrival.getUTCDate()+1);add({date,arrivalDate:arrival.toISOString().slice(0,10),departure:m[4],arrival:m[6],from:station(m[5]),to:station(m[7]),number,document:doc.label,kind:'Reisschema op ticket'});}
 // Some through tickets list train-bound segments only in their VIA line.
 if(!schedule){const via=s.match(/\bVIA\s+(.+?)(?=\s+(?:SPARPREIS|SUPER|FLEXPREIS|TARIEF|TOURISTIC|PRIJS:))/)?.[1]||'',vd=via.match(/\((\d{2})\.(\d{2})\.(20\d{2})\)/),whole=s.match(/KLASSE\s+\*\s+\*\s+(.+?)\s*->\s*(.+?)(?=\s+\*|\s+\+City)/);
 if(vd){const clean=via.slice(via.indexOf(vd[0])+vd[0].length).replace(/^NV\*\s*/,''),segments=[...clean.matchAll(/(?:^|\/)\s*(.+?)\s+(\d{1,2}:\d{2})\s*(ICE|IC|EC|RJX|RJ)\s*(\d{1,6})(?=\s*\/|\s*$)/g)];
 for(let i=0;i<segments.length;i++){const m=segments[i],date=iso(vd[1],vd[2],vd[3]),to=segments[i+1]?.[1]||clean.slice(m.index+m[0].length).replace(/^\s*\/\s*/,'')||whole?.[2]||'';if(!to||rows.some(r=>r.date===date&&r.number===m[4]))continue;add({date,arrivalDate:'',departure:m[2].padStart(5,'0'),arrival:'',from:station(m[1]),to:station(to),number:m[4],document:doc.label,kind:'Treinbinding op ticket; aankomsttijd niet vermeld'});}
 }
 }
 }
 // NS reservation summaries can state the train number without printed times.
 const mailBody=message.docs?.find(d=>d.label==='E-mail')?.text.replace(/\s+/g,' ')||'';
 const summary=/(?:^|[.!?]\s+|klas\s+)([^:!?]{2,90}?)\s+-\s+([^:!?]{2,90}?)\s+Vertrek:\s*\w+\s+(\d{1,2})\s+(\w+)\s+(20\d{2})(.*?)(?=Reizigers:|$)/gi;
 for(const m of mailBody.matchAll(summary)){
  const number=m[6].match(/Treinnummer:\s*(\d{1,6})\b/i)?.[1],month=months[m[4].toLowerCase().slice(0,3)];if(!number||!month)continue;
  const date=iso(m[3],month,m[5]);if(rows.some(r=>r.number===number&&r.date===date))continue;
  const arr=m[6].match(/Aankomst:\s*\w+\s+(\d{1,2})\s+(\w+)\s+(20\d{2})(?:\s+om\s+(\d{2}:\d{2}))?/i),am=arr&&months[arr[2].toLowerCase().slice(0,3)];
  add({date,arrivalDate:am?iso(arr[1],am,arr[3]):'',number,from:station(m[1].split(/\.\s+/).at(-1)),to:station(m[2]),departure:m[6].match(/^\s+om\s+(\d{2}:\d{2})/)?.[1]||'',arrival:arr?.[4]||'',document:'E-mail',kind:'Reservering; tijden mogelijk niet vermeld'});
 }
 // Mail route details provide timetable context even when a train number is absent.
 if(!rows.length){const body=message.docs?.find(d=>d.label==='E-mail')?.text.replace(/\s+/g,' ')||'';
 const blocks=body.split(/\b(?:Heenreis|Terugreis)\b/).slice(1);for(const block of blocks){const dates=[...block.matchAll(/(?:Vertrek|Aankomst):\s*\w+\s+(\d{1,2})\s+(\w+)\s+(20\d{2})\s+om\s+(\d{2}:\d{2})/gi)];if(dates.length<2)continue;const dep=dates[0],arr=dates[1],month=months[dep[2].toLowerCase().slice(0,3)],am=months[arr[2].toLowerCase().slice(0,3)];if(!month||!am)continue;const detail=block.split('Routedetails')[1]?.split(/Tariefsoort|Belangrijke informatie/)[0]||'';
 for(const m of detail.matchAll(/\bV\s+(\d{2}:\d{2})\s+(.+?)\s+\bA\s+(\d{2}:\d{2})\s+(.+?)(?=\s+V\s+\d{2}:\d{2}|$)/g)){add({date:iso(dep[1],month,dep[3]),arrivalDate:iso(arr[1],am,arr[3]),departure:m[1],arrival:m[3],from:station(m[2]),to:station(m[4]),number:'',document:'E-mail',kind:'Reisgegevens; treinnummer ontbreekt'});}}
 }
 return [...new Map(rows.filter(r=>r.number&&(!r.kind.startsWith('Treinbinding')||!rows.some(other=>other!==r&&!other.kind.startsWith('Treinbinding')&&other.date===r.date&&other.number===r.number&&other.departure===r.departure))).map(r=>[r.id,r])).values()];
}
export function connectionCandidates(rows){const result=[];for(const a of rows)for(const b of rows){if(!a.to||!b.from||!a.arrivalDate||!b.date||!/^\d{2}:\d{2}$/.test(a.arrival||'')||!/^\d{2}:\d{2}$/.test(b.departure||'')||a.id===b.id||a.trip!==b.trip||!a.number||!b.number||a.number===b.number||normalize(a.to)!==normalize(b.from)||a.arrivalDate!==b.date)continue;const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),gap=minutes(b.departure)-minutes(a.arrival);if(gap<0||gap>240)continue;result.push({id:hash([a.id,b.id]),trip:a.trip,date:b.date,station:a.to,arrivalTrain:a.number,departureTrain:b.number,arrival:a.arrival,departure:b.departure,minutes:gap,fromId:a.id,toId:b.id,backup:null,status:'Te beoordelen'});}return result;}
