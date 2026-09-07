import { createHash } from "node:crypto";

let backend="uninitialized";
let pool=null;
let sqlite=null;

const migrationState={
  name:"v4_legacy_train_observations",
  status:"pending",
  migratedRows:0,
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
  const serviceSeed=[sourceId,serviceDate,sourceTripId,origin,destination].join("|");
  const serviceUid=sha(serviceSeed);
  const stationName=clean(t.observedAt||t.station);
  const eventMode=clean(t.eventMode||t.mode);
  const sourceEventId=clean(t.sourceEventId||t.rawStop?.id||t.id||t.trainKey);
  const plannedPlatform=clean(t.plannedTrack||t.plannedPlatform);
  const currentPlatform=clean(t.currentTrack||t.currentPlatform||t.track);
  const route=Array.isArray(t.route)?t.route:[];
  const pastRoute=Array.isArray(t.pastRoute)?t.pastRoute:[];
  const futureRoute=Array.isArray(t.futureRoute)?t.futureRoute:[];
  const rawPayload=t.rawData?{...t,rawData:t.rawData}:t;

  const observationSeed=[
    sourceId,observedAt,serviceUid,stationName,eventMode,sourceEventId,
    plannedTs||"",expectedTs||"",actualTs||"",plannedPlatform,currentPlatform,
    Number(t.delay||0),Boolean(t.cancelled),clean(t.status)
  ].join("|");

  return {
    serviceUid,
    sourceId,
    sourceTripId,
    serviceDate,
    trainNumber,
    category,
    operator:clean(t.operator),
    operatorCode:clean(t.operatorCode),
    origin,
    destination,
    observedAt,
    observationUid:sha(observationSeed),
    sourceEventId,
    stationName,
    stationCode:clean(t.stationCode),
    countryCode:normalizeCountry(t.countryCode),
    eventMode,
    plannedTimestamp:plannedTs,
    expectedTimestamp:expectedTs,
    actualTimestamp:actualTs,
    plannedPlatform,
    currentPlatform,
    delayMinutes:Number(t.delay||t.delayMinutes||0),
    status:clean(t.status),
    cancelled:Boolean(t.cancelled),
    route,pastRoute,futureRoute,
    rawPayload
  };
}

