export const dfdsSender=from=>/@(?:[\w-]+\.)?dfds\.(?:info|com)(?=>|\s|$)/i.test(from||'');
export function safeDFDSURL(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  return u.hostname==='links.dfds.info'&&/^\/s\/c\/[\w/-]+$/.test(u.pathname)||['dfds.com','www.dfds.com'].includes(u.hostname)&&(/^\/api\/booking-confirmation\/\d{6,10}\/[A-Fa-f0-9]+$/.test(u.pathname)||u.pathname==='/sbwapi/booking/reservation/itinerarypdf')?u:null;
 }catch{return null;}
}
export function dfdsLinks(html,from){
 if(!dfdsSender(from))return [];
 return [...new Set([...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].filter(m=>/DOWNLOAD[\s\S]*BOEKINGSBEVESTIGING/i.test(m[2])).map(m=>m[1].replace(/&amp;/g,'&')).filter(safeDFDSURL))].slice(0,1);
}
export async function dfdsPDF(url,{fetchImpl=fetch,readPDF}={}){
 let u=safeDFDSURL(url);if(!u)throw Error('DFDS-bevestigingslink niet ondersteund.');
 const signal=AbortSignal.timeout(20000);let r;
 for(let hop=0;hop<5;hop++){
  r=await fetchImpl(u,{redirect:'manual',signal,headers:{Accept:'application/pdf'}});
  if(![301,302,303,307,308].includes(r.status))break;
  const location=r.headers.get('location');await r.body?.cancel();
  const next=location&&safeDFDSURL(new URL(location,u).href);if(!next||hop===4)throw Error('DFDS-verwijzing niet ondersteund.');u=next;
 }
 if(!r.ok)throw Error('DFDS-bevestiging niet beschikbaar (HTTP '+r.status+').');
 const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>10*1024*1024){await r.body.cancel().catch(()=>{});throw Error('DFDS-bevestiging te groot.');}chunks.push(c);}
 return readPDF(Buffer.concat(chunks));
}
// Keep both legs separate, while retaining all pages as auditable source documents.
export function dfdsLegDocuments(pages,link=''){
 const text=pages.join('\n'),flat=text.replace(/\s+/g,' ');
 if(!/DFDS\s+BOEKINGS\s*BEVESTIGING/i.test(flat)||/boeking.*geannuleerd/i.test(flat))return [];
 const ref=flat.match(/Boekingsnummer:\s*(\d{6,10})(?:-\d+)?/i)?.[1],name=flat.match(/Naam:\s*(.*?)(?:\s+Tel\.nr:.*?)?\s+Referentie reisagent:/i)?.[1];
 if(!ref||!name)return [];
 const routes=[...text.matchAll(/(IJmuiden\s*[-–]\s*Newcastle|Newcastle\s*[-–]\s*IJmuiden):\s*Naam\s+schip:/gi)];
 return routes.map((m,i)=>({label:'DFDS-overtocht · '+(i+1),text:'Boekingsnummer: '+ref+' Naam: '+name+' Referentie reisagent: DFDS\n'+text.slice(m.index,routes[i+1]?.index||text.length),link,dfdsLeg:true}));
}
export function parseDFDS(doc,message,dateValue){
 if(!dfdsSender(message.from)||!doc.dfdsLeg||/geannuleerd/i.test(message.subject))return null;
 const s=doc.text.replace(/\s+/g,' '),reference=s.match(/Boekingsnummer:\s*(\d{6,10})/)?.[1],name=s.match(/Naam:\s*(.*?)(?:\s+Tel\.nr:.*?)?\s+Referentie reisagent:/)?.[1];
 const route=s.match(/(IJmuiden\s*[-–]\s*Newcastle|Newcastle\s*[-–]\s*IJmuiden):\s*Naam schip:/i)?.[1];
 const dates=s.match(/Vertrek:\s*\w+\s+(\d{1,2}-\d{1,2}-20\d{2})\s+(\d{2}:\d{2}),\s*Aankomst:\s*\w+\s+(\d{1,2}-\d{1,2}-20\d{2})\s+(\d{2}:\d{2})/i);
 if(!reference||!name||!route||!dates)return null;
 const rooms=[...doc.text.matchAll(/(\d+)\s*x\s*(\d+)-persoons[^\n]*/gi)];
 const passengerBlock=s.slice(s.indexOf(dates[0])+dates[0].length).split(/\d+\s*x\s*\d+-persoons|Gastenlijst:|DFDS BOEKINGS/)[0];
 const people=[...passengerBlock.matchAll(/(\d+)\s+(?:Volwassenen?|Kinderen?|Baby['’]?s|Baby|Infants?)/gi)];
 const direction=/^IJmuiden/i.test(route)?'outbound':'inbound';
 return {provider:'DFDS',reference:reference+'/'+direction,name,product:route.replace(/\s+/g,' '),direction,start:dateValue(dates[1]),end:dateValue(dates[3]),capacity:rooms.length?rooms.reduce((n,m)=>n+Number(m[1])*Number(m[2]),0):null,occupants:people.length?people.reduce((n,m)=>n+Number(m[1]),0):null,room:rooms.map(m=>m[0].replace(/\s+/g,' ')).join('; '),roomCount:rooms.length?rooms.reduce((n,m)=>n+Number(m[1]),0):null};
}
export function latestDFDS(events,messages){
 const latest=new Map();
 for(const m of messages){
  if(!dfdsSender(m.from)||m.issues?.length||!/Bedankt voor je boeking|Je boeking is gewijzigd/i.test(m.subject))continue;
  const rows=events.filter(e=>e.provider==='DFDS'&&e.messageId===m.id);
  for(const e of rows){const ref=e.reference.split('/')[0],old=latest.get(ref);if(!old||old.at<m.at)latest.set(ref,{at:m.at,rows});}
 }
 return events.map(e=>{const next=e.provider==='DFDS'&&latest.get(e.reference.split('/')[0]);return next&&e.observedAt<next.at&&!next.rows.some(n=>n.reference===e.reference)?{...e,status:'superseded'}:e;});
}
