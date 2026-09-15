import {createHash} from 'node:crypto';
import {stationKey,connectionDate,relevantEvent,setConnectionRules,defaultConnectionRules} from './connections-rules.mjs';
let db=null;
const hash=s=>createHash('sha256').update(s).digest('hex');
async function query(sql,args=[]){if(db.pool)return (await db.pool.query(sql,args)).rows;const bound=[];const text=sql.replace(/\$(\d+)/g,(_,n)=>{bound.push(args[Number(n)-1]);return '?';});return db.sqlite.prepare(text).all(...bound);}
export async function initConnections(connection){
 db=connection;
 const sql=`CREATE TABLE IF NOT EXISTS connection_settings(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS connection_events (event_key TEXT PRIMARY KEY,event_date TEXT NOT NULL,station TEXT NOT NULL,seen_at BIGINT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS connection_events_day ON connection_events(event_date,station);
 CREATE TABLE IF NOT EXISTS connection_plan_hours (station TEXT NOT NULL,hour_start BIGINT NOT NULL,seen_at BIGINT NOT NULL,PRIMARY KEY(station,hour_start));
 CREATE TABLE IF NOT EXISTS connection_assessments (connection_key TEXT PRIMARY KEY,event_date TEXT NOT NULL,rule_id TEXT NOT NULL,station TEXT NOT NULL,revision INTEGER NOT NULL,state_hash TEXT NOT NULL,updated_at BIGINT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS connection_assessments_day ON connection_assessments(event_date);
 CREATE TABLE IF NOT EXISTS connection_revisions (connection_key TEXT NOT NULL,revision INTEGER NOT NULL,recorded_at BIGINT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(connection_key,revision));`;
 if(db.pool)await db.pool.query(sql);else db.sqlite.exec(sql);
 const settings=await readConnectionSettings();setConnectionRules(settings.rules,settings.revision);
}
export function normalizeConnectionEvent(t,source,seenAt){
 const station=stationKey(t.observedAt||t.station),number=String(t.number||t.trainNumber||''),category=String(t.category||'').toUpperCase(),planned=Number(t.plannedTimestamp),mode=t.eventMode||t.mode;
 if(!station||!Number.isFinite(planned)||planned<=0||!['arrival','departure'].includes(mode)||!relevantEvent(station,number,category))return null;
 if((station==='milano'&&source!=='ViaggiaTreno')||(station!=='milano'&&!['DB','DB_PLAN'].includes(source)))return null;
 const date=connectionDate(planned),actual=Number(t.actualTimestamp)||null,expected=Number(t.expectedTimestamp)||null;
 const id=String(t.sourceEventId||t.id||[number,planned].join('|'));
 return {key:hash([source,date,station,number,category,mode,id].join('|')),id,date,station,stationName:t.observedAt||t.station,number,category,source,serviceDate:t.serviceDate||null,mode,planned,expected,actual,realtime:t.hasRealtime===true||actual!==null,seenAt:Number(seenAt),plannedTrack:String(t.plannedTrack||''),currentTrack:String(t.currentTrack||t.track||''),cancelled:!!t.cancelled,origin:String(t.from||t.origin||''),destination:String(t.to||t.destination||'')};
}
export async function recordConnectionEvents(trains,source,seenAt=Date.now()){
 if(!db||!['DB','DB_PLAN','ViaggiaTreno'].includes(source))return;
 const oldest=connectionDate(seenAt-3*86400000),latest=connectionDate(seenAt+3*86400000);
 for(const t of trains){const e=normalizeConnectionEvent(t,source,seenAt);if(!e||e.date<oldest||e.date>latest)continue;
 await query('INSERT INTO connection_events(event_key,event_date,station,seen_at,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO UPDATE SET seen_at=excluded.seen_at,payload=excluded.payload WHERE connection_events.seen_at<=excluded.seen_at RETURNING event_key',[e.key,e.date,e.station,e.seenAt,JSON.stringify(e)]);
 }
}
export async function recordConnectionPlanHour(name,hourStart){
 let station=stationKey(name);if(!db||!station||!Number.isFinite(hourStart))return;
 if(station==='berlin')station=name.includes('(tief)')?'berlin-lower':'berlin-upper';
 await query('INSERT INTO connection_plan_hours(station,hour_start,seen_at) VALUES($1,$2,$3) ON CONFLICT(station,hour_start) DO UPDATE SET seen_at=excluded.seen_at RETURNING station',[station,hourStart,Date.now()]);
}
export async function connectionInputs(date){
 const events=(await query('SELECT payload FROM connection_events WHERE event_date=$1',[date])).map(r=>JSON.parse(r.payload));
 const coverage=await query('SELECT station,hour_start FROM connection_plan_hours WHERE hour_start>=$1 AND hour_start<$2',[Date.parse(date+'T00:00:00Z')-3*3600000,Date.parse(date+'T00:00:00Z')+25*3600000]);
 const required=[];for(let t=Date.parse(date+'T00:00:00Z')-3*3600000;t<Date.parse(date+'T00:00:00Z')+25*3600000;t+=3600000)if(connectionDate(t)===date)required.push(t);
 const complete=new Set();for(const station of new Set(coverage.map(r=>r.station))){const have=new Set(coverage.filter(r=>r.station===station).map(r=>Number(r.hour_start)));if(required.every(t=>have.has(t)))complete.add(station);}
 if(complete.has('berlin-lower')&&complete.has('berlin-upper'))complete.add('berlin');
 return {events,completeStations:complete};
}
function signature(result){return hash(JSON.stringify(result,(key,value)=>['evaluatedAt','seenAt','lastKnown','revision','updatedAt'].includes(key)?undefined:value));}
function saveWith(result,old){
 const value={...result};if(['feasible','uncertain','missed'].includes(value.status)&&value.eligible)value.lastKnown={status:value.status,minutes:value.minutes,evidence:value.evidence,at:value.evaluatedAt,incomingSeenAt:value.incoming?.seenAt,outgoingSeenAt:value.outgoing?.seenAt};else if(old)value.lastKnown=JSON.parse(old.payload).lastKnown||null;
 return value;
}
export async function saveConnectionAssessment(result){
 const key=[result.date,result.ruleId,result.station,result.alternativeFor||'primary'].join('|'),stateHash=signature(result),now=result.evaluatedAt;
 if(db.pool){const client=await db.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);const old=(await client.query('SELECT * FROM connection_assessments WHERE connection_key=$1',[key])).rows[0];if(old&&Number(old.updated_at)>now){await client.query('COMMIT');return;}const changed=!old||old.state_hash!==stateHash,revision=Number(old?.revision||0)+(changed?1:0),payload=JSON.stringify(saveWith(result,old));
 await client.query('INSERT INTO connection_assessments VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(connection_key) DO UPDATE SET revision=excluded.revision,state_hash=excluded.state_hash,updated_at=excluded.updated_at,payload=excluded.payload',[key,result.date,result.ruleId,result.station,revision,stateHash,now,payload]);
 if(changed)await client.query('INSERT INTO connection_revisions VALUES($1,$2,$3,$4)',[key,revision,now,payload]);await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 else{db.sqlite.exec('BEGIN');try{const old=db.sqlite.prepare('SELECT * FROM connection_assessments WHERE connection_key=?').get(key);if(old&&Number(old.updated_at)>now){db.sqlite.exec('COMMIT');return;}const changed=!old||old.state_hash!==stateHash,revision=Number(old?.revision||0)+(changed?1:0),payload=JSON.stringify(saveWith(result,old));db.sqlite.prepare('INSERT INTO connection_assessments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(connection_key) DO UPDATE SET revision=excluded.revision,state_hash=excluded.state_hash,updated_at=excluded.updated_at,payload=excluded.payload').run(key,result.date,result.ruleId,result.station,revision,stateHash,now,payload);if(changed)db.sqlite.prepare('INSERT INTO connection_revisions VALUES(?,?,?,?)').run(key,revision,now,payload);db.sqlite.exec('COMMIT');}catch(e){db.sqlite.exec('ROLLBACK');throw e;}}
}
export async function readConnections(date){return (await query('SELECT connection_key,revision,updated_at,payload FROM connection_assessments WHERE event_date=$1 ORDER BY rule_id,station',[date])).map(r=>({key:r.connection_key,revision:Number(r.revision),updatedAt:Number(r.updated_at),...JSON.parse(r.payload)}));}
export async function readConnectionRevisions(key,{before=2147483647,limit=200}={}){return (await query('SELECT revision,recorded_at,payload FROM connection_revisions WHERE connection_key=$1 AND revision<$2 ORDER BY revision DESC LIMIT $3',[key,before,limit])).map(r=>({revision:Number(r.revision),recordedAt:Number(r.recorded_at),...JSON.parse(r.payload)}));}
export async function cleanConnectionWorkingData(now=Date.now()){
 await query('DELETE FROM connection_events WHERE event_date<$1 RETURNING event_key',[connectionDate(now-7*86400000)]);
 await query('DELETE FROM connection_plan_hours WHERE hour_start<$1 RETURNING station',[now-7*86400000]);
}

