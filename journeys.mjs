import {createHash} from 'node:crypto';

let backend,pool,sqlite;
let writes=Promise.resolve();
export const journeyImportState={status:'waiting',lastAttempt:null,lastSuccess:null,error:null,journeys:0,ritMessages:0,lastRitAt:null};
const list=x=>x==null?[]:Array.isArray(x)?x:[x];
const text=x=>String(x&&typeof x==='object'?x['#text']??'':x??'').trim();
const variant=(x,status)=>list(x).find(v=>v?.['@_InfoStatus']===status);
const stamp=x=>{const n=typeof x==='number'?x:Date.parse(text(x));return Number.isFinite(n)&&n>0?n:null;};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=(train,date)=>`NDOV|${train}|${date}`;

export async function initJourneys(db){
 ({backend,pool,sqlite}=db);
 const schema=`CREATE TABLE IF NOT EXISTS journey_archive (
   journey_id TEXT PRIMARY KEY,train_number TEXT NOT NULL,service_date TEXT NOT NULL,
   first_seen_at BIGINT NOT NULL,last_seen_at BIGINT NOT NULL,state_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS journey_archive_lookup ON journey_archive(train_number,service_date);
 CREATE TABLE IF NOT EXISTS journey_archive_revisions (
   revision_id TEXT PRIMARY KEY,journey_id TEXT NOT NULL,observed_at BIGINT NOT NULL,
   source TEXT NOT NULL,source_timestamp BIGINT NOT NULL,snapshot_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS journey_revision_lookup ON journey_archive_revisions(journey_id,observed_at);`;
 if(backend==='postgresql')await pool.query(schema);else sqlite.exec(schema);
}

// First means first observed here, not the original annual timetable.
// Expected timestamps are never silently promoted to realized timestamps.
export function applyJourneySnapshot(previous,snapshot,receivedAt=Date.now()){
 const state=previous?structuredClone(previous):{trainNumber:snapshot.trainNumber,serviceDate:snapshot.serviceDate,firstSeenAt:receivedAt,stops:[],planningTimestamp:0};
 const sourceTimestamp=Number(snapshot.sourceTimestamp),meta={source:snapshot.source,sourceTimestamp,recordedAt:receivedAt};
 if(!Number.isFinite(sourceTimestamp))throw Error('Missing source timestamp');
 const byId=new Map(state.stops.map(s=>[s.id,s]));
 const complete=snapshot.completePlan&&sourceTimestamp>=state.planningTimestamp;
 if(complete){for(const s of state.stops)s.inLatestPlan=false;state.planningTimestamp=sourceTimestamp;state.planningSource=snapshot.source;}
 for(const incoming of snapshot.stops){
   let stop=byId.get(incoming.id);
   if(!stop){stop={id:incoming.id,stationCode:incoming.stationCode,station:incoming.station,sequence:incoming.sequence,inLatestPlan:true,firstSeenAt:receivedAt,arrival:null,departure:null};state.stops.push(stop);byId.set(stop.id,stop);}
   if(complete){stop.sequence=incoming.sequence;stop.inLatestPlan=true;}
   for(const mode of ['arrival','departure']){
     const input=incoming[mode];if(!input)continue;
     const event=stop[mode]??={original:null,planning:null,realtime:null,realized:null};
     if(input.plannedTime!=null){
       const plan={time:input.plannedTime,platform:input.plannedPlatform??null,...meta};
       if(!event.original)event.original=plan;
       if(!event.planning||sourceTimestamp>=event.planning.sourceTimestamp)event.planning=plan;
     }
     if(input.realtime===true&&(!event.realtime||sourceTimestamp>=event.realtime.sourceTimestamp)){
       event.realtime={expectedTime:input.expectedTime??null,platform:input.currentPlatform??null,cancelled:Boolean(input.cancelled),...meta};
     }
     if(input.realizationConfirmed===true&&input.actualTime!=null&&(!event.realized||sourceTimestamp>=event.realized.sourceTimestamp)){
       event.realized={time:input.actualTime,platform:input.actualPlatform??null,...meta};
     }
   }
 }
 state.stops.sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id));
 state.category=snapshot.category||state.category||'';state.lastSeenAt=receivedAt;
 return state;
}

