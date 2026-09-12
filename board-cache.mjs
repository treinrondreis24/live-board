let db;
export async function initBoardCache({backend,pool,sqlite}){
 db={backend,pool,sqlite};
 const securitySql='CREATE TABLE IF NOT EXISTS admin_security (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)';
 if(pool)await pool.query(securitySql);else sqlite.exec(securitySql);
 const sql='CREATE TABLE IF NOT EXISTS app_station_usage (station TEXT PRIMARY KEY, additions BIGINT NOT NULL); CREATE TABLE IF NOT EXISTS board_cache (cache_key TEXT PRIMARY KEY, updated_at BIGINT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS board_settings (page TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at BIGINT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS board_layouts (layout_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, updated_at BIGINT NOT NULL, appearance TEXT NOT NULL)';
 if(pool)await pool.query(sql);else sqlite.exec(sql);
}
// Security state is not subject to train-data retention. Compare-and-swap prevents
// concurrent use of recovery codes and TOTP counters, including across replicas.
export async function readAdminSecurity(){
 const r=db.pool?(await db.pool.query('SELECT revision,payload FROM admin_security WHERE id=1')).rows[0]:db.sqlite.prepare('SELECT revision,payload FROM admin_security WHERE id=1').get();
 return r?{revision:Number(r.revision),value:JSON.parse(r.payload)}:{revision:0,value:null};
}
export async function writeAdminSecurity(value,revision){
 const sql='INSERT INTO admin_security(id,revision,payload) VALUES(1,1,$1) ON CONFLICT(id) DO UPDATE SET revision=admin_security.revision+1,payload=excluded.payload WHERE admin_security.revision=$2 RETURNING revision';
 const args=[JSON.stringify(value),revision];
 const r=db.pool?(await db.pool.query(sql,args)).rows[0]:db.sqlite.prepare(sql.replace(/\$\d/g,'?')).get(...args);
 if(!r){const e=Error('De beveiligingsinstellingen zijn ondertussen gewijzigd. Probeer opnieuw.');e.status=409;throw e;}
 return Number(r.revision);
}
// Board configuration is reference data and is deliberately outside train retention.
export async function readBoardSettings(){
 const rows=db.pool?(await db.pool.query('SELECT * FROM board_settings')).rows:db.sqlite.prepare('SELECT * FROM board_settings').all();
 return rows.map(r=>({page:r.page,revision:Number(r.revision),updatedAt:Number(r.updated_at),settings:JSON.parse(r.payload)}));
}
export async function insertBoardSettings(page,settings){
 const now=Date.now(),sql='INSERT INTO board_settings(page,revision,updated_at,payload) VALUES($1,1,$2,$3) ON CONFLICT(page) DO NOTHING RETURNING revision';
 const args=[page,now,JSON.stringify(settings)];
 const row=db.pool?(await db.pool.query(sql,args)).rows[0]:db.sqlite.prepare(sql.replace(/\$\d/g,'?')).get(...args);
 return row?{revision:1,updatedAt:now}:null;
}
export async function writeBoardSettings(page,settings,revision){
 const now=Date.now(),payload=JSON.stringify(settings);
 const sql='INSERT INTO board_settings(page,revision,updated_at,payload) VALUES($1,1,$2,$3) ON CONFLICT(page) DO UPDATE SET revision=board_settings.revision+1,updated_at=excluded.updated_at,payload=excluded.payload WHERE board_settings.revision=$4 RETURNING revision';
 let row;
 if(db.pool)row=(await db.pool.query(sql,[page,now,payload,revision])).rows[0];
 else row=db.sqlite.prepare(sql.replace(/\$\d/g,'?')).get(page,now,payload,revision);
 if(!row){const error=Error('Dit bord is ondertussen gewijzigd. Laad het opnieuw voordat je opslaat.');error.status=409;throw error;}
 return {revision:Number(row.revision),updatedAt:now};
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

export async function readBoardLayouts(){
 const rows=db.pool?(await db.pool.query('SELECT * FROM board_layouts ORDER BY name')).rows:db.sqlite.prepare('SELECT * FROM board_layouts ORDER BY name').all();
 return rows.map(r=>({id:r.layout_id,name:r.name,updatedAt:Number(r.updated_at),appearance:JSON.parse(r.appearance)}));
}
export async function createBoardLayout(id,name,appearance){
 const now=Date.now(),sql='INSERT INTO board_layouts(layout_id,name,updated_at,appearance) VALUES($1,$2,$3,$4) ON CONFLICT(name) DO NOTHING RETURNING layout_id';
 const args=[id,name,now,JSON.stringify(appearance)];
 const row=db.pool?(await db.pool.query(sql,args)).rows[0]:db.sqlite.prepare(sql.replace(/\$\d/g,'?')).get(...args);
 if(!row){const e=Error('Deze layoutnaam bestaat al. Kies een andere naam.');e.status=409;throw e;}
 return {id,name,updatedAt:now,appearance};
}

export async function recordAppStationAdded(station){
 const sql='INSERT INTO app_station_usage(station,additions) VALUES($1,1) ON CONFLICT(station) DO UPDATE SET additions=app_station_usage.additions+1';
 if(db.pool)await db.pool.query(sql,[station]);else db.sqlite.prepare(sql.replace('$1','?')).run(station);
}
