let db;
export async function initBoardCache({backend,pool,sqlite}){
 db={backend,pool,sqlite};
 const sql='CREATE TABLE IF NOT EXISTS board_cache (cache_key TEXT PRIMARY KEY, updated_at BIGINT NOT NULL, payload TEXT NOT NULL)';
 if(pool)await pool.query(sql);else sqlite.exec(sql);
}
export async function saveBoardCache(key,value,at=Date.now()){
 if(!db)return;
 const data=JSON.stringify(value);
 if(db.pool)await db.pool.query('INSERT INTO board_cache VALUES($1,$2,$3) ON CONFLICT(cache_key) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload',[key,at,data]);
 else db.sqlite.prepare('INSERT INTO board_cache VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload').run(key,at,data);
}
export async function loadBoardCache(key,maxAge=3*86400000){
 if(!db)return null;
 const row=db.pool?(await db.pool.query('SELECT payload FROM board_cache WHERE cache_key=$1 AND updated_at>=$2',[key,Date.now()-maxAge])).rows[0]:db.sqlite.prepare('SELECT payload FROM board_cache WHERE cache_key=? AND updated_at>=?').get(key,Date.now()-maxAge);
 return row?JSON.parse(row.payload):null;
}
export const retentionPolicy={defaultDays:3,extendedDays:30,extendedCategories:['ICE','NJ','RJ'],mode:'changes-only'};
let cleaning=false;
export async function cleanupHistory(now=Date.now()){
 if(!db||cleaning)return;cleaning=true;
 const cutoff=now-3*86400000,longCutoff=now-30*86400000;
 const dated=(column='category')=>`CASE WHEN UPPER(COALESCE(${column},'')) IN ('ICE','NJ','RJ') THEN ${longCutoff} ELSE ${cutoff} END`;
 const cat=db.pool?"(state_json::jsonb->>'category')":"json_extract(state_json,'$.category')";
 const shortDate=new Date(cutoff).toISOString().slice(0,10),longDate=new Date(longCutoff).toISOString().slice(0,10);
 const dateLimit=column=>`CASE WHEN UPPER(COALESCE(${column},'')) IN ('ICE','NJ','RJ') THEN '${longDate}' ELSE '${shortDate}' END`;
 const tables=[
  ['train_observations','id',`observed_at<${dated()} AND COALESCE(planned_timestamp,0)<${dated()}`],
  ['event_observations','observation_uid',`observed_at<${dated()} AND COALESCE(planned_timestamp,0)<${dated()}`],
  ['event_current_state','event_key',`service_uid IN (SELECT service_uid FROM service_runs WHERE service_date<${dateLimit('category')})`],
  ['service_runs','service_uid',`service_date<${dateLimit('category')}`],
  ['train_observation_state','state_key',`last_seen_at<${longCutoff}`],
  ['ingest_batches','batch_uid',`observed_at<${cutoff}`],
  ['journey_archive_revisions','revision_id',`journey_id IN (SELECT journey_id FROM journey_archive WHERE service_date<${dateLimit(cat)})`],
  ['journey_archive','journey_id',`service_date<${dateLimit(cat)}`],
  ['board_cache','cache_key',`updated_at<${cutoff}`]
 ];
 try{for(const [table,key,where] of tables){
  let count;
  do{const sql=`DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE ${where} LIMIT 1000)`;
   count=db.pool?(await db.pool.query(sql)).rowCount:Number(db.sqlite.prepare(sql).run().changes);
   if(count===1000)await new Promise(r=>setTimeout(r,50));
  }while(count===1000);
 }}finally{cleaning=false;}
}
