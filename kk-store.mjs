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
export async function kkInsert(kind,id,owner,value){return (await query('INSERT INTO kk_records(kind,id,owner,created,expires,payload) VALUES($1,$2,$3,$4,0,$5) ON CONFLICT(kind,id) DO NOTHING RETURNING id',[kind,id,owner,Date.now(),JSON.stringify(value)])).length===1;}
export async function kkTake(kind,id){const [r]=await query('DELETE FROM kk_records WHERE kind=$1 AND id=$2 RETURNING *',[kind,id]);return r?{...r,value:JSON.parse(r.payload)}:null;}
export async function kkList(kind,owner=null){const args=[kind];let sql='SELECT * FROM kk_records WHERE kind=$1';if(owner!==null){args.push(owner);sql+=' AND owner=$2';}sql+=' ORDER BY created DESC LIMIT 200';return (await query(sql,args)).map(r=>({...r,value:JSON.parse(r.payload)}));}
// Atomic fixed-window limiter, shared across replicas; no raw IP addresses stored.
export async function kkLimit(id,max,windowMs){const now=Date.now();const rows=await query(`INSERT INTO kk_records(kind,id,owner,created,expires,payload) VALUES('limit',$1,'',$2,$3,'1') ON CONFLICT(kind,id) DO UPDATE SET payload=CASE WHEN kk_records.expires<=$2 THEN '1' ELSE CAST(CAST(kk_records.payload AS INTEGER)+1 AS TEXT) END,expires=CASE WHEN kk_records.expires<=$2 THEN $3 ELSE kk_records.expires END RETURNING payload`,[id,now,now+windowMs]);return Number(rows[0].payload)<=max;}
export async function kkCleanup(){await query('DELETE FROM kk_records WHERE expires>0 AND expires<$1 RETURNING id',[Date.now()]);}
export async function kkUpdateRows(before='',teams=[]){
 const kind=db.pool?"r.payload::jsonb->>'kind'":"json_extract(r.payload,'$.kind')",member=db.pool?"m.payload::jsonb->>'teamId'":"json_extract(m.payload,'$.teamId')";
 const args=[];let where="r.kind='submission' AND "+kind+"='update'";
 if(before){const match=/^(\d{16}):([a-f0-9-]{36})$/.exec(before);if(!match)throw Object.assign(Error('Ongeldige pagina.'),{status:400});args.push(Number(match[1]),match[2]);where+=' AND (r.created<$1 OR (r.created=$1 AND r.id<$2))';}
 if(teams.length){const slots=teams.map(t=>{args.push(t);return '$'+args.length;});where+=" AND COALESCE("+member+",'solo-' || r.owner) IN ("+slots.join(',')+")";}
 return (await query("SELECT r.* FROM kk_records r LEFT JOIN kk_records m ON m.kind='team-member' AND m.id=r.owner WHERE "+where+" ORDER BY r.created DESC,r.id DESC LIMIT 31",args)).map(r=>({...r,value:JSON.parse(r.payload)}));
}

export async function kkAdminSubmissions(options={}){
 const args=[],bind=v=>{args.push(v);return '$'+args.length;};
 const field=(alias,key)=>db.pool?alias+".payload::jsonb->>'"+key+"'":"json_extract("+alias+".payload,'$."+key+"')";
 if(!['proof','update'].includes(options.kind))throw Object.assign(Error('Kies bewijs of updates.'),{status:400});
 let where="r.kind='submission' AND "+field('r','kind')+'='+bind(options.kind);
 if(options.owner)where+=' AND r.owner='+bind(options.owner);
 if(options.edition){if(!['12','24'].includes(String(options.edition)))throw Object.assign(Error('Ongeldige editie.'),{status:400});where+=' AND CAST('+field('p','edition')+' AS TEXT)='+bind(String(options.edition));}
 for(const [key,op] of [['from','>='],['until','<=']])if(options[key]){const value=Number(options[key]);if(!Number.isSafeInteger(value)||value<0)throw Object.assign(Error('Ongeldig tijdstip.'),{status:400});where+=' AND r.created'+op+bind(value);}
 for(const [key,columns] of [['q',[field('r','text'),field('r','displayName'),field('p','fullName')]],['station',[field('r','station')]]])if(options[key]){const needle=String(options[key]).slice(0,200).toLowerCase().replace(/[!%_]/g,x=>'!'+x);const slot=bind('%'+needle+'%');where+=' AND ('+columns.map(c=>"LOWER(COALESCE("+c+",'')) LIKE "+slot+" ESCAPE '!'").join(' OR ')+')';}
 if(options.team)where+=' AND '+field('m','teamId')+'='+bind(String(options.team));
 const joins=" FROM kk_records r LEFT JOIN kk_records p ON p.kind='participant' AND p.id=r.owner LEFT JOIN kk_records m ON m.kind='team-member' AND m.id=r.owner WHERE ";
 const [count]=await query('SELECT COUNT(*) AS total'+joins+where,args);const total=Number(count.total),pages=Math.max(1,Math.ceil(total/50)),page=Math.min(pages,Math.max(1,Math.floor(Number(options.page)||1)));const order=options.order==='asc'?'ASC':'DESC';
 const rows=await query('SELECT r.*,'+field('p','fullName')+' AS participant_name'+joins+where+' ORDER BY r.created '+order+',r.id '+order+' LIMIT 50 OFFSET '+((page-1)*50),args);
 return {total,page,pages,submissions:rows.map(r=>({...JSON.parse(r.payload),id:r.id,owner:r.owner,participantName:r.participant_name,createdAt:Number(r.created)}))};
}

export async function kkPatchParticipant(id,changes){const merge=db.pool?"(payload::jsonb || $2::jsonb)::text":"json_patch(payload,$2)";const [row]=await query("UPDATE kk_records SET payload="+merge+" WHERE kind='participant' AND id=$1 RETURNING payload",[id,JSON.stringify(changes)]);return row?JSON.parse(row.payload):null;}
