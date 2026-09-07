import { createHash } from "node:crypto";

let backend="uninitialized";
let pool=null;
let sqlite=null;

const migrationState={
  name:"v4_legacy_train_observations",
  status:"pending",
  migratedRows:0,
  skippedRows:0,
  lastLegacyId:0,
  resumeFromId:0,
  startedAt:null,
  finishedAt:null,
  error:null
};

const SOURCE_CATALOG=[
  {
    sourceId:"DB",name:"DB Timetables",kind:"realtime",adapterStatus:"active",
    countries:["DE","NL","AT","CH"],timeZone:"Europe/Berlin",
    planningPriority:90,realtimePriority:100,platformPriority:100
  },
  {
    sourceId:"ViaggiaTreno",name:"ViaggiaTreno",kind:"realtime",adapterStatus:"active",
    countries:["IT"],timeZone:"Europe/Rome",
    planningPriority:80,realtimePriority:90,platformPriority:90
  },
  {
    sourceId:"DELFI_GTFS",name:"DELFI GTFS (Mobilithek)",kind:"planning",adapterStatus:"planned",
    countries:["DE"],timeZone:"Europe/Berlin",
    planningPriority:100,realtimePriority:0,platformPriority:20
  },
  {
    sourceId:"DELFI_GTFS_RT",name:"DELFI GTFS-RT (Mobilithek)",kind:"realtime",adapterStatus:"planned",
    countries:["DE"],timeZone:"Europe/Berlin",
    planningPriority:30,realtimePriority:95,platformPriority:75
  },
  {
    sourceId:"SNCB",name:"SNCB/NMBS Open Data",kind:"planning+realtime",adapterStatus:"planned",
    countries:["BE","NL"],timeZone:"Europe/Brussels",
    planningPriority:95,realtimePriority:95,platformPriority:90
  },
  {
    sourceId:"SNCF_GTFS",name:"SNCF GTFS",kind:"planning",adapterStatus:"planned",
    countries:["FR"],timeZone:"Europe/Paris",
    planningPriority:100,realtimePriority:0,platformPriority:20
  },
  {
    sourceId:"SNCF_GTFS_RT",name:"SNCF GTFS-RT",kind:"realtime",adapterStatus:"planned",
    countries:["FR"],timeZone:"Europe/Paris",
    planningPriority:30,realtimePriority:100,platformPriority:85
  },
  {
    sourceId:"DARWIN",name:"National Rail Darwin",kind:"realtime",adapterStatus:"planned",
    countries:["GB"],timeZone:"Europe/London",
    planningPriority:90,realtimePriority:100,platformPriority:100
  }
];

function sha(value){
  return createHash("sha256").update(String(value)).digest("hex");
}

function clean(v){
  return v===null||v===undefined?"":String(v).trim();
}

function asJson(v){
  if(v===null||v===undefined)return null;
  if(typeof v==="string"){
    try{return JSON.parse(v);}catch{return v;}
  }
  return v;
}

function jsonText(v){
  return JSON.stringify(v===undefined?null:v);
}

const DATAHUB_HEARTBEAT_MINUTES=Math.max(
  15,
  Number(process.env.DATAHUB_HEARTBEAT_MINUTES||180)
);
const DATAHUB_HEARTBEAT_MS=DATAHUB_HEARTBEAT_MINUTES*60*1000;
const FERNVERKEHR_CATEGORIES=(String(process.env.FERNVERKEHR_CATEGORIES||"ICE,IC,EC,ECE,TGV,RJ,RJX,NJ,EN,D,WB,WEST,FLX"))
  .split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
const DB_RETENTION_SOURCES=["DB","DB_PLAN"];

function previousDateKey(value){
  const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return "";
  const dt=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])-1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
}

function stableValue(v){
  if(Array.isArray(v))return v.map(stableValue);
  if(v&&typeof v==="object"){
    const out={};
    for(const key of Object.keys(v).sort()){
      const value=v[key];
      if(value!==undefined)out[key]=stableValue(value);
    }
    return out;
  }
  return v;
}
function stableJson(v){return JSON.stringify(stableValue(v===undefined?null:v));}
function rawSourcePayload(t){
  if(t?.rawData!==undefined&&t.rawData!==null)return t.rawData;
  if(t?.rawStop!==undefined&&t.rawStop!==null)return t.rawStop;
  if(t?.rawPayload!==undefined&&t.rawPayload!==null)return t.rawPayload;
  return t;
}

function sourceDefinition(sourceId){
  return SOURCE_CATALOG.find(s=>s.sourceId===sourceId)||{
    sourceId,name:sourceId,kind:"unknown",adapterStatus:"external",countries:[],timeZone:"UTC",
    planningPriority:50,realtimePriority:50,platformPriority:50
  };
}

function dateKey(ms,timeZone="UTC"){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0)return "";
  return new Intl.DateTimeFormat("en-CA",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date(n));
}

