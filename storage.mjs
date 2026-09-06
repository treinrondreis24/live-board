import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

let backend="uninitialized";
let sqlite=null;
let pool=null;
let sqliteInsert=null;
let sqliteTrend=null;

function historyDays(){
  const n=Number(process.env.HISTORY_DAYS||7);
  return Number.isFinite(n)&&n>0?n:7;
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
      try{
        await pool.query("SELECT 1");
        lastError=null;
        break;
      }catch(e){
        lastError=e;
        if(attempt<12) await new Promise(r=>setTimeout(r,2500));
      }
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
        planned_time TEXT,
        current_time TEXT,
        delay_minutes INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        cancelled BOOLEAN NOT NULL DEFAULT FALSE,
        origin TEXT,
        destination TEXT,
        track TEXT,
        payload JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_train_obs_trend
        ON train_observations(source,train_key,station,event_mode,observed_at);
      CREATE INDEX IF NOT EXISTS idx_train_obs_station
        ON train_observations(source,station,observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_train_obs_number
        ON train_observations(source,train_number,observed_at DESC);
    `);
    backend="postgresql";
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
      current_time TEXT,
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
  sqliteInsert=sqlite.prepare(`
    INSERT INTO train_observations (
      source,train_key,train_number,category,station,event_mode,observed_at,
      planned_timestamp,planned_time,current_time,delay_minutes,status,cancelled,
      origin,destination,track,payload
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
  return {backend};
}

export function getStorageInfo(){
  return {backend,historyDays:historyDays(),online:backend==="postgresql"};
}

function rowForStorage(t,source,observedAt){
  return {
    source,
    trainKey:String(t.trainKey||""),
    trainNumber:String(t.number||""),
    category:String(t.category||""),
    station:String(t.observedAt||t.station||""),
    eventMode:String(t.eventMode||t.mode||""),
    observedAt:Number(observedAt),
    plannedTimestamp:Number(t.plannedTimestamp||0)||null,
    plannedTime:String(t.plannedTime||t.time||""),
    currentTime:String(t.currentTime||t.time||""),
    delayMinutes:Number(t.delay||0),
    status:String(t.status||""),
    cancelled:Boolean(t.cancelled),
    origin:String(t.from||""),
    destination:String(t.to||""),
    track:String(t.track||""),
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
          planned_timestamp,planned_time,current_time,delay_minutes,status,cancelled,
          origin,destination,track,payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      `;
      for(const r of rows){
        await client.query(sql,[
          r.source,r.trainKey,r.trainNumber,r.category,r.station,r.eventMode,r.observedAt,
          r.plannedTimestamp,r.plannedTime,r.currentTime,r.delayMinutes,r.status,r.cancelled,
          r.origin,r.destination,r.track,JSON.stringify(r.payload)
        ]);
      }
      await client.query("COMMIT");
    }catch(e){
      await client.query("ROLLBACK");
      throw e;
    }finally{
      client.release();
    }
  }else if(backend==="sqlite"){
    sqlite.exec("BEGIN");
    try{
      for(const r of rows){
        sqliteInsert.run(
          r.source,r.trainKey,r.trainNumber,r.category,r.station,r.eventMode,r.observedAt,
          r.plannedTimestamp,r.plannedTime,r.currentTime,r.delayMinutes,r.status,r.cancelled?1:0,
          r.origin,r.destination,r.track,JSON.stringify(r.payload)
        );
      }
      sqlite.exec("COMMIT");
    }catch(e){
      sqlite.exec("ROLLBACK");
      throw e;
    }
  }

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
  const cutoff=Number(now)-historyDays()*24*60*60*1000;
  if(backend==="postgresql"){
    await pool.query("DELETE FROM train_observations WHERE observed_at < $1",[cutoff]);
  }else if(backend==="sqlite"){
    sqlite.prepare("DELETE FROM train_observations WHERE observed_at < ?").run(cutoff);
  }
}

function clampLimit(v,def=250,max=2000){
  const n=Number(v);
  if(!Number.isFinite(n)||n<1) return def;
  return Math.min(Math.floor(n),max);
}

export async function getHistory({source,trainNumber,station,hours=24,limit=500}={}){
  const cutoff=Date.now()-Math.max(1,Number(hours)||24)*60*60*1000;
  const lim=clampLimit(limit,500,2000);

  if(backend==="postgresql"){
    const values=[cutoff];
    const where=[`observed_at >= $1`];
    if(source){values.push(source);where.push(`source=$${values.length}`);}
    if(trainNumber){values.push(String(trainNumber));where.push(`train_number=$${values.length}`);}
    if(station){values.push(station);where.push(`station=$${values.length}`);}
    values.push(lim);
    const r=await pool.query(`
      SELECT source,train_key,train_number,category,station,event_mode,observed_at,
             planned_timestamp,planned_time,current_time,delay_minutes,status,cancelled,
             origin,destination,track
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
             planned_timestamp,planned_time,current_time,delay_minutes,status,cancelled,
             origin,destination,track
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
  const lim=clampLimit(limit,100,500);

  if(backend==="postgresql"){
    const r=await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (source,train_key,station,event_mode)
          source,train_key,train_number,category,station,event_mode,observed_at,
          planned_timestamp,planned_time,current_time,delay_minutes,status,cancelled,
          origin,destination,track
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
             planned_timestamp,planned_time,current_time,delay_minutes,status,cancelled,
             origin,destination,track
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