export function recordJourneySnapshot(snapshot){
 // Serialise all writers, including IFF and streaming RitInfo, within this service.
 const job=writes.then(()=>saveSnapshot(snapshot));writes=job.catch(()=>{});return job;
}
async function saveSnapshot(snapshot){
 if(!/^\d+$/.test(snapshot.trainNumber)||!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.serviceDate)||!snapshot.stops.length)throw Error('Invalid journey');
 const id=key(snapshot.trainNumber,snapshot.serviceDate),now=Date.now(),revisionId=hash([id,snapshot]);
 if(backend==='sqlite'){
  sqlite.exec('BEGIN');
  try{
   const exists=sqlite.prepare('SELECT revision_id FROM journey_archive_revisions WHERE revision_id=?').get(revisionId);
   if(!exists){
    const row=sqlite.prepare('SELECT state_json FROM journey_archive WHERE journey_id=?').get(id);
    const state=applyJourneySnapshot(row?JSON.parse(row.state_json):null,snapshot,now);
    sqlite.prepare('INSERT INTO journey_archive(journey_id,train_number,service_date,first_seen_at,last_seen_at,state_json) VALUES(?,?,?,?,?,?) ON CONFLICT(journey_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,state_json=excluded.state_json').run(id,snapshot.trainNumber,snapshot.serviceDate,state.firstSeenAt,now,JSON.stringify(state));
    sqlite.prepare('INSERT INTO journey_archive_revisions(revision_id,journey_id,observed_at,source,source_timestamp,snapshot_json) VALUES(?,?,?,?,?,?)').run(revisionId,id,now,snapshot.source,snapshot.sourceTimestamp,JSON.stringify(snapshot));
   }
   sqlite.exec('COMMIT');
  }catch(e){sqlite.exec('ROLLBACK');throw e;}
  return;
 }
 const client=backend==='postgresql'?await pool.connect():null;
 const query=async(sql,args=[])=>client?(await client.query(sql,args)).rows:sqlite.prepare(sql.replace(/\$\d+/g,'?')).all(...args);
 const exec=async(sql,args=[])=>client?client.query(sql,args):sqlite.prepare(sql.replace(/\$\d+/g,'?')).run(...args);
 try{
   if(client)await client.query('BEGIN');else sqlite.exec('BEGIN');
   await exec('INSERT INTO journey_archive(journey_id,train_number,service_date,first_seen_at,last_seen_at,state_json) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(journey_id) DO NOTHING',[id,snapshot.trainNumber,snapshot.serviceDate,now,now,'null']);
   const [row]=await query('SELECT state_json FROM journey_archive WHERE journey_id=$1'+(client?' FOR UPDATE':''),[id]);
   const exists=await query('SELECT revision_id FROM journey_archive_revisions WHERE revision_id=$1',[revisionId]);
   if(!exists.length){
     const state=applyJourneySnapshot(JSON.parse(row.state_json),snapshot,now);
     await exec('UPDATE journey_archive SET last_seen_at=$1,state_json=$2 WHERE journey_id=$3',[now,JSON.stringify(state),id]);
     await exec('INSERT INTO journey_archive_revisions(revision_id,journey_id,observed_at,source,source_timestamp,snapshot_json) VALUES($1,$2,$3,$4,$5,$6)',[revisionId,id,now,snapshot.source,snapshot.sourceTimestamp,JSON.stringify(snapshot)]);
   }
   if(client)await client.query('COMMIT');else sqlite.exec('COMMIT');
 }catch(e){if(client)await client.query('ROLLBACK');else sqlite.exec('ROLLBACK');throw e;}finally{client?.release();}
}
export async function getJourney(train,date){
 const id=key(train,date),sql='SELECT state_json FROM journey_archive WHERE journey_id=$1';
 const row=backend==='postgresql'?(await pool.query(sql,[id])).rows[0]:sqlite.prepare(sql.replace('$1','?')).get(id);
 return row?JSON.parse(row.state_json):null;
}
export async function listJourneys(train){
 const sql='SELECT train_number,service_date,first_seen_at,last_seen_at FROM journey_archive WHERE train_number=$1 ORDER BY service_date';
 return backend==='postgresql'?(await pool.query(sql,[train])).rows:sqlite.prepare(sql.replace('$1','?')).all(train);
}
export async function getJourneyRevisions(train,date){
 const sql='SELECT observed_at,source,source_timestamp,snapshot_json FROM journey_archive_revisions WHERE journey_id=$1 ORDER BY observed_at,revision_id';
 const rows=backend==='postgresql'?(await pool.query(sql,[key(train,date)])).rows:sqlite.prepare(sql.replace('$1','?')).all(key(train,date));
 return rows.map(({snapshot_json,...r})=>({...r,snapshot:JSON.parse(snapshot_json)}));
}

