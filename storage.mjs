import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  initDataHub,recordCanonicalObservations,startLegacyMigration as startHubLegacyMigration,
  getMigrationState,getSources as getHubSources,getDataHubStats as getHubStats,
  getServiceRuns as getHubServiceRuns,getCanonicalEvents as getHubCanonicalEvents,
  getCombinedTrain as getHubCombinedTrain
} from "./datahub.mjs";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

let backend="uninitialized";
let sqlite=null;
let pool=null;
let sqliteInsert=null;
let sqliteTrend=null;

// 0 = onbeperkt bewaren. Alleen als HISTORY_DAYS expliciet op een positief
// getal staat, wordt oude historie automatisch verwijderd.
function historyDays(){
  if(!(String(process.env.HISTORY_DAYS||"").trim())) return 0;
  const n=Number(process.env.HISTORY_DAYS);
  return Number.isFinite(n)&&n>0?n:0;
}

function ensureSqliteColumn(table,name,type){
  const cols=sqlite.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name);
  if(!cols.includes(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

export async function initStorage(){
  const databaseUrl=String(process.env.DATABASE_URL||"").trim();

  if(databaseUrl){
    const {Pool}=await import("pg");
    pool=new Pool({
      connectionString:databaseUrl,
      max:4,
      idleTimeoutMillis:30000,
      connectionTimeoutMillis:10000
    });

    let lastError=null;
    for(let attempt=1;attempt<=12;attempt++){
      try{await pool.query("SELECT 1");lastError=null;break;}
      catch(e){lastError=e;if(attempt<12)await new Promise(r=>setTimeout(r,2500));}
    }
    if(lastError) throw lastError;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS train_observations (
        id BIGSERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        train_key TEXT NOT NULL,
        train_number TEXT,
        category TEXT,
        station TEXT NOT NULL DEFAULT '',
        event_mode TEXT NOT NULL DEFAULT '',
        observed_at BIGINT NOT NULL,
        planned_timestamp BIGINT,
        expected_timestamp BIGINT,
        planned_time TEXT,
        expected_time TEXT,
        delay_minutes INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        cancelled BOOLEAN NOT NULL DEFAULT FALSE,
        origin TEXT,
        destination TEXT,
        track TEXT,
        planned_track TEXT,
        current_track TEXT,
        route JSONB,
        past_route JSONB,
        future_route JSONB,
        payload JSONB
      );
      ALTER TABLE train_observations ADD COLUMN IF NOT EXISTS expected_timestamp BIGINT;
      ALTER TABLE train_observations ADD COLUMN IF NOT EXISTS planned_track TEXT;
      ALTER TABLE train_observations ADD COLUMN IF NOT EXISTS current_track TEXT;
      ALTER TABLE train_observations ADD COLUMN IF NOT EXISTS route JSONB;
      ALTER TABLE train_observations ADD COLUMN IF NOT EXISTS past_route JSONB;
      ALTER TABLE train_observations ADD COLUMN IF NOT EXISTS future_route JSONB;
      CREATE INDEX IF NOT EXISTS idx_train_obs_trend
        ON train_observations(source,train_key,station,event_mode,observed_at);
      CREATE INDEX IF NOT EXISTS idx_train_obs_station
        ON train_observations(source,station,observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_train_obs_number
        ON train_observations(source,train_number,observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_train_obs_planned
        ON train_observations(source,planned_timestamp,category,train_number);
    `);
    backend="postgresql";
    await initDataHub({backend,pool,sqlite:null});
    return {backend};
  }

  sqlite=new DatabaseSync(path.join(__dirname,"history.sqlite"));
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS train_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      train_key TEXT NOT NULL,
      train_number TEXT,
      category TEXT,
      station TEXT NOT NULL DEFAULT '',
      event_mode TEXT NOT NULL DEFAULT '',
      observed_at INTEGER NOT NULL,
      planned_timestamp INTEGER,
      planned_time TEXT,
      expected_time TEXT,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      cancelled INTEGER NOT NULL DEFAULT 0,
      origin TEXT,
      destination TEXT,
      track TEXT,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_train_obs_trend
      ON train_observations(source,train_key,station,event_mode,observed_at);
    CREATE INDEX IF NOT EXISTS idx_train_obs_station
      ON train_observations(source,station,observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_train_obs_number
      ON train_observations(source,train_number,observed_at DESC);
  `);
  ensureSqliteColumn("train_observations","expected_timestamp","INTEGER");
  ensureSqliteColumn("train_observations","expected_time","TEXT");
  ensureSqliteColumn("train_observations","planned_track","TEXT");
  ensureSqliteColumn("train_observations","current_track","TEXT");
  ensureSqliteColumn("train_observations","route","TEXT");
  ensureSqliteColumn("train_observations","past_route","TEXT");
  ensureSqliteColumn("train_observations","future_route","TEXT");

  sqliteInsert=sqlite.prepare(`
    INSERT INTO train_observations (
      source,train_key,train_number,category,station,event_mode,observed_at,
      planned_timestamp,expected_timestamp,planned_time,expected_time,delay_minutes,status,cancelled,
      origin,destination,track,planned_track,current_track,route,past_route,future_route,payload
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  sqliteTrend=sqlite.prepare(`
    SELECT observed_at,delay_minutes,status
    FROM train_observations
    WHERE source=? AND train_key=? AND station=? AND event_mode=?
      AND observed_at BETWEEN ? AND ?
    ORDER BY ABS(observed_at-?)
    LIMIT 1
  `);
  backend="sqlite";
  await initDataHub({backend,pool:null,sqlite});
  return {backend};
}

export function getStorageInfo(){
  const days=historyDays();
  return {
    backend,
    historyDays:days||null,
    retention:days?`${days} days`:"unlimited",
    online:backend==="postgresql"
  };
}

function rowForStorage(t,source,observedAt){
  const plannedTs=Number(t.plannedTimestamp||0)||null;
  const expectedTs=Number(t.expectedTimestamp||0) || (
    plannedTs ? plannedTs + Number(t.delay||0)*60000 : null
  );
  const route=Array.isArray(t.route)?t.route:[],
        pastRoute=Array.isArray(t.pastRoute)?t.pastRoute:[],
        futureRoute=Array.isArray(t.futureRoute)?t.futureRoute:[];
  return {
    source,
    trainKey:String(t.trainKey||""),
    trainNumber:String(t.number||""),
    category:String(t.category||""),
    station:String(t.observedAt||t.station||""),
    eventMode:String(t.eventMode||t.mode||""),
    observedAt:Number(observedAt),
    plannedTimestamp:plannedTs,
    expectedTimestamp:expectedTs,
    plannedTime:String(t.plannedTime||t.time||""),
    currentTime:String(t.currentTime||t.time||""),
    delayMinutes:Number(t.delay||0),
    status:String(t.status||""),
    cancelled:Boolean(t.cancelled),
    origin:String(t.from||""),
    destination:String(t.to||""),
    track:String(t.track||""),
    plannedTrack:String(t.plannedTrack||""),
    currentTrack:String(t.currentTrack||t.track||""),
    route,
    pastRoute,
    futureRoute,
    payload:t
  };
}

export async function recordObservations(trains,source,observedAt=Date.now()){
  if(!Array.isArray(trains)||!trains.length) return;
  const rows=trains.map(t=>rowForStorage(t,source,observedAt));

  if(backend==="postgresql"){
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const sql=`
        INSERT INTO train_observations (
          source,train_key,train_number,category,station,event_mode,observed_at,
          planned_timestamp,expected_timestamp,planned_time,expected_time,delay_minutes,status,cancelled,
          origin,destination,track,planned_track,current_track,route,past_route,future_route,payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      `;
      for(const r of rows){
        await client.query(sql,[
          r.source,r.trainKey,r.trainNumber,r.category,r.station,r.eventMode,r.observedAt,
          r.plannedTimestamp,r.expectedTimestamp,r.plannedTime,r.currentTime,r.delayMinutes,r.status,r.cancelled,
          r.origin,r.destination,r.track,r.plannedTrack,r.currentTrack,
          JSON.stringify(r.route),JSON.stringify(r.pastRoute),JSON.stringify(r.futureRoute),JSON.stringify(r.payload)
        ]);
      }
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK");throw e;}
    finally{client.release();}
  }else if(backend==="sqlite"){
    sqlite.exec("BEGIN");
    try{
      for(const r of rows){
        sqliteInsert.run(
          r.source,r.trainKey,r.trainNumber,r.category,r.station,r.eventMode,r.observedAt,
          r.plannedTimestamp,r.expectedTimestamp,r.plannedTime,r.currentTime,r.delayMinutes,r.status,r.cancelled?1:0,
          r.origin,r.destination,r.track,r.plannedTrack,r.currentTrack,
          JSON.stringify(r.route),JSON.stringify(r.pastRoute),JSON.stringify(r.futureRoute),JSON.stringify(r.payload)
        );
      }
      sqlite.exec("COMMIT");
    }catch(e){sqlite.exec("ROLLBACK");throw e;}
  }

  // V4 Data Hub: schrijf dezelfde scan ook naar de bron-onafhankelijke laag.
  // De oude train_observations-tabel blijft bestaan voor het huidige board en trendlogica.
  await recordCanonicalObservations(trains,source,observedAt);

  await cleanupOldObservations(observedAt);
}

export async function findTrendObservation({source,trainKey,station,eventMode,min,max,target}){
  if(backend==="postgresql"){
    const r=await pool.query(`
      SELECT observed_at,delay_minutes,status
      FROM train_observations
      WHERE source=$1 AND train_key=$2 AND station=$3 AND event_mode=$4
        AND observed_at BETWEEN $5 AND $6
      ORDER BY ABS(observed_at-$7)
      LIMIT 1
    `,[source,trainKey,station||"",eventMode||"",min,max,target]);
    return r.rows[0]||null;
  }
  if(backend==="sqlite"){
    return sqliteTrend.get(source,trainKey,station||"",eventMode||"",min,max,target)||null;
  }
  return null;
}

export async function cleanupOldObservations(now=Date.now()){
  const days=historyDays();
  if(!days) return;
  const cutoff=Number(now)-days*24*60*60*1000;
  if(backend==="postgresql"){
    await pool.query("DELETE FROM train_observations WHERE observed_at < $1",[cutoff]);
  }else if(backend==="sqlite"){
    sqlite.prepare("DELETE FROM train_observations WHERE observed_at < ?").run(cutoff);
  }
}

function clampLimit(v,def=250,max=5000){
  const n=Number(v);
  if(!Number.isFinite(n)||n<1) return def;
  return Math.min(Math.floor(n),max);
}

const selectCols=`source,train_key,train_number,category,station,event_mode,observed_at,
  planned_timestamp,expected_timestamp,planned_time,expected_time AS current_time,
  delay_minutes,status,cancelled,origin,destination,track,planned_track,current_track,route,past_route,future_route`;

export async function getHistory({source,trainNumber,station,hours=24,limit=500}={}){
  const cutoff=Date.now()-Math.max(1,Number(hours)||24)*60*60*1000;
  const lim=clampLimit(limit,500,5000);

  if(backend==="postgresql"){
    const values=[cutoff];
    const where=[`observed_at >= $1`];
    if(source){values.push(source);where.push(`source=$${values.length}`);}
    if(trainNumber){values.push(String(trainNumber));where.push(`train_number=$${values.length}`);}
    if(station){values.push(station);where.push(`station=$${values.length}`);}
    values.push(lim);
    const r=await pool.query(`
      SELECT ${selectCols}
      FROM train_observations
      WHERE ${where.join(" AND ")}
      ORDER BY observed_at DESC
      LIMIT $${values.length}
    `,values);
    return r.rows;
  }

  if(backend==="sqlite"){
    const values=[cutoff];
    const where=[`observed_at >= ?`];
    if(source){values.push(source);where.push(`source=?`);}
    if(trainNumber){values.push(String(trainNumber));where.push(`train_number=?`);}
    if(station){values.push(station);where.push(`station=?`);}
    values.push(lim);
    return sqlite.prepare(`
      SELECT source,train_key,train_number,category,station,event_mode,observed_at,
             planned_timestamp,expected_timestamp,planned_time,expected_time AS current_time,delay_minutes,status,cancelled,
             origin,destination,track,planned_track,current_track,route,past_route,future_route
      FROM train_observations
      WHERE ${where.join(" AND ")}
      ORDER BY observed_at DESC
      LIMIT ?
    `).all(...values);
  }
  return [];
}

export async function getLatestByStation({station,source="DB",hours=6,limit=100}={}){
  if(!station) return [];
  const cutoff=Date.now()-Math.max(1,Number(hours)||6)*60*60*1000;
  const lim=clampLimit(limit,100,1000);

  if(backend==="postgresql"){
    const r=await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (source,train_key,station,event_mode)
          ${selectCols}
        FROM train_observations
        WHERE source=$1 AND station=$2 AND observed_at >= $3
        ORDER BY source,train_key,station,event_mode,observed_at DESC
      ) q
      ORDER BY planned_timestamp NULLS LAST, train_number
      LIMIT $4
    `,[source,station,cutoff,lim]);
    return r.rows;
  }

  if(backend==="sqlite"){
    return sqlite.prepare(`
      SELECT source,train_key,train_number,category,station,event_mode,observed_at,
             planned_timestamp,expected_timestamp,planned_time,expected_time AS current_time,delay_minutes,status,cancelled,
             origin,destination,track,planned_track,current_track,route,past_route,future_route
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY source,train_key,station,event_mode
          ORDER BY observed_at DESC
        ) AS rn
        FROM train_observations
        WHERE source=? AND station=? AND observed_at >= ?
      ) q
      WHERE rn=1
      ORDER BY planned_timestamp,train_number
      LIMIT ?
    `).all(source,station,cutoff,lim);
  }
  return [];
}

export async function getLatestForPlannedWindow({source="DB",start,end,categories=[],trainNumbers=[],limit=5000}={}){
  const lim=clampLimit(limit,5000,10000);
  const cats=(categories||[]).map(String);
  const nums=(trainNumbers||[]).map(String);
  if(!Number.isFinite(Number(start))||!Number.isFinite(Number(end))) return [];

  if(backend==="postgresql"){
    const values=[source,Number(start),Number(end)];
    const extra=[];
    if(cats.length){values.push(cats);extra.push(`category = ANY($${values.length}::text[])`);}
    if(nums.length){values.push(nums);extra.push(`train_number = ANY($${values.length}::text[])`);}
    const typeFilter=extra.length?`AND (${extra.join(" OR ")})`:"";
    values.push(lim);
    const r=await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (source,train_key,station,event_mode)
          ${selectCols}
        FROM train_observations
        WHERE source=$1 AND planned_timestamp >= $2 AND planned_timestamp < $3
          ${typeFilter}
        ORDER BY source,train_key,station,event_mode,observed_at DESC
      ) q
      ORDER BY planned_timestamp NULLS LAST, train_number
      LIMIT $${values.length}
    `,values);
    return r.rows;
  }

  if(backend==="sqlite"){
    const values=[source,Number(start),Number(end)];
    const extra=[];
    if(cats.length){extra.push(`category IN (${cats.map(()=>'?').join(',')})`);values.push(...cats);}
    if(nums.length){extra.push(`train_number IN (${nums.map(()=>'?').join(',')})`);values.push(...nums);}
    const typeFilter=extra.length?`AND (${extra.join(' OR ')})`:'';
    values.push(lim);
    return sqlite.prepare(`
      SELECT source,train_key,train_number,category,station,event_mode,observed_at,
             planned_timestamp,expected_timestamp,planned_time,expected_time AS current_time,delay_minutes,status,cancelled,
             origin,destination,track,planned_track,current_track,route,past_route,future_route
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY source,train_key,station,event_mode
          ORDER BY observed_at DESC
        ) AS rn
        FROM train_observations
        WHERE source=? AND planned_timestamp >= ? AND planned_timestamp < ? ${typeFilter}
      ) q
      WHERE rn=1
      ORDER BY planned_timestamp,train_number
      LIMIT ?
    `).all(...values);
  }
  return [];
}


// ---------------- V4 Multi-source Data Hub API ----------------
export async function startLegacyMigration(){return startHubLegacyMigration();}
export function getDataHubMigrationState(){return getMigrationState();}
export async function getDataSources(){return getHubSources();}
export async function getDataHubStats(){return getHubStats();}
export async function getServiceRuns(args={}){return getHubServiceRuns(args);}
export async function getCanonicalEvents(args={}){return getHubCanonicalEvents(args);}
export async function getCombinedTrain(args={}){return getHubCombinedTrain(args);}
export async function ingestCanonicalObservations(trains,source,observedAt=Date.now(),options={}){
  return recordCanonicalObservations(trains,source,observedAt,options);
}
