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

export async function kkUpdateRows(before='',teams=[],q='',participantId='',after=''){
 const field=(a,k)=>db.pool?a+".payload::jsonb->>'"+k+"'":"json_extract("+a+".payload,'$."+k+"')";
 const args=[],bind=v=>{args.push(v);return '$'+args.length;};let where="r.kind='submission' AND "+field('r','kind')+"='update'";
 for(const [value,op] of [[before,'<'],[after,'>']])if(value){const match=/^(\d{16}):([a-f0-9-]{36})$/.exec(value);if(!match)throw Object.assign(Error('Ongeldige pagina.'),{status:400});const t=bind(Number(match[1])),id=bind(match[2]);where+=' AND (r.created'+op+t+' OR (r.created='+t+' AND r.id'+op+id+'))';}
 if(q)where+=' AND LOWER('+field('r','displayName')+") LIKE "+bind('%'+String(q).slice(0,100).toLowerCase().replace(/[!%_]/g,x=>'!'+x)+'%')+" ESCAPE '!'";
 if(participantId)where+=' AND r.owner='+bind(String(participantId));
 if(teams.length)where+=" AND COALESCE("+field('m','teamId')+",'solo-' || r.owner) IN ("+teams.map(bind).join(',')+")";
 const base=" FROM kk_records r LEFT JOIN kk_records m ON m.kind='team-member' AND m.id=r.owner WHERE "+where;
 if(after){const [r]=await query('SELECT COUNT(*) AS total'+base,args);return Number(r.total);}
 return (await query('SELECT r.*'+base+' ORDER BY r.created DESC,r.id DESC LIMIT 31',args)).map(r=>({...r,value:JSON.parse(r.payload)}));
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

export async function kkPreviousProof(row){const kind=db.pool?"payload::jsonb->>'kind'":"json_extract(payload,'$.kind')";const [p]=await query("SELECT * FROM kk_records WHERE kind='submission' AND owner=$1 AND "+kind+"='proof' AND (created<$2 OR (created=$2 AND id<$3)) ORDER BY created DESC,id DESC LIMIT 1",[row.owner,Number(row.created),row.id]);return p?{...p,value:JSON.parse(p.payload)}:null;}
export async function kkScoreRows(owner=null){const field=(a,k)=>db.pool?a+".payload::jsonb->>'"+k+"'":"json_extract("+a+".payload,'$."+k+"')";const rows=await query("SELECT p.payload, MAX(s.created) AS last_proof, COUNT(s.id) AS proofs, SUM(CASE WHEN "+field('h','status')+"='participant-confirmed' THEN CAST("+field('h','km')+" AS REAL) ELSE 0 END) AS km, SUM(CASE WHEN s.id IS NOT NULL AND COALESCE("+field('h','status')+",'')<>'participant-confirmed' THEN 1 ELSE 0 END) AS pending FROM kk_records p LEFT JOIN kk_records s ON s.kind='submission' AND s.owner=p.id AND "+field('s','kind')+"='proof' LEFT JOIN kk_records h ON h.kind='hilta-current' AND h.id=s.id WHERE p.kind='participant'"+(owner?" AND p.id=$1":"")+" GROUP BY p.id,p.payload",owner?[owner]:[]);return rows.map(r=>({participant:JSON.parse(r.payload),lastProof:r.last_proof==null?null:Number(r.last_proof),proofs:Number(r.proofs),km:Math.round(Number(r.km||0)*10)/10,pending:Number(r.pending||0)}));}

export async function kkOwned(owner){return (await query('SELECT * FROM kk_records WHERE owner=$1',[owner])).map(r=>({...r,value:JSON.parse(r.payload)}));}
export async function kkDeleteOwner(owner){await query('DELETE FROM kk_records WHERE owner=$1 RETURNING id',[owner]);}
export async function kkRemoveQuotes(ids){for(const kind of ['blog-draft','blog-public']){const rows=await query('SELECT * FROM kk_records WHERE kind=$1',[kind]);for(const r of rows){const value=JSON.parse(r.payload);if(ids.includes(value.quote?.id)){value.quote=null;value.updatedAt=Date.now();await kkPut(kind,r.id,r.owner,value);}}}}

export async function kkJourneyRoutes(owner){const rows=await query("SELECT s.id,h.payload FROM kk_records s LEFT JOIN kk_records h ON h.kind='hilta-current' AND h.id=s.id WHERE s.kind='submission' AND s.owner=$1",[owner]);return rows.map(r=>({proofId:r.id,status:r.payload?JSON.parse(r.payload).status:null}));}