function localTimestamp(date,hhmm){
 if(!/^\d{4}$/.test(hhmm))throw Error('Invalid IFF time '+hhmm);
 const hour=Number(hhmm.slice(0,2)),minute=Number(hhmm.slice(2));
 const wall=Date.parse(date+'T00:00:00Z')+(hour*60+minute)*60000;
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 let result=wall;
 for(let i=0;i<3;i++){
  const p=Object.fromEntries(formatter.formatToParts(result).map(x=>[x.type,x.value]));
  const shown=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  result+=wall-shown;
 }
 return result;
}
export function parseIff(files,selected,fromDate,sourceTimestamp){
 const decode=name=>new TextDecoder('windows-1252').decode(files[name]);
 const fields=decode('delivery.dat').trim().split(',');
 const date=value=>value.slice(4,8)+'-'+value.slice(2,4)+'-'+value.slice(0,2);
 const start=date(fields[1]),end=date(fields[2]),startTs=Date.parse(start+'T00:00:00Z');
 const days=Math.round((Date.parse(end+'T00:00:00Z')-startTs)/86400000)+1;
 if(days<1||days>400)throw Error('Invalid IFF validity');
 const notes=new Map(decode('footnote.dat').split('#').slice(1).map(b=>{const lines=b.split(/[\r\n]+/).filter(Boolean);return [lines[0].trim(),lines.slice(1).join('').trim()];}));
 const stations=new Map(decode('stations.dat').split(/[\r\n]+/).filter(l=>l&&!l.startsWith('@')).map(l=>{const f=l.split(',');return [f[1].trim(),f.at(-1).trim()];}));
 const results=[],wanted=new Set(selected.map(String));
 for(const block of decode('timetbls.dat').split('#').slice(1)){
  const lines=block.split(/[\r\n]+/).filter(Boolean),services=lines.filter(l=>l[0]==='%').map(l=>l.slice(1).split(',').map(x=>x.trim()));
  const service=services.find(s=>wanted.has(String(Number(s[1]))));if(!service)continue;
  // The imported section belongs to this train number even on through services.
  const number=String(Number(service[1])),first=Number(service[3]),last=Number(service[4]);
  const running=lines.filter(l=>l[0]==='-').map(l=>l.slice(1).split(','));
  const category=lines.find(l=>l[0]==='&')?.slice(1).split(',')[0].trim()||'';
  for(let day=0;day<days;day++){
   const serviceDate=new Date(startTs+day*86400000).toISOString().slice(0,10);if(serviceDate<fromDate)continue;
   const active=note=>notes.get(note.trim())?.[day]==='1';
   if(!running.some(r=>active(r[0])))continue;
   const stops=[],occurrences=new Map();let ordinal=0,current=null,lastClock=-1,dayOffset=0;
   const time=clock=>{const mins=Number(clock.slice(0,2))*60+Number(clock.slice(2));if(mins<lastClock)dayOffset++;lastClock=mins;return localTimestamp(serviceDate,String(Number(clock.slice(0,2))+24*dayOffset).padStart(2,'0')+clock.slice(2));};
   for(const line of lines){
    if(['>','+','.','<'].includes(line[0])){
     ordinal++;const [code,...times]=line.slice(1).split(',').map(x=>x.trim());
     const arrival=line[0]==='>'?null:time(times[0]);
     const departure=line[0]==='<'?null:line[0]==='.'?arrival:time(times.at(-1));
     if(ordinal<first||ordinal>last){current=null;continue;}
     const occurrence=(occurrences.get(code)||0)+1;occurrences.set(code,occurrence);
     current={id:code.toUpperCase()+'#'+occurrence,stationCode:code.toUpperCase(),station:stations.get(code)||code,sequence:stops.length+1,arrival:arrival?{plannedTime:arrival,plannedPlatform:null}:null,departure:departure?{plannedTime:departure,plannedPlatform:null}:null};stops.push(current);
    }else if(line[0]==='?'&&current){const [a,v,note]=line.slice(1).split(',').map(x=>x.trim());if(active(note)){if(current.arrival)current.arrival.plannedPlatform=a||null;if(current.departure)current.departure.plannedPlatform=v||null;}}
   }
   if(stops.length)results.push({trainNumber:number,serviceDate,category,source:'NDOV_IFF',sourceTimestamp,completePlan:true,stops});
  }
 }
 const seen=new Set();for(const r of results){const k=key(r.trainNumber,r.serviceDate);if(seen.has(k))throw Error('Ambiguous IFF variants for '+k);seen.add(k);}
 return results;
}