export async function readConnectionSettings(){const row=(await query('SELECT revision,payload FROM connection_settings WHERE id=1'))[0];return row?{revision:Number(row.revision),rules:JSON.parse(row.payload)}:{revision:0,rules:structuredClone(defaultConnectionRules)};}
export async function writeConnectionSettings(rules,revision){const row=(await query('INSERT INTO connection_settings(id,revision,payload) VALUES(1,1,$1) ON CONFLICT(id) DO UPDATE SET revision=connection_settings.revision+1,payload=excluded.payload WHERE connection_settings.revision=$2 RETURNING revision',[JSON.stringify(rules),revision]))[0];if(!row){const e=Error('De instellingen zijn ondertussen gewijzigd. Laad de pagina opnieuw.');e.status=409;throw e;}setConnectionRules(rules,Number(row.revision));return {revision:Number(row.revision),rules};}
export async function readConnectionPeriod(from,to,rule=''){const args=[from,to];let condition='event_date >= $1 AND event_date <= $2';if(rule){args.push(rule);condition+=' AND rule_id=$3'}const records=await query('SELECT connection_key,revision,updated_at,payload FROM connection_assessments WHERE '+condition+' ORDER BY event_date,rule_id,station LIMIT 5001',args);if(records.length>5000)throw Object.assign(Error('Kies een kortere periode of één aansluiting.'),{status:400});return records.map(r=>({key:r.connection_key,revision:Number(r.revision),updatedAt:Number(r.updated_at),...JSON.parse(r.payload)}));}
