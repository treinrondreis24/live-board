import {randomUUID} from 'node:crypto';
import {parseNSTrains,passagePage} from './flora-trains-parser.mjs';

export const NS_SINCE='2026-05-31T22:00:00.000Z'; // 01-06-2026, Amsterdam
export const nsTravelDate=date=>/^2026-(11|12)-\d{2}$|^2027-\d{2}-\d{2}$/.test(date);
const active=job=>['queued','running'].includes(job.status);
const header=(m,n)=>(m.payload?.headers||[]).find(h=>h.name.toLowerCase()===n)?.value||'';
const refOf=m=>header(m,'subject').match(/boekingscode\s*:?\s*([A-Z0-9]+)/i)?.[1]?.toUpperCase()||'';
const eligible=m=>Number(m.internalDate)>=Date.parse(NS_SINCE)&&/^(?:[^<>]*<)?no-reply@confirmation\.nsinternational\.nl>?$/i.test(header(m,'from').trim());
const localDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
const baseQuery='from:no-reply@confirmation.nsinternational.nl -in:spam -in:trash';

export function createNSImport({read,write,google,extract,clock=()=>Date.now(),budgetMs=45000}){
 const stamp=()=>new Date(clock()).toISOString();
 async function start({daily=false}={}){
  if(!(await google.status()).connected)throw Error('Koppel Gmail eerst.');
  const stored=await read('trains-job');if(active(stored.value))throw Error('Er loopt al een treincontrole.');
  const schedule=await read('trains-schedule'),at=stamp();
  const since=daily&&schedule.value.checkpoint?new Date(Math.max(Date.parse(NS_SINCE),Date.parse(schedule.value.checkpoint)-86400000)).toISOString():NS_SINCE;
  const retry=daily?(await read('trains-data')).value.checks||{}:{};
  const queue=Object.entries(retry).filter(([k,c])=>k.startsWith('NS ')&&c.importScope==='nov2026-2027'&&c.issues?.length).map(([k])=>k.slice(3));
  const job={id:randomUUID(),mode:'ns-import',status:'queued',stage:'discover',daily,since,until:at,startedAt:at,day:localDay(clock()),queue,page:'',pending:[],done:0,saved:0,scanned:0,issues:[],phase:'NS International: e-mails vanaf 01-06-2026 verzamelen',at};
  await write('trains-job',job,stored.revision);
  // Durable setting, independently scheduled from the general 02:00 check.
  await write('trains-schedule',{...schedule.value,enabled:true,lastStartedDay:job.day,lastStartedAt:at},schedule.revision);
  return job;
 }
 async function daily(){
  const s=await read('trains-schedule');if(!s.value.enabled||s.value.lastStartedDay===localDay(clock()))return;
  if(active((await read('trains-job')).value))return;
  if(s.value.lastAttempt&&clock()-Date.parse(s.value.lastAttempt)<3600000)return;
  await write('trains-schedule',{...s.value,lastAttempt:stamp()},s.revision);
  try{await start({daily:true});}catch(e){const fresh=await read('trains-schedule');await write('trains-schedule',{...fresh.value,error:e.message},fresh.revision);}
 }
 async function schedule(){const {value}=await read('trains-schedule');return {...value,label:'Dagelijks 00:00 · Europe/Amsterdam'};}
 async function run(){
  let stored=await read('trains-job'),job=stored.value,revision=stored.revision;
  if(job.mode!=='ns-import'||!active(job)||job.lease>clock())return;
  const owner=randomUUID(),deadline=clock()+budgetMs;
  const assertOwner=async()=>{const current=await read('trains-job');if(current.value.id!==job.id||current.value.owner!==owner||!active(current.value))throw Error('Treincontrole gestopt of overgenomen.');};
  const put=async()=>{job.at=stamp();job.owner=owner;job.lease=clock()+300000;revision=await write('trains-job',job,revision);};
  const yieldJob=async()=>{await assertOwner();job.lease=0;job.at=stamp();await write('trains-job',job,revision);};
  try{
   job.status='running';await put();const reader=await google.reader();
   const get=async(...args)=>{await assertOwner();const result=await reader(...args);await put();return result;};
   while(job.stage==='discover'){
    if(!job.pending.length){
     const result=await get('messages',{q:baseQuery+' after:'+Math.floor(Date.parse(job.since)/1000)+' before:'+Math.ceil(Date.parse(job.until)/1000),maxResults:'100',...(job.page?{pageToken:job.page}:{})});
     job.pending=(result.messages||[]).map(m=>m.id);job.nextPage=result.nextPageToken||'';await put();
    }
    while(job.pending.length){
     const m=await get('messages/'+job.pending[0],{format:'metadata'});
     if(eligible(m)){const ref=refOf(m);if(ref&&!job.queue.includes(ref))job.queue.push(ref);else if(!ref)job.issues.push('Bericht '+m.id+': boekingscode ontbreekt.');}
     job.pending.shift();job.scanned++;job.phase=`NS International: ${job.scanned} berichten bekeken; ${job.queue.length} dossiers gevonden`;await put();
     if(clock()>=deadline){if(!job.pending.length){job.page=job.nextPage;if(!job.page)job.stage='extract';}await yieldJob();return;}
    }
    job.page=job.nextPage;if(!job.page)job.stage='extract';await put();
   }
   for(const ref of job.queue.slice(job.done)){
    job.phase=`NS International: dossier ${job.done+1} van ${job.queue.length} (${ref}) lezen`;await put();
    let latest=null,count=0,page='',rows=[],issues=[],notes=[],cancelled=false;
    try{
     do{
      const list=await get('messages',{q:baseQuery+' after:'+Math.floor(Date.parse(NS_SINCE)/1000)+' "'+ref+'"',maxResults:'100',...(page?{pageToken:page}:{})});
      for(const {id} of list.messages||[]){const m=await get('messages/'+id,{format:'metadata'});count++;if(eligible(m)&&refOf(m)===ref&&(!latest||Number(m.internalDate)>Number(latest.internalDate)))latest=m;}
      page=list.nextPageToken||'';
     }while(page);
     if(!latest)throw Error('Geen nieuwste NS-bericht gevonden.');
     const subject=header(latest,'subject');cancelled=/annul|cancel|refund|storn/i.test(subject);
     if(cancelled)notes.push('Nieuwste NS-bericht is een annulering; eerdere treinen uit dit dossier verwijderd.');
     else if(/optie/i.test(subject))issues.push('Nieuwste bericht is een optie; geen bevestigde trein toegevoegd.');
     else{
      const decoded=await extract(await get('messages/'+latest.id,{format:'full'}),get);
      const trips=[...new Set([...subject.matchAll(/\b(\d{4,6})A\b/gi)].map(m=>m[1]))],trip=trips.length===1?trips[0]:'';
      const parsed=parseNSTrains(decoded,trip,{allowUnlinked:!trip});
      rows=parsed.filter(r=>r.number&&nsTravelDate(r.date));
      issues.push(...decoded.issues);if(rows.length&&!trip)issues.push('Treinrondreis-boekingsnummer ontbreekt of is niet eenduidig.');
      const pages=decoded.docs.filter(d=>d.label!=='E-mail');
      if(!parsed.length&&pages.some(d=>!passagePage(d.text)&&/\b(?:TREIN|TRAIN|ZUG)\s+\d|Uw reisschema|\b(?:ICE|RJX|RJ|IC|EC)\s*\d/i.test(d.text)))issues.push('Treinnummer gevonden, maar datum of traject niet volledig uitgelezen.');
      const skipped=pages.filter(d=>passagePage(d.text)).length;if(skipped)notes.push(skipped+' passagepagina’s overgeslagen.');
      if(!rows.length&&!issues.length)notes.push('Geen trein met treinnummer in november/december 2026 of 2027 gevonden.');
      if(decoded.retiredLinks?.length)notes.push(decoded.retiredLinks.length+' geannuleerde ticketlinks overgeslagen.');
     }
    }catch(e){await assertOwner();issues.push(e.message);}
    issues=[...new Set(issues)];await assertOwner();
    for(let attempt=0;attempt<5;attempt++){
     const d=await read('trains-data'),old=d.value,previous=new Map((old.rows||[]).map(r=>[r.id,r]));
     // A failed source cannot erase existing evidence. Rows outside this import remain intact.
     const next=(old.rows||[]).filter(r=>r.reference!==ref||(!cancelled&&(!nsTravelDate(r.date)||issues.length&&!rows.some(n=>n.id===r.id)))).concat(rows.map(r=>({...r,scanScope:'nov2026-2027',status:!issues.length&&previous.get(r.id)?.status==='Bevestigd'?'Bevestigd':'Te beoordelen'})));
     const valid=new Set(next.map(r=>r.id));
     const checks={...(old.checks||{}),['NS '+ref]:{at:stamp(),messages:count,dossiers:1,issues,notes,rows:rows.length,subject:latest?header(latest,'subject'):'',source:latest?.id||'',importScope:'nov2026-2027'}};
     try{await write('trains-data',{...old,rows:next,connections:(old.connections||[]).filter(c=>valid.has(c.fromId)&&valid.has(c.toId)),checks},d.revision);break;}catch(e){if(e.status!==409||attempt===4)throw e;}
    }
    job.saved+=rows.length;job.done++;job.issues.push(...issues.map(s=>ref+': '+s));await put();
    if(clock()>=deadline&&job.done<job.queue.length){await yieldJob();return;}
   }
   job.status=job.issues.length?'partial':'completed';job.phase=`NS-import afgerond: ${job.done} dossiers verwerkt; ${job.saved} treinregels opgeslagen. ${job.issues.length} opmerkingen. Aansluitingen volgen later.`;job.lease=0;job.at=stamp();await write('trains-job',job,revision);
   const s=await read('trains-schedule');await write('trains-schedule',{...s.value,checkpoint:job.until,lastCompletedAt:stamp(),error:null},s.revision);
  }catch(e){const current=await read('trains-job');if(current.value.owner===owner)await write('trains-job',{...current.value,status:'failed',lease:0,phase:e.message,at:stamp()},current.revision);}
 }
 return {start,run,daily,schedule};
}
