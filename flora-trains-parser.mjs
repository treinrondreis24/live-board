import {hash,normalize} from './flora-engine.mjs';
const iso=(d,m,y)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const months={jan:1,feb:2,mrt:3,mar:3,apr:4,mei:5,jun:6,jul:7,aug:8,sep:9,okt:10,nov:11,dec:12};
const station=s=>String(s||'').trim().replace(/\s+/g,' ');
export function parseNSTrains(message,trip){
 if(!/^no-reply@confirmation\.nsinternational\.nl$/i.test(message.from.trim())&&!/<no-reply@confirmation\.nsinternational\.nl>/i.test(message.from))return [];
 if(!new RegExp('\\b'+trip+'A\\b','i').test(message.subject))return [];
 if(/optie|annul|cancel|refund|storn/i.test(message.subject))return [];
 const reference=message.subject.match(/boekingscode\s*:?\s*([A-Z0-9]+)/i)?.[1]||'',rows=[];
 const add=r=>rows.push({...r,id:hash([trip,reference,r.date,r.number,r.from,r.to,r.departure,r.arrival]),trip,reference,source:message.url,messageId:message.id,observedAt:message.at,status:'Te beoordelen'});
 for(const doc of message.docs||[]){if(doc.label==='E-mail')continue;const s=doc.text.replace(/\s+/g,' '),year=doc.year||s.match(/\b\d{2}\.\d{2}\.(20\d{2})\b/)?.[1];if(!year)continue;
 const route=/(\d{2})\.(\d{2})(?:\.20\d{2})?\s+(\d{2}:\d{2})\s+(.+?)\s*(?:->|→)\s*(.+?)\s+(\d{2})\.(\d{2})(?:\.20\d{2})?\s+(\d{2}:\d{2})([\s\S]*?)(?=\d{2}\.\d{2}\s+\d{2}:\d{2}|$)/g;
 for(const m of s.matchAll(route)){const number=m[9].match(/\b(?:TREIN|TRAIN|ZUG)\s+(\d{1,6})\b/i)?.[1];if(!number)continue;let arrivalYear=Number(year);if(Number(m[7])<Number(m[2]))arrivalYear++;add({date:iso(m[1],m[2],year),arrivalDate:iso(m[6],m[7],arrivalYear),departure:m[3],arrival:m[8],from:station(m[4]),to:station(m[5]),number,document:doc.label,kind:/RESERVERING/i.test(s)?'Reservering / ticket':'Ticket'});}
 }
 // Mail route details provide timetable context even when a train number is absent.
 if(!rows.length){const body=message.docs?.find(d=>d.label==='E-mail')?.text.replace(/\s+/g,' ')||'';
 const blocks=body.split(/\b(?:Heenreis|Terugreis)\b/).slice(1);for(const block of blocks){const dates=[...block.matchAll(/(?:Vertrek|Aankomst):\s*\w+\s+(\d{1,2})\s+(\w+)\s+(20\d{2})\s+om\s+(\d{2}:\d{2})/gi)];if(dates.length<2)continue;const dep=dates[0],arr=dates[1],month=months[dep[2].toLowerCase().slice(0,3)],am=months[arr[2].toLowerCase().slice(0,3)];if(!month||!am)continue;const detail=block.split('Routedetails')[1]?.split(/Tariefsoort|Belangrijke informatie/)[0]||'';
 for(const m of detail.matchAll(/\bV\s+(\d{2}:\d{2})\s+(.+?)\s+\bA\s+(\d{2}:\d{2})\s+(.+?)(?=\s+V\s+\d{2}:\d{2}|$)/g)){add({date:iso(dep[1],month,dep[3]),arrivalDate:iso(arr[1],am,arr[3]),departure:m[1],arrival:m[3],from:station(m[2]),to:station(m[4]),number:'',document:'E-mail',kind:'Reisgegevens; treinnummer ontbreekt'});}}
 }
 return [...new Map(rows.map(r=>[r.id,r])).values()];
}
export function connectionCandidates(rows){const result=[];for(const a of rows)for(const b of rows){if(!a.to||!b.from||!a.arrivalDate||!b.date||!/^\d{2}:\d{2}$/.test(a.arrival||'')||!/^\d{2}:\d{2}$/.test(b.departure||'')||a.id===b.id||a.trip!==b.trip||!a.number||!b.number||a.number===b.number||normalize(a.to)!==normalize(b.from)||a.arrivalDate!==b.date)continue;const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),gap=minutes(b.departure)-minutes(a.arrival);if(gap<0||gap>240)continue;result.push({id:hash([a.id,b.id]),trip:a.trip,date:b.date,station:a.to,arrivalTrain:a.number,departureTrain:b.number,arrival:a.arrival,departure:b.departure,minutes:gap,fromId:a.id,toId:b.id,backup:null,status:'Te beoordelen'});}return result;}
