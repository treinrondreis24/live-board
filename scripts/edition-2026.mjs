// One-time, additive PostgreSQL migration. Defaults to a rollback-only rehearsal.
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const eventKinds=['participant','submission','media','claim','claim-admin-history','hilta-current','hilta-proposal','hilta-confirmation','hilta-admin-proposal','hilta-admin-confirmation','blog-draft','blog-public','feature','feature-active','feature-vote','team','team-member'];
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export function plan2026(rows){
 const participants=new Map(rows.filter(r=>r.kind==='participant').map(r=>[r.id,JSON.parse(r.payload)]));
 return rows.filter(r=>eventKinds.includes(r.kind)).map(r=>{
  const own=JSON.parse(r.payload),p=r.kind==='participant'?own:participants.get(r.owner);
  if((own.competitionYear&&Number(own.competitionYear)!==2026)||(p?.competitionYear&&Number(p.competitionYear)!==2026))throw Error('Non-2026 data encountered; no automatic reassignment.');
  const edition=Number(own.edition||p?.edition||0),known=[12,24].includes(edition);
  if(edition&&!known)throw Error('Unexpected edition; review required.');
  const scoring_version=p?`2026-${known?edition:24}-v1`:null;
  if(own.scoringVersion&&own.scoringVersion!==scoring_version)throw Error('Conflicting rules version.');
  return {kind:r.kind,id:r.id,edition_id:!p?'2026-shared':known?`2026-${edition}`:'2026-unassigned',scoring_version,legacy_default:!!p&&!known};
 });
}
export async function ruleSnapshot(root){
 const names=['hilta-network.json','kk-scoring.mjs','kk-hilta.mjs','kk-hilta-admin.mjs','kk-scorecard.mjs','kk-scorekaart-leeg.xlsx'];
 const files={};for(const name of names){const bytes=await readFile(path.join(root,name));files[name]={sha256:digest(bytes),encoding:'base64',content:bytes.toString('base64')};}
 const network=JSON.parse(Buffer.from(files['hilta-network.json'].content,'base64').toString('utf8').replace(/^\uFEFF/,''));
 const rules={year:2026,versions:['2026-12-v1','2026-24-v1'],unit:'km',checkpoint:'Rotterdam Centraal',ordinaryMaxBefore:1,ordinaryMaxAfter:1,exceptionMaxBefore:2,exceptionMaxAfter:2,exceptions:['Meppel–Zwolle','Roermond–Sittard'],networkSourceHash:network.sha256,network,notes:['Snapshot of the implemented 2026 calculation, not a new interpretation of competition regulations.','Unknown edition uses the existing 24-hour calculation fallback without assigning the participant to that edition.','Existing Sauwerd distances remain unchanged.','Amsterdam Zuid splitting, partial routes, proof order and confirmation validation are frozen in the included source files.']};
 return {hash:digest({rules,files}),rules,files};
}
export async function migrate2026(client,snapshot,{apply=false}={}){
 await client.query('BEGIN');try{
  await client.query("SET LOCAL lock_timeout='10s'");
  await client.query('LOCK TABLE kk_records IN SHARE ROW EXCLUSIVE MODE');
  const rows=(await client.query('SELECT * FROM kk_records ORDER BY kind,id')).rows;
  const plan=plan2026(rows),before=digest(rows);
  await client.query(`CREATE TABLE IF NOT EXISTS kk_rule_snapshots(id text PRIMARY KEY,sha256 text NOT NULL,definition jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS kk_editions(id text PRIMARY KEY,competition_year integer NOT NULL,duration_hours integer,rule_snapshot_id text NOT NULL REFERENCES kk_rule_snapshots(id));
   CREATE TABLE IF NOT EXISTS kk_record_editions(kind text NOT NULL,id text NOT NULL,edition_id text NOT NULL REFERENCES kk_editions(id),scoring_version text,legacy_default boolean NOT NULL DEFAULT false,linked_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,id),FOREIGN KEY(kind,id) REFERENCES kk_records(kind,id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS kk_record_editions_edition ON kk_record_editions(edition_id,kind);
   CREATE TABLE IF NOT EXISTS kk_edition_migrations(id text PRIMARY KEY,report jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());`);
  const old=(await client.query("SELECT sha256 FROM kk_rule_snapshots WHERE id='2026-v1'")).rows[0];
  if(old&&old.sha256!==snapshot.hash)throw Error('2026 snapshot already exists with different files; refusing overwrite.');
  await client.query("INSERT INTO kk_rule_snapshots VALUES('2026-v1',$1,$2,now()) ON CONFLICT(id) DO NOTHING",[snapshot.hash,JSON.stringify(snapshot)]);
  await client.query("INSERT INTO kk_editions VALUES('2026-12',2026,12,'2026-v1'),('2026-24',2026,24,'2026-v1'),('2026-unassigned',2026,NULL,'2026-v1'),('2026-shared',2026,NULL,'2026-v1') ON CONFLICT(id) DO NOTHING");
  const definitions=(await client.query("SELECT * FROM kk_editions WHERE competition_year=2026 ORDER BY id")).rows;
  if(definitions.length!==4||definitions.some(e=>e.rule_snapshot_id!=='2026-v1'||e.duration_hours!==({'2026-12':12,'2026-24':24}[e.id]??null)))throw Error('Conflicting edition definitions.');
  await client.query(`INSERT INTO kk_record_editions(kind,id,edition_id,scoring_version,legacy_default) SELECT kind,id,edition_id,scoring_version,legacy_default FROM jsonb_to_recordset($1::jsonb) AS x(kind text,id text,edition_id text,scoring_version text,legacy_default boolean) ON CONFLICT(kind,id) DO NOTHING`,[JSON.stringify(plan)]);
  const linked=(await client.query('SELECT kind,id,edition_id,scoring_version,legacy_default FROM kk_record_editions ORDER BY kind,id')).rows;
  const actual=new Map(linked.map(r=>[r.kind+':'+r.id,r]));
  for(const r of plan)if(JSON.stringify(actual.get(r.kind+':'+r.id))!==JSON.stringify(r))throw Error('Existing record has conflicting edition metadata.');
  // The live app still serves only 2026. Preserve links on corrections; classify new
  // 2026 evidence/uploads through the participant, without touching any payload.
  // New-edition app work must replace this guard before writing other years here.
  const kinds=eventKinds.map(k=>"'"+k+"'").join(',');
  await client.query(`CREATE OR REPLACE FUNCTION kk_link_2026_insert() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE p jsonb; v jsonb; ed integer; has_participant boolean; target text; version text;
   BEGIN
    IF NEW.kind NOT IN (${kinds}) THEN RETURN NEW; END IF;
    v:=NEW.payload::jsonb;
    IF NEW.kind='participant' THEN p:=v; ELSE SELECT payload::jsonb INTO p FROM kk_records WHERE kind='participant' AND id=NEW.owner; END IF;
    has_participant:=p IS NOT NULL;
    IF COALESCE(NULLIF(v->>'competitionYear','')::integer,NULLIF(p->>'competitionYear','')::integer,2026)<>2026 THEN RAISE EXCEPTION 'Edition must be registered before non-2026 records are written'; END IF;
    ed:=COALESCE(NULLIF(NULLIF(v->>'edition',''),'0')::integer,NULLIF(NULLIF(p->>'edition',''),'0')::integer,0);
    IF ed NOT IN (0,12,24) THEN RAISE EXCEPTION 'Unknown edition'; END IF;
    target:=CASE WHEN NOT has_participant THEN '2026-shared' WHEN ed=0 THEN '2026-unassigned' ELSE '2026-'||ed END;
    version:=CASE WHEN has_participant THEN '2026-'||CASE WHEN ed=0 THEN 24 ELSE ed END||'-v1' ELSE NULL END;
    IF v->>'scoringVersion' IS NOT NULL AND v->>'scoringVersion' IS DISTINCT FROM version THEN RAISE EXCEPTION 'Conflicting scoring version'; END IF;
    INSERT INTO kk_record_editions(kind,id,edition_id,scoring_version,legacy_default) VALUES(NEW.kind,NEW.id,target,version,has_participant AND ed=0) ON CONFLICT(kind,id) DO NOTHING;
    RETURN NEW;
   END $$;
   DROP TRIGGER IF EXISTS kk_link_2026_insert ON kk_records;
   CREATE TRIGGER kk_link_2026_insert AFTER INSERT ON kk_records FOR EACH ROW EXECUTE FUNCTION kk_link_2026_insert();`);
  const probe='edition-migration-probe-'+randomUUID();
  await client.query("INSERT INTO kk_records VALUES('participant',$1,$1,0,0,'{\"edition\":12}'),('submission',$2,$1,0,0,'{\"kind\":\"proof\"}'),('media',$3,'editor-probe',0,0,'{}')",[probe,probe+'-proof',probe+'-media']);
  const probes=(await client.query('SELECT id,edition_id,scoring_version FROM kk_record_editions WHERE id=ANY($1::text[])',[ [probe,probe+'-proof',probe+'-media'] ])).rows;
  if(probes.length!==3||probes.some(p=>p.edition_id!==(p.id.endsWith('-media')?'2026-shared':'2026-12')))throw Error('New-record linkage probe failed.');
  await client.query('SAVEPOINT future_year_probe');let rejected=false;
  try{await client.query("INSERT INTO kk_records VALUES('participant',$1,$1,0,0,'{\"edition\":12,\"competitionYear\":2028}')",[probe+'-future']);}catch{rejected=true;}
  await client.query('ROLLBACK TO SAVEPOINT future_year_probe');
  if(!rejected)throw Error('Future-year isolation probe failed.');
  await client.query('DELETE FROM kk_records WHERE id=ANY($1::text[])',[[probe,probe+'-proof',probe+'-media']]);
  if((await client.query('SELECT 1 FROM kk_record_editions WHERE id=ANY($1::text[])',[[probe,probe+'-proof',probe+'-media']])).rows.length)throw Error('Cascade probe failed.');
  const after=digest((await client.query('SELECT * FROM kk_records ORDER BY kind,id')).rows);
  if(before!==after)throw Error('Source records changed; rolling back.');
  const counts={};for(const p of plan)counts[p.edition_id]=(counts[p.edition_id]||0)+1;
  const report={mode:apply?'applied':'dry-run',linked:plan.length,counts,originalRecords:rows.length,originalRecordsUnchanged:true,insertAndIsolationProbesPassed:true,recordsHash:before,rulesHash:snapshot.hash,excludedKinds:[...new Set(rows.filter(r=>!eventKinds.includes(r.kind)).map(r=>r.kind))]};
  await client.query("INSERT INTO kk_edition_migrations(id,report) VALUES('2026-explicit-v1',$1) ON CONFLICT(id) DO NOTHING",[JSON.stringify(report)]);
  await client.query(apply?'COMMIT':'ROLLBACK');return report;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {default:pg}=await import('pg');const root=process.env.KK_APP_ROOT||fileURLToPath(new URL('../',import.meta.url));
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try{console.log(JSON.stringify(await migrate2026(client,await ruleSnapshot(root),{apply:process.argv.includes('--apply')})));}finally{await client.end();}
}