function products(value){if(!value||typeof value!=='object')return [];if(value.ReisInformatieProductRitInfo)return list(value.ReisInformatieProductRitInfo);return Object.values(value).flatMap(products);}
export function parseRitJourneys(parsed,selected){
 const wanted=new Set(selected.map(String)),out=[];
 for(const product of products(parsed)){
  const rit=product.RitInfo;if(!rit||!wanted.has(text(rit.TreinNummer)))continue;
  const stops=[],seen=new Map();
  for(const logical of list(rit.LogischeRit))for(const part of list(logical.LogischeRitDeel))for(const s of list(part.LogischeRitDeelStation)){
   const code=text(s.Station?.StationCode).toUpperCase();if(!code)continue;
   const arrivalTime=stamp(variant(s.AankomstTijd,'Gepland')),departureTime=stamp(variant(s.VertrekTijd,'Gepland'));
   const plannedStop=variant(s.Stopt,'Gepland'),actualStop=variant(s.Stopt,'Actueel');
   if(text(plannedStop)==='N'&&text(actualStop)!=='J')continue;
   // Adjacent logical parts can describe the same physical boundary stop.
   let stop=stops.at(-1);
   if(!stop||stop.stationCode!==code){const n=(seen.get(code)||0)+1;seen.set(code,n);stop={id:code+'#'+n,stationCode:code,station:text(s.Station.LangeNaam)||code,sequence:stops.length+1,arrival:null,departure:null};stops.push(stop);}
   const changes=[...list(logical.Wijziging),...list(part.Wijziging),...list(s.Wijziging)].map(w=>text(w.WijzigingType));
   for(const [mode,timeField,trackField,plannedTime,cancelCode]of [['arrival','AankomstTijd','TreinAankomstSpoor',arrivalTime,'39'],['departure','VertrekTijd','TreinVertrekSpoor',departureTime,'32']]){
    const expectedTime=stamp(variant(s[timeField],'Actueel'));if(!plannedTime&&!expectedTime)continue;
    const platform=x=>x?[text(x.SpoorNummer),text(x.SpoorFase??x.Spoorfase)].join('')||null:null;
    stop[mode]={plannedTime,plannedPlatform:platform(variant(s[trackField],'Gepland')),realtime:true,expectedTime,currentPlatform:platform(variant(s[trackField],'Actueel')),cancelled:changes.includes('25')||changes.includes(cancelCode)||text(actualStop)==='N'};
   }
  }
  const sourceTimestamp=stamp(product['@_TimeStamp']);
  if(stops.length&&sourceTimestamp)out.push({trainNumber:text(rit.TreinNummer),serviceDate:text(rit.TreinDatum),category:text(rit.TreinSoort?.['@_Code']),source:'NDOV_RIT',sourceTimestamp,completePlan:false,stops});
 }
 return out;
}