function dbServiceDateFromStopId(id=""){
  const m=String(id).match(/-(\d{2})(\d{2})(\d{2})\d{4}-\d+$/);
  if(!m)return "";
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

function inferServiceDate(t,sourceId,plannedTs){
  const explicit=clean(t.serviceDate);
  if(/^\d{4}-\d{2}-\d{2}$/.test(explicit))return explicit;

  if(sourceId==="DB"){
    const rawId=t?.rawStop?.id||t?.payload?.rawStop?.id||t?.sourceEventId||"";
    const fromId=dbServiceDateFromStopId(rawId);
    if(fromId)return fromId;
  }

  return dateKey(plannedTs,sourceDefinition(sourceId).timeZone);
}

function normalizeCountry(v){
  const s=clean(v).toUpperCase();
  return /^[A-Z]{2}$/.test(s)?s:"";
}

function canonicalRow(t,sourceId,defaultObservedAt){
  const plannedTs=Number(t.plannedTimestamp||0)||null;
  const expectedTs=Number(t.expectedTimestamp||0) || (
    plannedTs ? plannedTs + Number(t.delay||0)*60000 : null
  );
  const actualTs=Number(t.actualTimestamp||0)||null;
  const observedAt=Number(t._observedAt||defaultObservedAt||Date.now());
  const trainNumber=clean(t.number||t.trainNumber);
  const category=clean(t.category);
  const sourceTripId=clean(t.sourceTripId)||`${category}|${trainNumber}`;
  const serviceDate=inferServiceDate(t,sourceId,plannedTs||expectedTs||observedAt);
  const origin=clean(t.from||t.origin);
  const destination=clean(t.to||t.destination);
  const serviceUid=sha([sourceId,serviceDate,sourceTripId,origin,destination].join("|"));
  const stationName=clean(t.observedAt||t.station);
  const eventMode=clean(t.eventMode||t.mode);
  const sourceEventId=clean(t.sourceEventId||t.rawStop?.id||t.id||t.trainKey);
  const plannedPlatform=clean(t.plannedTrack||t.plannedPlatform);
  const currentPlatform=clean(t.currentTrack||t.currentPlatform||t.track);
  const route=Array.isArray(t.route)?t.route:[];
  const pastRoute=Array.isArray(t.pastRoute)?t.pastRoute:[];
  const futureRoute=Array.isArray(t.futureRoute)?t.futureRoute:[];
  const rawSource=rawSourcePayload(t);
  const rawPayload=t._legacyId?{_legacyId:Number(t._legacyId),data:rawSource}:rawSource;

  const stateForHash={
    serviceDate,trainNumber,category,stationName,eventMode,sourceEventId,
    plannedTimestamp:plannedTs,expectedTimestamp:expectedTs,actualTimestamp:actualTs,
    plannedPlatform,currentPlatform,delayMinutes:Number(t.delay||t.delayMinutes||0),
    status:clean(t.status),cancelled:Boolean(t.cancelled),origin,destination,
    route,pastRoute,futureRoute
  };
  const eventKey=sha([sourceId,serviceUid,stationName,eventMode,sourceEventId].join("|"));
  const stateHash=sha(stableJson(stateForHash));
  const rawHash=sha(stableJson(rawSource));

  return {
    serviceUid,eventKey,stateHash,rawHash,
    sourceId,sourceTripId,serviceDate,trainNumber,category,
    operator:clean(t.operator),operatorCode:clean(t.operatorCode),origin,destination,
    observedAt,sourceEventId,stationName,stationCode:clean(t.stationCode),
    countryCode:normalizeCountry(t.countryCode),eventMode,
    plannedTimestamp:plannedTs,expectedTimestamp:expectedTs,actualTimestamp:actualTs,
    plannedPlatform,currentPlatform,delayMinutes:Number(t.delay||t.delayMinutes||0),
    status:clean(t.status),cancelled:Boolean(t.cancelled),route,pastRoute,futureRoute,rawPayload
  };
}

async function pgSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_sources (
      source_id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'unknown',
      adapter_status TEXT NOT NULL DEFAULT 'planned',countries JSONB NOT NULL DEFAULT '[]'::jsonb,
      timezone TEXT NOT NULL DEFAULT 'UTC',planning_priority INTEGER NOT NULL DEFAULT 50,
      realtime_priority INTEGER NOT NULL DEFAULT 50,platform_priority INTEGER NOT NULL DEFAULT 50,
      first_seen_at BIGINT,last_seen_at BIGINT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS ingest_batches (
      batch_uid TEXT PRIMARY KEY,source_id TEXT NOT NULL,observed_at BIGINT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,warning_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS service_runs (
      service_uid TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_trip_id TEXT,service_date TEXT NOT NULL,
      train_number TEXT,category TEXT,operator TEXT,operator_code TEXT,origin TEXT,destination TEXT,
      first_seen_at BIGINT NOT NULL,last_seen_at BIGINT NOT NULL,metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS event_observations (
      observation_uid TEXT PRIMARY KEY,batch_uid TEXT,service_uid TEXT NOT NULL,source_id TEXT NOT NULL,
      service_date TEXT NOT NULL,train_number TEXT,category TEXT,source_event_id TEXT,
      station_name TEXT NOT NULL DEFAULT '',station_code TEXT,country_code TEXT,event_mode TEXT NOT NULL DEFAULT '',
      observed_at BIGINT NOT NULL,planned_timestamp BIGINT,expected_timestamp BIGINT,actual_timestamp BIGINT,
      planned_platform TEXT,current_platform TEXT,delay_minutes INTEGER NOT NULL DEFAULT 0,status_text TEXT,
      cancelled BOOLEAN NOT NULL DEFAULT FALSE,origin TEXT,destination TEXT,
      route JSONB NOT NULL DEFAULT '[]'::jsonb,past_route JSONB NOT NULL DEFAULT '[]'::jsonb,
      future_route JSONB NOT NULL DEFAULT '[]'::jsonb,raw_payload JSONB,
      state_hash TEXT,raw_hash TEXT,observation_kind TEXT NOT NULL DEFAULT 'change'
    );
    ALTER TABLE event_observations ADD COLUMN IF NOT EXISTS state_hash TEXT;
    ALTER TABLE event_observations ADD COLUMN IF NOT EXISTS raw_hash TEXT;
    ALTER TABLE event_observations ADD COLUMN IF NOT EXISTS observation_kind TEXT NOT NULL DEFAULT 'change';

    CREATE TABLE IF NOT EXISTS event_current_state (
      event_key TEXT PRIMARY KEY,source_id TEXT NOT NULL,service_uid TEXT NOT NULL,
      station_name TEXT NOT NULL DEFAULT '',event_mode TEXT NOT NULL DEFAULT '',source_event_id TEXT,
      state_hash TEXT NOT NULL,raw_hash TEXT NOT NULL,last_seen_at BIGINT NOT NULL,
      last_observation_at BIGINT NOT NULL,last_payload_at BIGINT,last_observation_uid TEXT
    );
    CREATE TABLE IF NOT EXISTS migration_event_state (
      migration_name TEXT NOT NULL,event_key TEXT NOT NULL,state_hash TEXT NOT NULL,raw_hash TEXT NOT NULL,
      last_observation_at BIGINT NOT NULL,last_payload_at BIGINT,
      PRIMARY KEY(migration_name,event_key)
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,completed_at BIGINT NOT NULL,metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS migration_progress (
      migration_name TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',last_legacy_id BIGINT NOT NULL DEFAULT 0,
      migrated_rows BIGINT NOT NULL DEFAULT 0,skipped_rows BIGINT NOT NULL DEFAULT 0,started_at BIGINT,
      updated_at BIGINT NOT NULL,last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS migration_errors (
      id BIGSERIAL PRIMARY KEY,migration_name TEXT NOT NULL,legacy_id BIGINT,source TEXT,
      error_text TEXT NOT NULL,created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_service_runs_date_train ON service_runs(service_date,train_number,source_id);
    CREATE INDEX IF NOT EXISTS idx_service_runs_seen ON service_runs(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_train_date ON event_observations(service_date,train_number,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_station ON event_observations(station_name,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_service ON event_observations(service_uid,station_name,event_mode,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_source ON event_observations(source_id,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_retention ON event_observations(source_id,service_date,category);
    CREATE INDEX IF NOT EXISTS idx_service_runs_retention ON service_runs(source_id,service_date,category);
    CREATE INDEX IF NOT EXISTS idx_event_state_seen ON event_current_state(source_id,last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_migration_errors_name ON migration_errors(migration_name,legacy_id);
  `);
}

function sqliteSchema(){
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS data_sources (
      source_id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'unknown',
      adapter_status TEXT NOT NULL DEFAULT 'planned',countries TEXT NOT NULL DEFAULT '[]',timezone TEXT NOT NULL DEFAULT 'UTC',
      planning_priority INTEGER NOT NULL DEFAULT 50,realtime_priority INTEGER NOT NULL DEFAULT 50,
      platform_priority INTEGER NOT NULL DEFAULT 50,first_seen_at INTEGER,last_seen_at INTEGER,metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS ingest_batches (
      batch_uid TEXT PRIMARY KEY,source_id TEXT NOT NULL,observed_at INTEGER NOT NULL,item_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS service_runs (
      service_uid TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_trip_id TEXT,service_date TEXT NOT NULL,
      train_number TEXT,category TEXT,operator TEXT,operator_code TEXT,origin TEXT,destination TEXT,
      first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS event_observations (
      observation_uid TEXT PRIMARY KEY,batch_uid TEXT,service_uid TEXT NOT NULL,source_id TEXT NOT NULL,
      service_date TEXT NOT NULL,train_number TEXT,category TEXT,source_event_id TEXT,
      station_name TEXT NOT NULL DEFAULT '',station_code TEXT,country_code TEXT,event_mode TEXT NOT NULL DEFAULT '',
      observed_at INTEGER NOT NULL,planned_timestamp INTEGER,expected_timestamp INTEGER,actual_timestamp INTEGER,
      planned_platform TEXT,current_platform TEXT,delay_minutes INTEGER NOT NULL DEFAULT 0,status_text TEXT,
      cancelled INTEGER NOT NULL DEFAULT 0,origin TEXT,destination TEXT,route TEXT NOT NULL DEFAULT '[]',
      past_route TEXT NOT NULL DEFAULT '[]',future_route TEXT NOT NULL DEFAULT '[]',raw_payload TEXT,
      state_hash TEXT,raw_hash TEXT,observation_kind TEXT NOT NULL DEFAULT 'change'
    );
    CREATE TABLE IF NOT EXISTS event_current_state (
      event_key TEXT PRIMARY KEY,source_id TEXT NOT NULL,service_uid TEXT NOT NULL,
      station_name TEXT NOT NULL DEFAULT '',event_mode TEXT NOT NULL DEFAULT '',source_event_id TEXT,
      state_hash TEXT NOT NULL,raw_hash TEXT NOT NULL,last_seen_at INTEGER NOT NULL,
      last_observation_at INTEGER NOT NULL,last_payload_at INTEGER,last_observation_uid TEXT
    );
    CREATE TABLE IF NOT EXISTS migration_event_state (
      migration_name TEXT NOT NULL,event_key TEXT NOT NULL,state_hash TEXT NOT NULL,raw_hash TEXT NOT NULL,
      last_observation_at INTEGER NOT NULL,last_payload_at INTEGER,PRIMARY KEY(migration_name,event_key)
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,completed_at INTEGER NOT NULL,metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS migration_progress (
      migration_name TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',last_legacy_id INTEGER NOT NULL DEFAULT 0,
      migrated_rows INTEGER NOT NULL DEFAULT 0,skipped_rows INTEGER NOT NULL DEFAULT 0,started_at INTEGER,
      updated_at INTEGER NOT NULL,last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS migration_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,migration_name TEXT NOT NULL,legacy_id INTEGER,source TEXT,
      error_text TEXT NOT NULL,created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_service_runs_date_train ON service_runs(service_date,train_number,source_id);
    CREATE INDEX IF NOT EXISTS idx_service_runs_seen ON service_runs(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_train_date ON event_observations(service_date,train_number,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_station ON event_observations(station_name,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_service ON event_observations(service_uid,station_name,event_mode,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_source ON event_observations(source_id,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_retention ON event_observations(source_id,service_date,category);
    CREATE INDEX IF NOT EXISTS idx_service_runs_retention ON service_runs(source_id,service_date,category);
    CREATE INDEX IF NOT EXISTS idx_event_state_seen ON event_current_state(source_id,last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_migration_errors_name ON migration_errors(migration_name,legacy_id);
  `);
  const cols=sqlite.prepare("PRAGMA table_info(event_observations)").all().map(r=>r.name);
  if(!cols.includes("state_hash"))sqlite.exec("ALTER TABLE event_observations ADD COLUMN state_hash TEXT");
  if(!cols.includes("raw_hash"))sqlite.exec("ALTER TABLE event_observations ADD COLUMN raw_hash TEXT");
  if(!cols.includes("observation_kind"))sqlite.exec("ALTER TABLE event_observations ADD COLUMN observation_kind TEXT NOT NULL DEFAULT 'change'");
}

async function seedSources(){
  if(backend==="postgresql"){
    const sql=`
      INSERT INTO data_sources (
        source_id,name,kind,adapter_status,countries,timezone,
        planning_priority,realtime_priority,platform_priority,metadata
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT(source_id) DO UPDATE SET
        name=EXCLUDED.name,kind=EXCLUDED.kind,adapter_status=EXCLUDED.adapter_status,
        countries=EXCLUDED.countries,timezone=EXCLUDED.timezone,
        planning_priority=EXCLUDED.planning_priority,
        realtime_priority=EXCLUDED.realtime_priority,
        platform_priority=EXCLUDED.platform_priority,
        metadata=EXCLUDED.metadata
    `;
    for(const s of SOURCE_CATALOG){
      await pool.query(sql,[
        s.sourceId,s.name,s.kind,s.adapterStatus,JSON.stringify(s.countries),s.timeZone,
        s.planningPriority,s.realtimePriority,s.platformPriority,JSON.stringify({})
      ]);
    }
  }else{
    const stmt=sqlite.prepare(`
      INSERT INTO data_sources (
        source_id,name,kind,adapter_status,countries,timezone,
        planning_priority,realtime_priority,platform_priority,metadata
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET
        name=excluded.name,kind=excluded.kind,adapter_status=excluded.adapter_status,
        countries=excluded.countries,timezone=excluded.timezone,
        planning_priority=excluded.planning_priority,
        realtime_priority=excluded.realtime_priority,
        platform_priority=excluded.platform_priority,
        metadata=excluded.metadata
    `);
    for(const s of SOURCE_CATALOG){
      stmt.run(
        s.sourceId,s.name,s.kind,s.adapterStatus,JSON.stringify(s.countries),s.timeZone,
        s.planningPriority,s.realtimePriority,s.platformPriority,JSON.stringify({})
      );
    }
  }
}

async function inferLegacyProgress(){
  if(backend==="postgresql"){
    const r=await pool.query(`
      SELECT
        COALESCE(MAX(CASE
          WHEN jsonb_typeof(raw_payload)='object' AND raw_payload ? '_legacyId'
           AND (raw_payload->>'_legacyId') ~ '^[0-9]+$'
          THEN (raw_payload->>'_legacyId')::bigint END),0)::bigint AS last_id,
        COUNT(DISTINCT CASE
          WHEN jsonb_typeof(raw_payload)='object' AND raw_payload ? '_legacyId'
          THEN raw_payload->>'_legacyId' END)::bigint AS migrated
      FROM event_observations
    `);
    return {lastLegacyId:Number(r.rows[0]?.last_id||0),migratedRows:Number(r.rows[0]?.migrated||0)};
  }
  let lastLegacyId=0;const seen=new Set();
  for(const row of sqlite.prepare("SELECT raw_payload FROM event_observations WHERE raw_payload IS NOT NULL").all()){
    const p=asJson(row.raw_payload),id=Number(p?._legacyId||0);
    if(id>0){lastLegacyId=Math.max(lastLegacyId,id);seen.add(id);}
  }
  return {lastLegacyId,migratedRows:seen.size};
}

async function loadMigrationProgress(){
  let row=null;
  if(backend==="postgresql"){
    const r=await pool.query("SELECT * FROM migration_progress WHERE migration_name=$1",[migrationState.name]);
    row=r.rows[0]||null;
  }else row=sqlite.prepare("SELECT * FROM migration_progress WHERE migration_name=?").get(migrationState.name)||null;

  if(!row){
    const inferred=await inferLegacyProgress(),now=Date.now();
    if(backend==="postgresql"){
      await pool.query(`INSERT INTO migration_progress(
        migration_name,status,last_legacy_id,migrated_rows,skipped_rows,started_at,updated_at,last_error
      ) VALUES($1,'pending',$2,$3,0,NULL,$4,NULL) ON CONFLICT(migration_name) DO NOTHING`,
      [migrationState.name,inferred.lastLegacyId,inferred.migratedRows,now]);
    }else sqlite.prepare(`INSERT OR IGNORE INTO migration_progress(
      migration_name,status,last_legacy_id,migrated_rows,skipped_rows,started_at,updated_at,last_error
    ) VALUES(?,?,?,?,?,?,?,?)`).run(migrationState.name,"pending",inferred.lastLegacyId,inferred.migratedRows,0,null,now,null);
    row={status:"pending",last_legacy_id:inferred.lastLegacyId,migrated_rows:inferred.migratedRows,skipped_rows:0,started_at:null,last_error:null};
  }
  migrationState.status=row.status==="failed"?"pending":row.status;
  migrationState.lastLegacyId=Number(row.last_legacy_id||0);
  migrationState.resumeFromId=migrationState.lastLegacyId;
  migrationState.migratedRows=Number(row.migrated_rows||0);
  migrationState.skippedRows=Number(row.skipped_rows||0);
  migrationState.startedAt=row.started_at?Number(row.started_at):null;
  migrationState.error=row.last_error||null;
}

async function saveMigrationProgress({status,lastLegacyId,migratedRows,skippedRows,error=null,startedAt=null}){
  const now=Date.now();
  if(backend==="postgresql")await pool.query(`
    INSERT INTO migration_progress(migration_name,status,last_legacy_id,migrated_rows,skipped_rows,started_at,updated_at,last_error)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(migration_name) DO UPDATE SET status=EXCLUDED.status,last_legacy_id=EXCLUDED.last_legacy_id,
      migrated_rows=EXCLUDED.migrated_rows,skipped_rows=EXCLUDED.skipped_rows,
      started_at=COALESCE(migration_progress.started_at,EXCLUDED.started_at),updated_at=EXCLUDED.updated_at,last_error=EXCLUDED.last_error
  `,[migrationState.name,status,lastLegacyId,migratedRows,skippedRows,startedAt,now,error]);
  else sqlite.prepare(`
    INSERT INTO migration_progress(migration_name,status,last_legacy_id,migrated_rows,skipped_rows,started_at,updated_at,last_error)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(migration_name) DO UPDATE SET status=excluded.status,
      last_legacy_id=excluded.last_legacy_id,migrated_rows=excluded.migrated_rows,skipped_rows=excluded.skipped_rows,
      started_at=COALESCE(migration_progress.started_at,excluded.started_at),updated_at=excluded.updated_at,last_error=excluded.last_error
  `).run(migrationState.name,status,lastLegacyId,migratedRows,skippedRows,startedAt,now,error);
}

async function logMigrationError(row,error){
  const now=Date.now(),message=String(error?.message||error||"onbekende fout").slice(0,2000);
  if(backend==="postgresql")await pool.query(`INSERT INTO migration_errors(migration_name,legacy_id,source,error_text,created_at)
    VALUES($1,$2,$3,$4,$5)`,[migrationState.name,Number(row?.id||0)||null,row?.source||null,message,now]);
  else sqlite.prepare(`INSERT INTO migration_errors(migration_name,legacy_id,source,error_text,created_at) VALUES(?,?,?,?,?)`)
    .run(migrationState.name,Number(row?.id||0)||null,row?.source||null,message,now);
}
function fatalMigrationError(error){
  const msg=String(error?.message||error||"").toLowerCase(),code=String(error?.code||"");
  return msg.includes("no space left")||msg.includes("connection terminated")||msg.includes("connection refused")||
    msg.includes("timeout")||["57P01","57P02","57P03","08000","08003","08006","08001"].includes(code);
}

export async function initDataHub({backend:kind,pool:pgPool,sqlite:sqliteDb}){
  backend=kind;
  pool=pgPool||null;
  sqlite=sqliteDb||null;
  if(backend==="postgresql")await pgSchema();
  else if(backend==="sqlite")sqliteSchema();
  else throw new Error(`Data Hub: onbekende backend ${backend}`);
  await seedSources();
  await loadMigrationProgress();
  const done=await migrationCompleted();
  if(done){
    migrationState.status="completed";
    migrationState.finishedAt=Number(done.completed_at)||null;
    const meta=asJson(done.metadata)||{};
    migrationState.migratedRows=Number(meta.migratedRows||migrationState.migratedRows||0);
    migrationState.skippedRows=Number(meta.skippedRows||migrationState.skippedRows||0);
    migrationState.lastLegacyId=Number(meta.lastLegacyId||migrationState.lastLegacyId||0);
  }
  return {backend,version:"4.1",dataHubHeartbeatMinutes:DATAHUB_HEARTBEAT_MINUTES};
}

async function markSourceSeen(sourceId,observedAt,client=null){
  const s=sourceDefinition(sourceId);
  if(backend==="postgresql"){
    const db=client||pool;
    await db.query(`
      INSERT INTO data_sources (
        source_id,name,kind,adapter_status,countries,timezone,
        planning_priority,realtime_priority,platform_priority,first_seen_at,last_seen_at,metadata
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$10,$11::jsonb)
      ON CONFLICT(source_id) DO UPDATE SET
        first_seen_at=COALESCE(data_sources.first_seen_at,EXCLUDED.first_seen_at),
        last_seen_at=GREATEST(COALESCE(data_sources.last_seen_at,0),EXCLUDED.last_seen_at)
    `,[
      s.sourceId,s.name,s.kind,s.adapterStatus,JSON.stringify(s.countries),s.timeZone,
      s.planningPriority,s.realtimePriority,s.platformPriority,observedAt,JSON.stringify({})
    ]);
  }else{
    sqlite.prepare(`
      INSERT INTO data_sources (
        source_id,name,kind,adapter_status,countries,timezone,
        planning_priority,realtime_priority,platform_priority,first_seen_at,last_seen_at,metadata
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET
        first_seen_at=COALESCE(data_sources.first_seen_at,excluded.first_seen_at),
        last_seen_at=MAX(COALESCE(data_sources.last_seen_at,0),excluded.last_seen_at)
    `).run(
      s.sourceId,s.name,s.kind,s.adapterStatus,JSON.stringify(s.countries),s.timeZone,
      s.planningPriority,s.realtimePriority,s.platformPriority,observedAt,observedAt,JSON.stringify({})
    );
  }
}

async function recordPg(rows,sourceId,observedAt,{migration=false}={}){
  const client=await pool.connect(),batchUid=sha(`${sourceId}|${observedAt}`);
  const canonical=rows.map(t=>canonicalRow(t,sourceId,observedAt));
  const stateTable=migration?"migration_event_state":"event_current_state";
  const stateMap=new Map();
  try{
    await client.query("BEGIN");await markSourceSeen(sourceId,observedAt,client);
    if(canonical.length){
      const keys=[...new Set(canonical.map(r=>r.eventKey))];
      const q=migration
        ? await client.query(`SELECT * FROM ${stateTable} WHERE migration_name=$1 AND event_key=ANY($2::text[])`,[migrationState.name,keys])
        : await client.query(`SELECT * FROM ${stateTable} WHERE event_key=ANY($1::text[])`,[keys]);
      for(const row of q.rows)stateMap.set(row.event_key,row);
    }
    let persistedCount=0,suppressedCount=0,changeCount=0,rawCount=0,heartbeatCount=0;
    for(const r of canonical){
      await client.query(`INSERT INTO service_runs(service_uid,source_id,source_trip_id,service_date,train_number,category,
        operator,operator_code,origin,destination,first_seen_at,last_seen_at,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12::jsonb)
        ON CONFLICT(service_uid) DO UPDATE SET last_seen_at=GREATEST(service_runs.last_seen_at,EXCLUDED.last_seen_at),
        train_number=COALESCE(NULLIF(EXCLUDED.train_number,''),service_runs.train_number),category=COALESCE(NULLIF(EXCLUDED.category,''),service_runs.category),
        operator=COALESCE(NULLIF(EXCLUDED.operator,''),service_runs.operator),operator_code=COALESCE(NULLIF(EXCLUDED.operator_code,''),service_runs.operator_code),
        origin=COALESCE(NULLIF(EXCLUDED.origin,''),service_runs.origin),destination=COALESCE(NULLIF(EXCLUDED.destination,''),service_runs.destination)`,
        [r.serviceUid,r.sourceId,r.sourceTripId,r.serviceDate,r.trainNumber,r.category,r.operator,r.operatorCode,r.origin,r.destination,r.observedAt,JSON.stringify({})]);
      const prev=stateMap.get(r.eventKey)||null,stateChanged=!prev||prev.state_hash!==r.stateHash,rawChanged=!prev||prev.raw_hash!==r.rawHash;
      const lastObs=Number(prev?.last_observation_at||0),heartbeat=Boolean(prev)&&r.observedAt-lastObs>=DATAHUB_HEARTBEAT_MS;
      const persist=stateChanged||rawChanged||heartbeat;
      let kind=!prev?"initial":stateChanged?"change":rawChanged?"raw-change":heartbeat?"heartbeat":"suppressed";
      let observationUid=prev?.last_observation_uid||null;
      if(persist){
        observationUid=sha([r.eventKey,r.observedAt,r.stateHash,r.rawHash,kind].join("|"));
        await client.query(`INSERT INTO event_observations(observation_uid,batch_uid,service_uid,source_id,service_date,train_number,category,
          source_event_id,station_name,station_code,country_code,event_mode,observed_at,planned_timestamp,expected_timestamp,actual_timestamp,
          planned_platform,current_platform,delay_minutes,status_text,cancelled,origin,destination,route,past_route,future_route,raw_payload,state_hash,raw_hash,observation_kind)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb,$26::jsonb,$27::jsonb,$28,$29,$30)
          ON CONFLICT(observation_uid) DO NOTHING`,[observationUid,batchUid,r.serviceUid,r.sourceId,r.serviceDate,r.trainNumber,r.category,r.sourceEventId,
          r.stationName,r.stationCode,r.countryCode,r.eventMode,r.observedAt,r.plannedTimestamp,r.expectedTimestamp,r.actualTimestamp,r.plannedPlatform,r.currentPlatform,
          r.delayMinutes,r.status,r.cancelled,r.origin,r.destination,JSON.stringify(r.route),JSON.stringify(r.pastRoute),JSON.stringify(r.futureRoute),
          rawChanged?JSON.stringify(r.rawPayload):null,r.stateHash,r.rawHash,kind]);
        persistedCount++;if(stateChanged)changeCount++;else if(rawChanged)rawCount++;else heartbeatCount++;
      }else suppressedCount++;
      if(migration){
        await client.query(`INSERT INTO migration_event_state(migration_name,event_key,state_hash,raw_hash,last_observation_at,last_payload_at)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(migration_name,event_key) DO UPDATE SET state_hash=EXCLUDED.state_hash,raw_hash=EXCLUDED.raw_hash,
          last_observation_at=CASE WHEN $7 THEN EXCLUDED.last_observation_at ELSE migration_event_state.last_observation_at END,
          last_payload_at=CASE WHEN $8 THEN EXCLUDED.last_payload_at ELSE migration_event_state.last_payload_at END`,
          [migrationState.name,r.eventKey,r.stateHash,r.rawHash,persist?r.observedAt:lastObs,rawChanged?r.observedAt:Number(prev?.last_payload_at||0)||null,persist,rawChanged]);
      }else{
        await client.query(`INSERT INTO event_current_state(event_key,source_id,service_uid,station_name,event_mode,source_event_id,state_hash,raw_hash,
          last_seen_at,last_observation_at,last_payload_at,last_observation_uid) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT(event_key) DO UPDATE SET state_hash=EXCLUDED.state_hash,raw_hash=EXCLUDED.raw_hash,last_seen_at=GREATEST(event_current_state.last_seen_at,EXCLUDED.last_seen_at),
          last_observation_at=CASE WHEN $13 THEN EXCLUDED.last_observation_at ELSE event_current_state.last_observation_at END,
          last_payload_at=CASE WHEN $14 THEN EXCLUDED.last_payload_at ELSE event_current_state.last_payload_at END,
          last_observation_uid=CASE WHEN $13 THEN EXCLUDED.last_observation_uid ELSE event_current_state.last_observation_uid END`,
          [r.eventKey,r.sourceId,r.serviceUid,r.stationName,r.eventMode,r.sourceEventId,r.stateHash,r.rawHash,r.observedAt,persist?r.observedAt:lastObs,
           rawChanged?r.observedAt:Number(prev?.last_payload_at||0)||null,observationUid,persist,rawChanged]);
      }
      stateMap.set(r.eventKey,{event_key:r.eventKey,state_hash:r.stateHash,raw_hash:r.rawHash,last_seen_at:r.observedAt,
        last_observation_at:persist?r.observedAt:lastObs,last_payload_at:rawChanged?r.observedAt:Number(prev?.last_payload_at||0)||null,last_observation_uid:observationUid});
    }
    await client.query(`INSERT INTO ingest_batches(batch_uid,source_id,observed_at,item_count,metadata) VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(batch_uid) DO UPDATE SET item_count=GREATEST(ingest_batches.item_count,EXCLUDED.item_count),metadata=ingest_batches.metadata||EXCLUDED.metadata`,
      [batchUid,sourceId,observedAt,rows.length,JSON.stringify({...(migration?{migrated:true}:{}),persistedCount,suppressedCount,changeCount,rawCount,heartbeatCount,heartbeatMinutes:DATAHUB_HEARTBEAT_MINUTES})]);
    await client.query("COMMIT");return {seen:rows.length,persisted:persistedCount,suppressed:suppressedCount};
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}

function recordSqlite(rows,sourceId,observedAt,{migration=false}={}){
  const batchUid=sha(`${sourceId}|${observedAt}`),canonical=rows.map(t=>canonicalRow(t,sourceId,observedAt));
  sqlite.exec("BEGIN");
  try{
    const src=sourceDefinition(sourceId);
    sqlite.prepare(`INSERT INTO data_sources(source_id,name,kind,adapter_status,countries,timezone,planning_priority,realtime_priority,platform_priority,first_seen_at,last_seen_at,metadata)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET first_seen_at=COALESCE(data_sources.first_seen_at,excluded.first_seen_at),last_seen_at=MAX(COALESCE(data_sources.last_seen_at,0),excluded.last_seen_at)`)
      .run(src.sourceId,src.name,src.kind,src.adapterStatus,JSON.stringify(src.countries),src.timeZone,src.planningPriority,src.realtimePriority,src.platformPriority,observedAt,observedAt,JSON.stringify({}));
    const serviceStmt=sqlite.prepare(`INSERT INTO service_runs(service_uid,source_id,source_trip_id,service_date,train_number,category,operator,operator_code,origin,destination,first_seen_at,last_seen_at,metadata)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(service_uid) DO UPDATE SET last_seen_at=MAX(service_runs.last_seen_at,excluded.last_seen_at),
      train_number=COALESCE(NULLIF(excluded.train_number,''),service_runs.train_number),category=COALESCE(NULLIF(excluded.category,''),service_runs.category),
      operator=COALESCE(NULLIF(excluded.operator,''),service_runs.operator),operator_code=COALESCE(NULLIF(excluded.operator_code,''),service_runs.operator_code),
      origin=COALESCE(NULLIF(excluded.origin,''),service_runs.origin),destination=COALESCE(NULLIF(excluded.destination,''),service_runs.destination)`);
    const eventStmt=sqlite.prepare(`INSERT OR IGNORE INTO event_observations(observation_uid,batch_uid,service_uid,source_id,service_date,train_number,category,source_event_id,
      station_name,station_code,country_code,event_mode,observed_at,planned_timestamp,expected_timestamp,actual_timestamp,planned_platform,current_platform,
      delay_minutes,status_text,cancelled,origin,destination,route,past_route,future_route,raw_payload,state_hash,raw_hash,observation_kind)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let persistedCount=0,suppressedCount=0,changeCount=0,rawCount=0,heartbeatCount=0;
    for(const r of canonical){
      serviceStmt.run(r.serviceUid,r.sourceId,r.sourceTripId,r.serviceDate,r.trainNumber,r.category,r.operator,r.operatorCode,r.origin,r.destination,r.observedAt,r.observedAt,JSON.stringify({}));
      const prev=migration?sqlite.prepare("SELECT * FROM migration_event_state WHERE migration_name=? AND event_key=?").get(migrationState.name,r.eventKey):
        sqlite.prepare("SELECT * FROM event_current_state WHERE event_key=?").get(r.eventKey);
      const stateChanged=!prev||prev.state_hash!==r.stateHash,rawChanged=!prev||prev.raw_hash!==r.rawHash,lastObs=Number(prev?.last_observation_at||0);
      const heartbeat=Boolean(prev)&&r.observedAt-lastObs>=DATAHUB_HEARTBEAT_MS,persist=stateChanged||rawChanged||heartbeat;
      const kind=!prev?"initial":stateChanged?"change":rawChanged?"raw-change":heartbeat?"heartbeat":"suppressed";
      let observationUid=prev?.last_observation_uid||null;
      if(persist){observationUid=sha([r.eventKey,r.observedAt,r.stateHash,r.rawHash,kind].join("|"));
        eventStmt.run(observationUid,batchUid,r.serviceUid,r.sourceId,r.serviceDate,r.trainNumber,r.category,r.sourceEventId,r.stationName,r.stationCode,r.countryCode,r.eventMode,
          r.observedAt,r.plannedTimestamp,r.expectedTimestamp,r.actualTimestamp,r.plannedPlatform,r.currentPlatform,r.delayMinutes,r.status,r.cancelled?1:0,r.origin,r.destination,
          JSON.stringify(r.route),JSON.stringify(r.pastRoute),JSON.stringify(r.futureRoute),rawChanged?JSON.stringify(r.rawPayload):null,r.stateHash,r.rawHash,kind);
        persistedCount++;if(stateChanged)changeCount++;else if(rawChanged)rawCount++;else heartbeatCount++;
      }else suppressedCount++;
      if(migration)sqlite.prepare(`INSERT INTO migration_event_state(migration_name,event_key,state_hash,raw_hash,last_observation_at,last_payload_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(migration_name,event_key) DO UPDATE SET state_hash=excluded.state_hash,raw_hash=excluded.raw_hash,
        last_observation_at=CASE WHEN ? THEN excluded.last_observation_at ELSE migration_event_state.last_observation_at END,
        last_payload_at=CASE WHEN ? THEN excluded.last_payload_at ELSE migration_event_state.last_payload_at END`)
        .run(migrationState.name,r.eventKey,r.stateHash,r.rawHash,persist?r.observedAt:lastObs,rawChanged?r.observedAt:Number(prev?.last_payload_at||0)||null,persist?1:0,rawChanged?1:0);
      else sqlite.prepare(`INSERT INTO event_current_state(event_key,source_id,service_uid,station_name,event_mode,source_event_id,state_hash,raw_hash,last_seen_at,last_observation_at,last_payload_at,last_observation_uid)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO UPDATE SET state_hash=excluded.state_hash,raw_hash=excluded.raw_hash,last_seen_at=MAX(event_current_state.last_seen_at,excluded.last_seen_at),
        last_observation_at=CASE WHEN ? THEN excluded.last_observation_at ELSE event_current_state.last_observation_at END,
        last_payload_at=CASE WHEN ? THEN excluded.last_payload_at ELSE event_current_state.last_payload_at END,
        last_observation_uid=CASE WHEN ? THEN excluded.last_observation_uid ELSE event_current_state.last_observation_uid END`)
        .run(r.eventKey,r.sourceId,r.serviceUid,r.stationName,r.eventMode,r.sourceEventId,r.stateHash,r.rawHash,r.observedAt,persist?r.observedAt:lastObs,
          rawChanged?r.observedAt:Number(prev?.last_payload_at||0)||null,observationUid,persist?1:0,rawChanged?1:0,persist?1:0);
    }
    sqlite.prepare(`INSERT INTO ingest_batches(batch_uid,source_id,observed_at,item_count,metadata) VALUES(?,?,?,?,?)
      ON CONFLICT(batch_uid) DO UPDATE SET item_count=MAX(ingest_batches.item_count,excluded.item_count),metadata=excluded.metadata`)
      .run(batchUid,sourceId,observedAt,rows.length,JSON.stringify({...(migration?{migrated:true}:{}),persistedCount,suppressedCount,changeCount,rawCount,heartbeatCount,heartbeatMinutes:DATAHUB_HEARTBEAT_MINUTES}));
    sqlite.exec("COMMIT");return {seen:rows.length,persisted:persistedCount,suppressed:suppressedCount};
  }catch(e){sqlite.exec("ROLLBACK");throw e;}
}

export async function recordCanonicalObservations(trains,sourceId,observedAt=Date.now(),options={}){
  if(!Array.isArray(trains)||!trains.length)return;
  if(backend==="postgresql")return recordPg(trains,sourceId,observedAt,options);
  if(backend==="sqlite")return recordSqlite(trains,sourceId,observedAt,options);
}

function parseLegacyPayload(row){
  const p=asJson(row.payload);
  const base=(p&&typeof p==="object"&&!Array.isArray(p))?p:{};
  const rawStop=base.rawStop||(base.id?base:null);
  return {
    ...base,
    trainKey:base.trainKey||row.train_key,
    sourceEventId:base.sourceEventId||rawStop?.id||row.train_key,
    rawStop,
    number:base.number||row.train_number,
    category:base.category||row.category,
    observedAt:base.observedAt||base.station||row.station,
    station:base.station||row.station,
    eventMode:base.eventMode||base.mode||row.event_mode,
    plannedTimestamp:base.plannedTimestamp||row.planned_timestamp,
    expectedTimestamp:base.expectedTimestamp||row.expected_timestamp,
    plannedTime:base.plannedTime||row.planned_time,
    currentTime:base.currentTime||row.current_time,
    delay:base.delay??row.delay_minutes,
    status:base.status||row.status,
    cancelled:base.cancelled??Boolean(row.cancelled),
    from:base.from||row.origin,
    to:base.to||row.destination,
    track:base.track||row.track,
    plannedTrack:base.plannedTrack||row.planned_track,
    currentTrack:base.currentTrack||row.current_track,
    route:Array.isArray(base.route)?base.route:(asJson(row.route)||[]),
    pastRoute:Array.isArray(base.pastRoute)?base.pastRoute:(asJson(row.past_route)||[]),
    futureRoute:Array.isArray(base.futureRoute)?base.futureRoute:(asJson(row.future_route)||[]),
    _observedAt:Number(row.observed_at),
    _legacyId:row.id
  };
}

async function migrationCompleted(){
  if(backend==="postgresql"){const r=await pool.query("SELECT completed_at,metadata FROM schema_migrations WHERE migration_name=$1",[migrationState.name]);return r.rows[0]||null;}
  return sqlite.prepare("SELECT completed_at,metadata FROM schema_migrations WHERE migration_name=?").get(migrationState.name)||null;
}
async function markMigrationDone(){
  const now=Date.now(),metadata={migratedRows:migrationState.migratedRows,skippedRows:migrationState.skippedRows,lastLegacyId:migrationState.lastLegacyId};
  if(backend==="postgresql")await pool.query(`INSERT INTO schema_migrations(migration_name,completed_at,metadata) VALUES($1,$2,$3::jsonb)
    ON CONFLICT(migration_name) DO UPDATE SET completed_at=EXCLUDED.completed_at,metadata=EXCLUDED.metadata`,[migrationState.name,now,JSON.stringify(metadata)]);
  else sqlite.prepare(`INSERT INTO schema_migrations(migration_name,completed_at,metadata) VALUES(?,?,?) ON CONFLICT(migration_name) DO UPDATE SET completed_at=excluded.completed_at,metadata=excluded.metadata`)
    .run(migrationState.name,now,JSON.stringify(metadata));
  await saveMigrationProgress({status:"completed",lastLegacyId:migrationState.lastLegacyId,migratedRows:migrationState.migratedRows,skippedRows:migrationState.skippedRows,error:null,startedAt:migrationState.startedAt});
  migrationState.finishedAt=now;migrationState.status="completed";migrationState.error=null;
}
async function loadLegacyPage(lastId,pageSize){
  if(backend==="postgresql")return (await pool.query(`SELECT id,source,train_key,train_number,category,station,event_mode,observed_at,planned_timestamp,expected_timestamp,
    planned_time,expected_time AS current_time,delay_minutes,status,cancelled,origin,destination,track,planned_track,current_track,route,past_route,future_route,payload
    FROM train_observations WHERE id>$1 ORDER BY id LIMIT $2`,[lastId,pageSize])).rows;
  return sqlite.prepare(`SELECT id,source,train_key,train_number,category,station,event_mode,observed_at,planned_timestamp,expected_timestamp,
    planned_time,expected_time AS current_time,delay_minutes,status,cancelled,origin,destination,track,planned_track,current_track,route,past_route,future_route,payload
    FROM train_observations WHERE id>? ORDER BY id LIMIT ?`).all(lastId,pageSize);
}
async function migrateGroup(group){
  try{await recordCanonicalObservations(group.rows.map(parseLegacyPayload),group.source,group.observedAt,{migration:true});migrationState.migratedRows+=group.rows.length;return;}
  catch(error){if(fatalMigrationError(error))throw error;}
  for(const row of group.rows){
    try{await recordCanonicalObservations([parseLegacyPayload(row)],row.source,Number(row.observed_at),{migration:true});migrationState.migratedRows++;}
    catch(error){if(fatalMigrationError(error))throw error;migrationState.skippedRows++;await logMigrationError(row,error);}
  }
}
export async function startLegacyMigration(){
  if(migrationState.status==="running")return migrationState;
  const done=await migrationCompleted();
  if(done){migrationState.status="completed";migrationState.finishedAt=Number(done.completed_at)||null;const meta=asJson(done.metadata)||{};
    migrationState.migratedRows=Number(meta.migratedRows||migrationState.migratedRows||0);migrationState.skippedRows=Number(meta.skippedRows||migrationState.skippedRows||0);
    migrationState.lastLegacyId=Number(meta.lastLegacyId||migrationState.lastLegacyId||0);migrationState.resumeFromId=migrationState.lastLegacyId;return migrationState;}
  migrationState.status="running";migrationState.startedAt=migrationState.startedAt||Date.now();migrationState.error=null;migrationState.resumeFromId=migrationState.lastLegacyId;
  await saveMigrationProgress({status:"running",lastLegacyId:migrationState.lastLegacyId,migratedRows:migrationState.migratedRows,skippedRows:migrationState.skippedRows,error:null,startedAt:migrationState.startedAt});
  try{
    let lastId=migrationState.lastLegacyId;const pageSize=250;
    while(true){
      const rows=await loadLegacyPage(lastId,pageSize);if(!rows.length)break;
      const groups=new Map();for(const row of rows){const key=`${row.source}|${row.observed_at}`;if(!groups.has(key))groups.set(key,{source:row.source,observedAt:Number(row.observed_at),rows:[]});groups.get(key).rows.push(row);}
      for(const group of groups.values())await migrateGroup(group);
      lastId=Math.max(lastId,...rows.map(r=>Number(r.id)||0));migrationState.lastLegacyId=lastId;
      await saveMigrationProgress({status:"running",lastLegacyId:lastId,migratedRows:migrationState.migratedRows,skippedRows:migrationState.skippedRows,error:null,startedAt:migrationState.startedAt});
      await new Promise(r=>setTimeout(r,25));
    }
    await markMigrationDone();
  }catch(error){migrationState.status="failed";migrationState.error=String(error?.message||error);migrationState.finishedAt=Date.now();
    await saveMigrationProgress({status:"failed",lastLegacyId:migrationState.lastLegacyId,migratedRows:migrationState.migratedRows,skippedRows:migrationState.skippedRows,error:migrationState.error,startedAt:migrationState.startedAt});throw error;}
  return migrationState;
}
export function getMigrationState(){return {...migrationState};}

export async function cleanupDbRegionalData(now=Date.now()){
  const today=dateKey(now,"Europe/Berlin");
  const keepFromDate=previousDateKey(today);
  if(!keepFromDate)return {keepFromDate:null,deletedEvents:0,deletedServices:0,deletedStates:0};

  if(backend==="postgresql"){
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const stateResult=await client.query(`
        DELETE FROM event_current_state ecs
        USING service_runs sr
        WHERE ecs.service_uid=sr.service_uid
          AND sr.source_id=ANY($1::text[])
          AND sr.service_date<$2
          AND NOT (UPPER(COALESCE(sr.category,''))=ANY($3::text[]))
      `,[DB_RETENTION_SOURCES,keepFromDate,FERNVERKEHR_CATEGORIES]);
      const eventResult=await client.query(`
        DELETE FROM event_observations
        WHERE source_id=ANY($1::text[])
          AND service_date<$2
          AND NOT (UPPER(COALESCE(category,''))=ANY($3::text[]))
      `,[DB_RETENTION_SOURCES,keepFromDate,FERNVERKEHR_CATEGORIES]);
      const serviceResult=await client.query(`
        DELETE FROM service_runs
        WHERE source_id=ANY($1::text[])
          AND service_date<$2
          AND NOT (UPPER(COALESCE(category,''))=ANY($3::text[]))
      `,[DB_RETENTION_SOURCES,keepFromDate,FERNVERKEHR_CATEGORIES]);
      await client.query("COMMIT");
      return {
        keepFromDate,
        deletedEvents:eventResult.rowCount||0,
        deletedServices:serviceResult.rowCount||0,
        deletedStates:stateResult.rowCount||0
      };
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}
  }

  if(backend==="sqlite"){
    const placeholders=FERNVERKEHR_CATEGORIES.map(()=>"?").join(",");
    const sourcePlaceholders=DB_RETENTION_SOURCES.map(()=>"?").join(",");
    const args=[...DB_RETENTION_SOURCES,keepFromDate,...FERNVERKEHR_CATEGORIES];
    sqlite.exec("BEGIN");
    try{
      const stateResult=sqlite.prepare(`
        DELETE FROM event_current_state
        WHERE service_uid IN (
          SELECT service_uid FROM service_runs
          WHERE source_id IN (${sourcePlaceholders})
            AND service_date<?
            AND UPPER(COALESCE(category,'')) NOT IN (${placeholders})
        )
      `).run(...args);
      const eventResult=sqlite.prepare(`
        DELETE FROM event_observations
        WHERE source_id IN (${sourcePlaceholders})
          AND service_date<?
          AND UPPER(COALESCE(category,'')) NOT IN (${placeholders})
      `).run(...args);
      const serviceResult=sqlite.prepare(`
        DELETE FROM service_runs
        WHERE source_id IN (${sourcePlaceholders})
          AND service_date<?
          AND UPPER(COALESCE(category,'')) NOT IN (${placeholders})
      `).run(...args);
      sqlite.exec("COMMIT");
      return {
        keepFromDate,
        deletedEvents:Number(eventResult.changes||0),
        deletedServices:Number(serviceResult.changes||0),
        deletedStates:Number(stateResult.changes||0)
      };
    }catch(error){sqlite.exec("ROLLBACK");throw error;}
  }

  return {keepFromDate,deletedEvents:0,deletedServices:0,deletedStates:0};
}

function limitValue(v,def=250,max=5000){
  const n=Number(v);
  if(!Number.isFinite(n)||n<1)return def;
  return Math.min(Math.floor(n),max);
}

function decodeRow(r,{sqliteMode=false}={}){
  const out={...r};
  for(const key of ["countries","metadata","route","past_route","future_route","raw_payload"]){
    if(Object.prototype.hasOwnProperty.call(out,key))out[key]=asJson(out[key]);
  }
  if(sqliteMode&&Object.prototype.hasOwnProperty.call(out,"cancelled"))out.cancelled=Boolean(out.cancelled);
  if(Object.prototype.hasOwnProperty.call(out,"rn"))delete out.rn;
  return out;
}
function decodePgRows(rows){return rows.map(r=>decodeRow(r));}
function decodeSqliteRows(rows){return rows.map(r=>decodeRow(r,{sqliteMode:true}));}

export async function getSources(){
  if(backend==="postgresql"){
    const r=await pool.query(`
      SELECT source_id,name,kind,adapter_status,countries,timezone,
             planning_priority,realtime_priority,platform_priority,
             first_seen_at,last_seen_at,metadata
      FROM data_sources
      ORDER BY CASE adapter_status WHEN 'active' THEN 0 ELSE 1 END,name
    `);
    return decodePgRows(r.rows).map(x=>({...x,connected:Boolean(x.last_seen_at)}));
  }
  return decodeSqliteRows(sqlite.prepare(`
    SELECT source_id,name,kind,adapter_status,countries,timezone,
           planning_priority,realtime_priority,platform_priority,
           first_seen_at,last_seen_at,metadata
    FROM data_sources
    ORDER BY CASE adapter_status WHEN 'active' THEN 0 ELSE 1 END,name
  `).all()).map(x=>({...x,connected:Boolean(x.last_seen_at)}));
}

export async function getDataHubStats(){
  if(backend==="postgresql"){
    const [services,events,batches,last,currentStates]=await Promise.all([
      pool.query("SELECT COUNT(*)::bigint AS n FROM service_runs"),
      pool.query("SELECT COUNT(*)::bigint AS n FROM event_observations"),
      pool.query("SELECT COUNT(*)::bigint AS n FROM ingest_batches"),
      pool.query("SELECT MAX(observed_at)::bigint AS n FROM event_observations"),
      pool.query("SELECT COUNT(*)::bigint AS n FROM event_current_state")
    ]);
    return {
      version:"4.1.2",backend,
      serviceRuns:Number(services.rows[0].n),eventObservations:Number(events.rows[0].n),currentStates:Number(currentStates.rows[0].n),
      ingestBatches:Number(batches.rows[0].n),lastObservationAt:last.rows[0].n?Number(last.rows[0].n):null,
      storagePolicy:{
        mode:"changes-plus-heartbeat",
        heartbeatMinutes:DATAHUB_HEARTBEAT_MINUTES,
        rawPayload:"only-when-changed",
        dbFernverkehr:"permanent",
        dbRegional:"current-and-previous-service-day",
        fernverkehrCategories:FERNVERKEHR_CATEGORIES
      },migration:getMigrationState()
    };
  }
  return {
    version:"4.1.2",backend,
    serviceRuns:Number(sqlite.prepare("SELECT COUNT(*) AS n FROM service_runs").get().n),eventObservations:Number(sqlite.prepare("SELECT COUNT(*) AS n FROM event_observations").get().n),
    currentStates:Number(sqlite.prepare("SELECT COUNT(*) AS n FROM event_current_state").get().n),ingestBatches:Number(sqlite.prepare("SELECT COUNT(*) AS n FROM ingest_batches").get().n),
    lastObservationAt:sqlite.prepare("SELECT MAX(observed_at) AS n FROM event_observations").get().n||null,
    storagePolicy:{
        mode:"changes-plus-heartbeat",
        heartbeatMinutes:DATAHUB_HEARTBEAT_MINUTES,
        rawPayload:"only-when-changed",
        dbFernverkehr:"permanent",
        dbRegional:"current-and-previous-service-day",
        fernverkehrCategories:FERNVERKEHR_CATEGORIES
      },migration:getMigrationState()
  };
}

export async function getServiceRuns({serviceDate,trainNumber,source,limit=250}={}){
  const lim=limitValue(limit,250,5000);
  if(backend==="postgresql"){
    const values=[];const where=[];
    if(serviceDate){values.push(serviceDate);where.push(`service_date=$${values.length}`);}
    if(trainNumber){values.push(String(trainNumber));where.push(`train_number=$${values.length}`);}
    if(source){values.push(source);where.push(`source_id=$${values.length}`);}
    values.push(lim);
    const r=await pool.query(`
      SELECT * FROM service_runs
      ${where.length?`WHERE ${where.join(" AND ")}`:""}
      ORDER BY service_date DESC,train_number,source_id
      LIMIT $${values.length}
    `,values);
    return decodePgRows(r.rows);
  }
  const values=[];const where=[];
  if(serviceDate){values.push(serviceDate);where.push("service_date=?");}
  if(trainNumber){values.push(String(trainNumber));where.push("train_number=?");}
  if(source){values.push(source);where.push("source_id=?");}
  values.push(lim);
  return decodeSqliteRows(sqlite.prepare(`
    SELECT * FROM service_runs
    ${where.length?`WHERE ${where.join(" AND ")}`:""}
    ORDER BY service_date DESC,train_number,source_id
    LIMIT ?
  `).all(...values));
}

export async function getCanonicalEvents({serviceDate,trainNumber,station,source,latestOnly=true,limit=500}={}){
  const lim=limitValue(limit,500,5000);
  if(backend==="postgresql"){
    const values=[];const where=[];
    if(serviceDate){values.push(serviceDate);where.push(`service_date=$${values.length}`);}
    if(trainNumber){values.push(String(trainNumber));where.push(`train_number=$${values.length}`);}
    if(station){values.push(station);where.push(`station_name=$${values.length}`);}
    if(source){values.push(source);where.push(`source_id=$${values.length}`);}
    values.push(lim);
    const select=`eo.*,ds.name AS source_name,ds.planning_priority,ds.realtime_priority,ds.platform_priority`;
    const query=latestOnly?`
      SELECT * FROM (
        SELECT DISTINCT ON (eo.source_id,eo.service_uid,eo.station_name,eo.event_mode)
          ${select}
        FROM event_observations eo
        JOIN data_sources ds ON ds.source_id=eo.source_id
        ${where.length?`WHERE ${where.join(" AND ")}`:""}
        ORDER BY eo.source_id,eo.service_uid,eo.station_name,eo.event_mode,eo.observed_at DESC
      ) q
      ORDER BY planned_timestamp NULLS LAST,train_number,station_name
      LIMIT $${values.length}
    `:`
      SELECT ${select}
      FROM event_observations eo
      JOIN data_sources ds ON ds.source_id=eo.source_id
      ${where.length?`WHERE ${where.join(" AND ")}`:""}
      ORDER BY eo.observed_at DESC
      LIMIT $${values.length}
    `;
    const r=await pool.query(query,values);
    return decodePgRows(r.rows);
  }

  const values=[];const where=[];
  if(serviceDate){values.push(serviceDate);where.push("eo.service_date=?");}
  if(trainNumber){values.push(String(trainNumber));where.push("eo.train_number=?");}
  if(station){values.push(station);where.push("eo.station_name=?");}
  if(source){values.push(source);where.push("eo.source_id=?");}
  values.push(lim);
  const select=`eo.*,ds.name AS source_name,ds.planning_priority,ds.realtime_priority,ds.platform_priority`;
  const query=latestOnly?`
    SELECT * FROM (
      SELECT ${select},ROW_NUMBER() OVER(
        PARTITION BY eo.source_id,eo.service_uid,eo.station_name,eo.event_mode
        ORDER BY eo.observed_at DESC
      ) rn
      FROM event_observations eo
      JOIN data_sources ds ON ds.source_id=eo.source_id
      ${where.length?`WHERE ${where.join(" AND ")}`:""}
    ) q
    WHERE rn=1
    ORDER BY planned_timestamp,train_number,station_name
    LIMIT ?
  `:`
    SELECT ${select}
    FROM event_observations eo
    JOIN data_sources ds ON ds.source_id=eo.source_id
    ${where.length?`WHERE ${where.join(" AND ")}`:""}
    ORDER BY eo.observed_at DESC
    LIMIT ?
  `;
  return decodeSqliteRows(sqlite.prepare(query).all(...values));
}

function stationKey(name=""){
  return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
}

function pickBy(rows,priorityField,predicate){
  return [...rows]
    .filter(predicate)
    .sort((a,b)=>Number(b[priorityField]||0)-Number(a[priorityField]||0)||Number(b.observed_at||0)-Number(a.observed_at||0))[0]||null;
}

export async function getCombinedTrain({trainNumber,serviceDate}={}){
  if(!trainNumber)return {trainNumber:null,serviceDate:serviceDate||null,events:[],sources:[]};
  const rows=await getCanonicalEvents({trainNumber:String(trainNumber),serviceDate,latestOnly:true,limit:5000});
  const groups=new Map();
  for(const r of rows){
    const key=`${stationKey(r.station_name)}|${r.event_mode||""}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(r);
  }
  const events=[];
  for(const group of groups.values()){
    const planning=pickBy(group,"planning_priority",r=>r.planned_timestamp);
    const realtime=pickBy(group,"realtime_priority",r=>r.expected_timestamp||r.actual_timestamp||r.status_text||r.cancelled);
    const platform=pickBy(group,"platform_priority",r=>r.current_platform||r.planned_platform);
    const routeRow=realtime||planning||group[0];
    events.push({
      station:routeRow.station_name,
      stationCode:routeRow.station_code||null,
      countryCode:routeRow.country_code||null,
      eventMode:routeRow.event_mode,
      plannedTimestamp:planning?.planned_timestamp||null,
      expectedTimestamp:realtime?.expected_timestamp||planning?.expected_timestamp||planning?.planned_timestamp||null,
      actualTimestamp:realtime?.actual_timestamp||null,
      plannedPlatform:planning?.planned_platform||platform?.planned_platform||null,
      currentPlatform:platform?.current_platform||platform?.planned_platform||null,
      delayMinutes:realtime?.delay_minutes??0,
      status:realtime?.status_text||planning?.status_text||"",
      cancelled:Boolean(realtime?.cancelled||planning?.cancelled),
      origin:routeRow.origin||null,
      destination:routeRow.destination||null,
      route:routeRow.route||[],
      provenance:{
        planning:planning?.source_id||null,
        realtime:realtime?.source_id||null,
        platform:platform?.source_id||null
      }
    });
  }
  events.sort((a,b)=>Number(a.plannedTimestamp||a.expectedTimestamp||0)-Number(b.plannedTimestamp||b.expectedTimestamp||0));
  return {
    trainNumber:String(trainNumber),
    serviceDate:serviceDate||null,
    sources:[...new Set(rows.map(r=>r.source_id))],
    events
  };
}
