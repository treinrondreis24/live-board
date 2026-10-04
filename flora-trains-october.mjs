import {randomUUID} from 'node:crypto';
import {parseNSTrains,passagePage} from './flora-trains-parser.mjs';

const since=Date.parse('2026-06-01T00:00:00Z');
const header=(m,name)=>(m.payload?.headers||[]).find(h=>h.name.toLowerCase()===name)?.value||'';
const subject=m=>header(m,'subject');
const reference=m=>subject(m).match(/boekingscode\s*:?\s*([A-Z0-9]+)/i)?.[1]?.toUpperCase()||'';
const eligible=m=>Number(m.internalDate)>=since&&/^(?:[^<>]*<)?no-reply@confirmation\.nsinternational\.nl>?$/i.test(header(m,'from').trim());
export const octoberSubject=s=>/\b(?:0?[1-9]|[12]\d|3[01])[\/.-]10[\/.-]2026\b|\b2026-10-(?:0[1-9]|[12]\d|3[01])\b|\b(?:0?[1-9]|[12]\d|3[01])\s+(?:okt(?:ober)?|oct(?:ober)?)\.?\s+2026\b/i.test(s);
export async function startOctober({read,write,google},retry=false){
 if(!(await google.status()).connected)throw Error('Koppel Gmail eerst.');
 const old=await read('trains-job');
 if(['queued','running'].includes(old.value.status))throw Error('Er loopt al een treincontrole.');
 const checks=retry?(await read('trains-data')).value.checks||{}:{},queue=Object.entries(checks).filter(([k,c])=>/^NS [A-Z0-9]+$/.test(k)&&c.issues?.length).map(([k])=>k.slice(3));
 if(retry&&!queue.length)throw Error('Geen NS-dossiers met opmerkingen om opnieuw te controleren.');
 await write('trains-job',{id:randomUUID(),mode:'october',retry,status:'queued',stage:retry?'extract':'discover',queue,page:'',scanned:0,selected:0,done:0,saved:0,issues:[],phase:retry?'NS-dossiers met opmerkingen opnieuw controleren':'Oktober 2026: NS-mails vanaf 01-06-2026 zoeken',at:new Date().toISOString()},old.revision);
 return (await read('trains-job')).value;
}
export async function runOctober({read,write,google,extract}){
 let stored=await read('trains-job'),job=stored.value;
 if(!['queued','running'].includes(job.status)||job.lease>Date.now())return;
 const owner=randomUUID();let revision=stored.revision;
 const put=async()=>{job.at=new Date().toISOString();job.owner=owner;job.lease=Date.now()+300000;revision=await write('trains-job',job,revision);};
 try{
  job.status='running';await put();const reader=await google.reader();
  const get=async(...args)=>{const current=(await read('trains-job')).value;if(current.id!==job.id||current.owner!==owner)throw Error('Treincontrole is overgenomen.');return reader(...args);};
  if(job.stage==='discover'){
   do{
    const result=await get('messages',{q:'from:no-reply@confirmation.nsinternational.nl after:'+Math.floor(since/1000)+' {subject:10 subject:okt subject:oktober subject:oct subject:october} -in:spam -in:trash',maxResults:'100',...(job.page?{pageToken:job.page}:{})});
    for(const {id} of result.messages||[]){
     const m=await get('messages/'+id,{format:'metadata'});job.scanned++;
     if(eligible(m)&&octoberSubject(subject(m))){const ref=reference(m);if(ref){if(!job.queue.includes(ref))job.queue.push(ref);}else job.issues.push('Bericht '+id+': boekingscode ontbreekt.');job.selected++;}
     job.phase=`Oktober: ${job.scanned} mailonderwerpen bekeken; ${job.queue.length} NS-dossiers gevonden`;await put();
    }
    job.page=result.nextPageToken||'';if(!job.page)job.stage='extract';await put();
   }while(job.stage==='discover');
  }
  for(const ref of job.queue.slice(job.done)){
   job.phase=`Oktober: dossier ${job.done+1} van ${job.queue.length} (${ref}) controleren`;await put();
   let page='',latest=null,count=0;
   do{const list=await get('messages',{q:'from:no-reply@confirmation.nsinternational.nl after:'+Math.floor(since/1000)+' "'+ref+'" -in:spam -in:trash',maxResults:'100',...(page?{pageToken:page}:{})});
    for(const {id} of list.messages||[]){const m=await get('messages/'+id,{format:'metadata'});count++;if(eligible(m)&&reference(m)===ref&&(!latest||Number(m.internalDate)>Number(latest.internalDate)))latest=m;await put();}page=list.nextPageToken||'';
   }while(page);
   if(!latest)throw Error('Geen nieuwste bericht gevonden voor '+ref+'.');
   const issues=[],notes=[];let rows=[];
   if(!/optie|annul|cancel|refund|storn/i.test(subject(latest))){
    const full=await get('messages/'+latest.id,{format:'full'}),decoded=await extract(full,get);
    const trips=[...new Set([...decoded.subject.matchAll(/\b(\d{4,6})A\b/gi)].map(m=>m[1]))],trip=trips.length===1?trips[0]:'';
    rows=parseNSTrains(decoded,trip,{allowUnlinked:!trip}).filter(r=>/^2026-(10|11)-/.test(r.date));
    issues.push(...decoded.issues);if(rows.length&&!trip)issues.push('Treinrondreis-boekingsnummer ontbreekt of is niet eenduidig.');
    const pages=decoded.docs.filter(d=>d.label!=='E-mail'),useful=pages.filter(d=>!passagePage(d.text)),numbered=useful.filter(d=>/\b(?:TREIN|TRAIN|ZUG)\s+\d|Uw reisschema|\b(?:ICE|RJX|RJ|IC|EC)\s*\d/i.test(d.text));
    if(pages.length>useful.length)notes.push(`${pages.length-useful.length} passagepagina’s overgeslagen.`);
    if(decoded.retiredLinks?.length)notes.push(`${decoded.retiredLinks.length} geannuleerde ticketlinks overgeslagen.`);
    if(useful.length>numbered.length)notes.push(`${useful.length-numbered.length} ticketpagina’s zonder treinnummer overgeslagen.`);
    if(!rows.length&&!issues.length){if(numbered.length)issues.push('Treinnummer aanwezig, maar geen traject in oktober of november uitgelezen.');else if(!pages.length&&!decoded.retiredLinks?.length)issues.push('Geen leesbaar treinticket gevonden.');}
   }else{
    notes.push('Nieuwste bericht betreft een annulering of optie; geen actieve treinen opgeslagen.');
   }
   for(let attempt=0;attempt<5;attempt++){
    const d=await read('trains-data'),old=d.value,previous=new Map((old.rows||[]).map(r=>[r.id,r]));
    const replaced=new Set((old.rows||[]).filter(r=>r.reference===ref).map(r=>r.id));
    const next=(old.rows||[]).filter(r=>r.reference!==ref||issues.length&&!rows.some(n=>n.id===r.id)).concat(rows.map(r=>({...r,scanScope:'october-2026',status:!issues.length&&previous.get(r.id)?.status==='Bevestigd'?'Bevestigd':'Te beoordelen'})));
    const validIds=new Set(next.map(r=>r.id));
    const connections=(old.connections||[]).filter(c=>(!replaced.has(c.fromId)||validIds.has(c.fromId))&&(!replaced.has(c.toId)||validIds.has(c.toId)));
    try{await write('trains-data',{...old,rows:next,connections,checks:{...(old.checks||{}),['NS '+ref]:{at:new Date().toISOString(),messages:count,dossiers:1,issues,notes,rows:rows.length,subject:subject(latest),source:latest.id}}},d.revision);break;}catch(e){if(e.status!==409||attempt===4)throw e;}
   }
   job.saved+=rows.length;job.done++;job.issues.push(...issues.map(s=>ref+': '+s));await put();
  }
  job.status=job.issues.length?'partial':'completed';job.phase=`Oktoberscan afgerond: ${job.done} NS-dossiers verwerkt; ${job.saved} treinregels opgeslagen. Aansluitingen volgen later.`;job.lease=0;job.at=new Date().toISOString();await write('trains-job',job,revision);
 }catch(e){const current=await read('trains-job');if(current.value.owner===owner)await write('trains-job',{...current.value,status:'failed',lease:0,phase:e.message,at:new Date().toISOString()},current.revision);}
}