let importing=false;
export async function importJourneyPlanning(selected){
 if(importing||!selected.length)return;importing=true;journeyImportState.lastAttempt=new Date().toISOString();journeyImportState.status='importing';
 try{
  const response=await fetch('https://data.ndovloket.nl/ns/ns-latest.zip',{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('IFF HTTP '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>30*1024*1024)throw Error('IFF archive too large');
  const {unzipSync}=await import('fflate');
  const required=['delivery.dat','footnote.dat','stations.dat','timetbls.dat'];
  const files=unzipSync(bytes,{filter:file=>required.includes(file.name)&&file.originalSize<100*1024*1024});
  if(required.some(f=>!files[f]))throw Error('Incomplete IFF archive');
  const publication=stamp(response.headers.get('last-modified'));if(!publication)throw Error('IFF publication timestamp missing');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const journeys=parseIff(files,selected,today,publication);
  for(const journey of journeys)await recordJourneySnapshot(journey);
  Object.assign(journeyImportState,{status:'ready',lastSuccess:new Date().toISOString(),error:null,journeys:journeys.length,publication:new Date(publication).toISOString()});
 }catch(e){journeyImportState.status='error';journeyImportState.error=String(e.message).slice(0,250);console.error('Journey planning:',e.message);}
 finally{importing=false;}
}
export function startJourneyPlanning(selected){void importJourneyPlanning(selected);setInterval(()=>void importJourneyPlanning(selected),6*3600000).unref();}

export const journeyPage=`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ritarchief Treinrondreis</title><style>body{font:15px system-ui;color:#252525;max-width:1200px;margin:24px auto;padding:0 16px}h1{color:#e5303c}form{display:flex;flex-wrap:wrap;gap:12px;align-items:end}label{display:grid;gap:4px}input,button{font:inherit;padding:8px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:9px;text-align:left;border-bottom:1px solid #ddd}th{background:#faf8f5}.scroll{overflow-x:auto}small{display:block;color:#666}#status{min-height:24px}</style><h1>Ritarchief</h1><form><label>Treinnummer<input name="train" value="225" inputmode="numeric" pattern="[0-9]+" required></label><label>Datum<input name="date" type="date" required></label><button>Toon rit</button></form><p>Eerste planning blijft bewaard. Actueel is een verwachting; gerealiseerd wordt alleen ingevuld na bevestiging door een bron. Spoor staat onder de tijd.</p><p id="status"></p><div class="scroll"><table><thead><tr><th>Station</th><th>A./V.</th><th>Eerste planning</th><th>Laatste planning</th><th>Actueel</th><th>Gerealiseerd</th></tr></thead><tbody></tbody></table></div><script>
const form=document.querySelector('form'),params=new URLSearchParams(location.search);form.train.value=params.get('train')||'225';form.date.value=params.get('date')||new Date().toLocaleDateString('en-CA');
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function cell(value,realtime=false){if(!value)return '—';const t=realtime?value.expectedTime:value.time;return (t?new Date(t).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}):'—')+(value.platform?'<small>spoor '+esc(value.platform)+'</small>':'')+(value.cancelled?'<small>Geannuleerd</small>':'');}
async function load(){const q=new URLSearchParams(new FormData(form));history.replaceState(null,'','?'+q);document.getElementById('status').textContent='Laden…';document.querySelector('tbody').innerHTML='';try{const r=await fetch('/api/journeys/'+encodeURIComponent(form.train.value)+'?date='+encodeURIComponent(form.date.value));const p=await r.json();if(!r.ok)throw Error(p.error);document.getElementById('status').textContent=p.category+' '+p.trainNumber+' · '+p.serviceDate+' · '+p.stops.length+' stops';document.querySelector('tbody').innerHTML=p.stops.flatMap(s=>['arrival','departure'].filter(m=>s[m]).map(m=>'<tr><td>'+esc(s.station)+(s.inLatestPlan===false?'<small>Niet in laatste dienstregeling</small>':'')+'</td><td>'+(m==='arrival'?'A.':'V.')+'</td><td>'+cell(s[m].original)+'</td><td>'+cell(s[m].planning)+'</td><td>'+cell(s[m].realtime,true)+'</td><td>'+cell(s[m].realized)+'</td></tr>')).join('');}catch(e){document.getElementById('status').textContent=e.message;}}
form.addEventListener('submit',e=>{e.preventDefault();load()});load();</script></html>`;
