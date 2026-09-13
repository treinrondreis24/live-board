let db;
export async function initKKStore(connection){
 db=connection;
 const sql=`CREATE TABLE IF NOT EXISTS kk_records (kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,created BIGINT NOT NULL,expires BIGINT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE INDEX IF NOT EXISTS kk_owner ON kk_records(kind,owner,created);
 CREATE INDEX IF NOT EXISTS kk_expiry ON kk_records(expires);`;
 if(db.pool)await db.pool.query(sql);else db.sqlite.exec(sql);
}
async function query(sql,args=[]){if(db.pool)return (await db.pool.query(sql,args)).rows;const values=[];const sqliteSQL=sql.replace(/\$(\d+)/g,(_,n)=>{values.push(args[Number(n)-1]);return '?';});return db.sqlite.prepare(sqliteSQL).all(...values);}
export async function kkGet(kind,id){const [r]=await query('SELECT * FROM kk_records WHERE kind=$1 AND id=$2',[kind,id]);return r?{...r,value:JSON.parse(r.payload)}:null;}
export async function kkPut(kind,id,owner,value,expires=0){await query('INSERT INTO kk_records(kind,id,owner,created,expires,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,expires=excluded.expires RETURNING id',[kind,id,owner,Date.now(),expires,JSON.stringify(value)]);}
export async function kkDelete(kind,id){await query('DELETE FROM kk_records WHERE kind=$1 AND id=$2 RETURNING id',[kind,id]);}
export async function kkTake(kind,id){const [r]=await query('DELETE FROM kk_records WHERE kind=$1 AND id=$2 RETURNING *',[kind,id]);return r?{...r,value:JSON.parse(r.payload)}:null;}
export async function kkList(kind,owner=null){const args=[kind];let sql='SELECT * FROM kk_records WHERE kind=$1';if(owner!==null){args.push(owner);sql+=' AND owner=$2';}sql+=' ORDER BY created DESC LIMIT 200';return (await query(sql,args)).map(r=>({...r,value:JSON.parse(r.payload)}));}
// Atomic fixed-window limiter, shared across replicas; no raw IP addresses stored.
export async function kkLimit(id,max,windowMs){const now=Date.now();const rows=await query(`INSERT INTO kk_records(kind,id,owner,created,expires,payload) VALUES('limit',$1,'',$2,$3,'1') ON CONFLICT(kind,id) DO UPDATE SET payload=CASE WHEN kk_records.expires<=$2 THEN '1' ELSE CAST(CAST(kk_records.payload AS INTEGER)+1 AS TEXT) END,expires=CASE WHEN kk_records.expires<=$2 THEN $3 ELSE kk_records.expires END RETURNING payload`,[id,now,now+windowMs]);return Number(rows[0].payload)<=max;}
export async function kkCleanup(){await query('DELETE FROM kk_records WHERE expires>0 AND expires<$1 RETURNING id',[Date.now()]);}