async function pgSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_sources (
      source_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'unknown',
      adapter_status TEXT NOT NULL DEFAULT 'planned',
      countries JSONB NOT NULL DEFAULT '[]'::jsonb,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      planning_priority INTEGER NOT NULL DEFAULT 50,
      realtime_priority INTEGER NOT NULL DEFAULT 50,
      platform_priority INTEGER NOT NULL DEFAULT 50,
      first_seen_at BIGINT,
      last_seen_at BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS ingest_batches (
      batch_uid TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      observed_at BIGINT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS service_runs (
      service_uid TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_trip_id TEXT,
      service_date TEXT NOT NULL,
      train_number TEXT,
      category TEXT,
      operator TEXT,
      operator_code TEXT,
      origin TEXT,
      destination TEXT,
      first_seen_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS event_observations (
      observation_uid TEXT PRIMARY KEY,
      batch_uid TEXT,
      service_uid TEXT NOT NULL,
      source_id TEXT NOT NULL,
      service_date TEXT NOT NULL,
      train_number TEXT,
      category TEXT,
      source_event_id TEXT,
      station_name TEXT NOT NULL DEFAULT '',
      station_code TEXT,
      country_code TEXT,
      event_mode TEXT NOT NULL DEFAULT '',
      observed_at BIGINT NOT NULL,
      planned_timestamp BIGINT,
      expected_timestamp BIGINT,
      actual_timestamp BIGINT,
      planned_platform TEXT,
      current_platform TEXT,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      status_text TEXT,
      cancelled BOOLEAN NOT NULL DEFAULT FALSE,
      origin TEXT,
      destination TEXT,
      route JSONB NOT NULL DEFAULT '[]'::jsonb,
      past_route JSONB NOT NULL DEFAULT '[]'::jsonb,
      future_route JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_payload JSONB
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      completed_at BIGINT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_service_runs_date_train
      ON service_runs(service_date,train_number,source_id);
    CREATE INDEX IF NOT EXISTS idx_service_runs_seen
      ON service_runs(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_train_date
      ON event_observations(service_date,train_number,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_station
      ON event_observations(station_name,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_service
      ON event_observations(service_uid,station_name,event_mode,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_source
      ON event_observations(source_id,observed_at DESC);
  `);
}

function sqliteSchema(){
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS data_sources (
      source_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'unknown',
      adapter_status TEXT NOT NULL DEFAULT 'planned',
      countries TEXT NOT NULL DEFAULT '[]',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      planning_priority INTEGER NOT NULL DEFAULT 50,
      realtime_priority INTEGER NOT NULL DEFAULT 50,
      platform_priority INTEGER NOT NULL DEFAULT 50,
      first_seen_at INTEGER,
      last_seen_at INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS ingest_batches (
      batch_uid TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS service_runs (
      service_uid TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_trip_id TEXT,
      service_date TEXT NOT NULL,
      train_number TEXT,
      category TEXT,
      operator TEXT,
      operator_code TEXT,
      origin TEXT,
      destination TEXT,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS event_observations (
      observation_uid TEXT PRIMARY KEY,
      batch_uid TEXT,
      service_uid TEXT NOT NULL,
      source_id TEXT NOT NULL,
      service_date TEXT NOT NULL,
      train_number TEXT,
      category TEXT,
      source_event_id TEXT,
      station_name TEXT NOT NULL DEFAULT '',
      station_code TEXT,
      country_code TEXT,
      event_mode TEXT NOT NULL DEFAULT '',
      observed_at INTEGER NOT NULL,
      planned_timestamp INTEGER,
      expected_timestamp INTEGER,
      actual_timestamp INTEGER,
      planned_platform TEXT,
      current_platform TEXT,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      status_text TEXT,
      cancelled INTEGER NOT NULL DEFAULT 0,
      origin TEXT,
      destination TEXT,
      route TEXT NOT NULL DEFAULT '[]',
      past_route TEXT NOT NULL DEFAULT '[]',
      future_route TEXT NOT NULL DEFAULT '[]',
      raw_payload TEXT
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_service_runs_date_train
      ON service_runs(service_date,train_number,source_id);
    CREATE INDEX IF NOT EXISTS idx_service_runs_seen
      ON service_runs(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_train_date
      ON event_observations(service_date,train_number,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_station
      ON event_observations(station_name,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_service
      ON event_observations(service_uid,station_name,event_mode,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_obs_source
      ON event_observations(source_id,observed_at DESC);
  `);
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

export async function initDataHub({backend:kind,pool:pgPool,sqlite:sqliteDb}){
  backend=kind;
  pool=pgPool||null;
  sqlite=sqliteDb||null;
  if(backend==="postgresql")await pgSchema();
  else if(backend==="sqlite")sqliteSchema();
  else throw new Error(`Data Hub: onbekende backend ${backend}`);
  await seedSources();
  const done=await migrationCompleted();
  if(done){
    migrationState.status="completed";
    migrationState.finishedAt=Number(done.completed_at)||null;
    const meta=asJson(done.metadata)||{};
    migrationState.migratedRows=Number(meta.migratedRows||0);
  }
  return {backend,version:4};
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
  const client=await pool.connect();
  const batchUid=sha(`${sourceId}|${observedAt}`);
  try{
    await client.query("BEGIN");
    await markSourceSeen(sourceId,observedAt,client);
    await client.query(`
      INSERT INTO ingest_batches(batch_uid,source_id,observed_at,item_count,metadata)
      VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(batch_uid) DO UPDATE SET
        item_count=GREATEST(ingest_batches.item_count,EXCLUDED.item_count),
        metadata=ingest_batches.metadata || EXCLUDED.metadata
    `,[batchUid,sourceId,observedAt,rows.length,JSON.stringify(migration?{migrated:true}:{})]);

    for(const t of rows){
      const r=canonicalRow(t,sourceId,observedAt);
      await client.query(`
        INSERT INTO service_runs(
          service_uid,source_id,source_trip_id,service_date,train_number,category,
          operator,operator_code,origin,destination,first_seen_at,last_seen_at,metadata
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12::jsonb)
        ON CONFLICT(service_uid) DO UPDATE SET
          last_seen_at=GREATEST(service_runs.last_seen_at,EXCLUDED.last_seen_at),
          train_number=COALESCE(NULLIF(EXCLUDED.train_number,''),service_runs.train_number),
          category=COALESCE(NULLIF(EXCLUDED.category,''),service_runs.category),
          operator=COALESCE(NULLIF(EXCLUDED.operator,''),service_runs.operator),
          operator_code=COALESCE(NULLIF(EXCLUDED.operator_code,''),service_runs.operator_code),
          origin=COALESCE(NULLIF(EXCLUDED.origin,''),service_runs.origin),
          destination=COALESCE(NULLIF(EXCLUDED.destination,''),service_runs.destination)
      `,[
        r.serviceUid,r.sourceId,r.sourceTripId,r.serviceDate,r.trainNumber,r.category,
        r.operator,r.operatorCode,r.origin,r.destination,r.observedAt,JSON.stringify({})
      ]);

      await client.query(`
        INSERT INTO event_observations(
          observation_uid,batch_uid,service_uid,source_id,service_date,train_number,category,
          source_event_id,station_name,station_code,country_code,event_mode,observed_at,
          planned_timestamp,expected_timestamp,actual_timestamp,planned_platform,current_platform,
          delay_minutes,status_text,cancelled,origin,destination,route,past_route,future_route,raw_payload
        ) VALUES(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
          $24::jsonb,$25::jsonb,$26::jsonb,$27::jsonb
        ) ON CONFLICT(observation_uid) DO NOTHING
      `,[
        r.observationUid,batchUid,r.serviceUid,r.sourceId,r.serviceDate,r.trainNumber,r.category,
        r.sourceEventId,r.stationName,r.stationCode,r.countryCode,r.eventMode,r.observedAt,
        r.plannedTimestamp,r.expectedTimestamp,r.actualTimestamp,r.plannedPlatform,r.currentPlatform,
        r.delayMinutes,r.status,r.cancelled,r.origin,r.destination,
        JSON.stringify(r.route),JSON.stringify(r.pastRoute),JSON.stringify(r.futureRoute),JSON.stringify(r.rawPayload)
      ]);
    }
    await client.query("COMMIT");
  }catch(e){
    await client.query("ROLLBACK");
    throw e;
  }finally{
    client.release();
  }
}

function recordSqlite(rows,sourceId,observedAt,{migration=false}={}){
  const batchUid=sha(`${sourceId}|${observedAt}`);
  sqlite.exec("BEGIN");
  try{
    // Keep this synchronous on SQLite.
    const s=sourceDefinition(sourceId);
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

    sqlite.prepare(`
      INSERT INTO ingest_batches(batch_uid,source_id,observed_at,item_count,metadata)
      VALUES(?,?,?,?,?)
      ON CONFLICT(batch_uid) DO UPDATE SET
        item_count=MAX(ingest_batches.item_count,excluded.item_count),
        metadata=excluded.metadata
    `).run(batchUid,sourceId,observedAt,rows.length,JSON.stringify(migration?{migrated:true}:{}));

    const serviceStmt=sqlite.prepare(`
      INSERT INTO service_runs(
        service_uid,source_id,source_trip_id,service_date,train_number,category,
        operator,operator_code,origin,destination,first_seen_at,last_seen_at,metadata
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(service_uid) DO UPDATE SET
        last_seen_at=MAX(service_runs.last_seen_at,excluded.last_seen_at),
        train_number=COALESCE(NULLIF(excluded.train_number,''),service_runs.train_number),
        category=COALESCE(NULLIF(excluded.category,''),service_runs.category),
        operator=COALESCE(NULLIF(excluded.operator,''),service_runs.operator),
        operator_code=COALESCE(NULLIF(excluded.operator_code,''),service_runs.operator_code),
        origin=COALESCE(NULLIF(excluded.origin,''),service_runs.origin),
        destination=COALESCE(NULLIF(excluded.destination,''),service_runs.destination)
    `);

    const eventStmt=sqlite.prepare(`
      INSERT OR IGNORE INTO event_observations(
        observation_uid,batch_uid,service_uid,source_id,service_date,train_number,category,
        source_event_id,station_name,station_code,country_code,event_mode,observed_at,
        planned_timestamp,expected_timestamp,actual_timestamp,planned_platform,current_platform,
        delay_minutes,status_text,cancelled,origin,destination,route,past_route,future_route,raw_payload
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for(const t of rows){
      const r=canonicalRow(t,sourceId,observedAt);
      serviceStmt.run(
        r.serviceUid,r.sourceId,r.sourceTripId,r.serviceDate,r.trainNumber,r.category,
        r.operator,r.operatorCode,r.origin,r.destination,r.observedAt,r.observedAt,JSON.stringify({})
      );
      eventStmt.run(
        r.observationUid,batchUid,r.serviceUid,r.sourceId,r.serviceDate,r.trainNumber,r.category,
        r.sourceEventId,r.stationName,r.stationCode,r.countryCode,r.eventMode,r.observedAt,
        r.plannedTimestamp,r.expectedTimestamp,r.actualTimestamp,r.plannedPlatform,r.currentPlatform,
        r.delayMinutes,r.status,r.cancelled?1:0,r.origin,r.destination,
        JSON.stringify(r.route),JSON.stringify(r.pastRoute),JSON.stringify(r.futureRoute),JSON.stringify(r.rawPayload)
      );
    }
    sqlite.exec("COMMIT");
  }catch(e){
    sqlite.exec("ROLLBACK");
    throw e;
  }
}

export async function recordCanonicalObservations(trains,sourceId,observedAt=Date.now(),options={}){
  if(!Array.isArray(trains)||!trains.length)return;
  if(backend==="postgresql")return recordPg(trains,sourceId,observedAt,options);
  if(backend==="sqlite")return recordSqlite(trains,sourceId,observedAt,options);
}

function parseLegacyPayload(row){
  const p=asJson(row.payload);
  const base=(p&&typeof p==="object"&&!Array.isArray(p))?p:{};
  return {
    ...base,
    trainKey:base.trainKey||row.train_key,
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
  if(backend==="postgresql"){
    const r=await pool.query("SELECT completed_at,metadata FROM schema_migrations WHERE migration_name=$1",[migrationState.name]);
    return r.rows[0]||null;
  }
  return sqlite.prepare("SELECT completed_at,metadata FROM schema_migrations WHERE migration_name=?").get(migrationState.name)||null;
}

async function markMigrationDone(){
  const now=Date.now();
  const metadata={migratedRows:migrationState.migratedRows};
  if(backend==="postgresql"){
    await pool.query(`
      INSERT INTO schema_migrations(migration_name,completed_at,metadata)
      VALUES($1,$2,$3::jsonb)
      ON CONFLICT(migration_name) DO UPDATE SET completed_at=EXCLUDED.completed_at,metadata=EXCLUDED.metadata
    `,[migrationState.name,now,JSON.stringify(metadata)]);
  }else{
    sqlite.prepare(`
      INSERT INTO schema_migrations(migration_name,completed_at,metadata)
      VALUES(?,?,?)
      ON CONFLICT(migration_name) DO UPDATE SET completed_at=excluded.completed_at,metadata=excluded.metadata
    `).run(migrationState.name,now,JSON.stringify(metadata));
  }
  migrationState.finishedAt=now;
  migrationState.status="completed";
}

export async function startLegacyMigration(){
  if(migrationState.status==="running")return migrationState;
  const done=await migrationCompleted();
  if(done){
    migrationState.status="completed";
    migrationState.finishedAt=Number(done.completed_at)||null;
    const meta=asJson(done.metadata)||{};
    migrationState.migratedRows=Number(meta.migratedRows||0);
    return migrationState;
  }

  migrationState.status="running";
  migrationState.startedAt=Date.now();
  migrationState.error=null;
  migrationState.migratedRows=0;

  try{
    let lastId=0;
    const pageSize=500;
    while(true){
      let rows=[];
      if(backend==="postgresql"){
        const r=await pool.query(`
          SELECT id,source,train_key,train_number,category,station,event_mode,observed_at,
                 planned_timestamp,expected_timestamp,planned_time,expected_time AS current_time,
                 delay_minutes,status,cancelled,origin,destination,track,planned_track,current_track,
                 route,past_route,future_route,payload
          FROM train_observations
          WHERE id>$1
          ORDER BY id
          LIMIT $2
        `,[lastId,pageSize]);
        rows=r.rows;
      }else{
        rows=sqlite.prepare(`
          SELECT id,source,train_key,train_number,category,station,event_mode,observed_at,
                 planned_timestamp,expected_timestamp,planned_time,expected_time AS current_time,
                 delay_minutes,status,cancelled,origin,destination,track,planned_track,current_track,
                 route,past_route,future_route,payload
          FROM train_observations
          WHERE id>?
          ORDER BY id
          LIMIT ?
        `).all(lastId,pageSize);
      }
      if(!rows.length)break;

      const groups=new Map();
      for(const row of rows){
        lastId=Math.max(lastId,Number(row.id));
        const key=`${row.source}|${row.observed_at}`;
        if(!groups.has(key))groups.set(key,{source:row.source,observedAt:Number(row.observed_at),trains:[]});
        groups.get(key).trains.push(parseLegacyPayload(row));
      }
      for(const g of groups.values()){
        await recordCanonicalObservations(g.trains,g.source,g.observedAt,{migration:true});
        migrationState.migratedRows+=g.trains.length;
      }
      // Yield so the live board stays responsive on Railway during backfill.
      await new Promise(r=>setTimeout(r,10));
    }
    await markMigrationDone();
  }catch(e){
    migrationState.status="failed";
    migrationState.error=e.message;
    migrationState.finishedAt=Date.now();
    throw e;
  }
  return migrationState;
}

export function getMigrationState(){
  return {...migrationState};
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
    const [services,events,batches,last]=await Promise.all([
      pool.query("SELECT COUNT(*)::bigint AS n FROM service_runs"),
      pool.query("SELECT COUNT(*)::bigint AS n FROM event_observations"),
      pool.query("SELECT COUNT(*)::bigint AS n FROM ingest_batches"),
      pool.query("SELECT MAX(observed_at)::bigint AS n FROM event_observations")
    ]);
    return {
      version:4,backend,
      serviceRuns:Number(services.rows[0].n),
      eventObservations:Number(events.rows[0].n),
      ingestBatches:Number(batches.rows[0].n),
      lastObservationAt:last.rows[0].n?Number(last.rows[0].n):null,
      migration:getMigrationState()
    };
  }
  return {
    version:4,backend,
    serviceRuns:Number(sqlite.prepare("SELECT COUNT(*) AS n FROM service_runs").get().n),
    eventObservations:Number(sqlite.prepare("SELECT COUNT(*) AS n FROM event_observations").get().n),
    ingestBatches:Number(sqlite.prepare("SELECT COUNT(*) AS n FROM ingest_batches").get().n),
    lastObservationAt:sqlite.prepare("SELECT MAX(observed_at) AS n FROM event_observations").get().n||null,
    migration:getMigrationState()
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
