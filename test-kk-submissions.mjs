import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {initKKStore,kkPut} from './kk-store.mjs';
import {validateSubmission,saveSubmission,ownSubmissions,mediaLink} from './kk-submissions.mjs';
const sqlite=new DatabaseSync(':memory:');await initKKStore({sqlite});
const a={id:'a'.repeat(64),displayName:'A'},b={id:'b'.repeat(64)},media=randomUUID();
try{
 assert.doesNotThrow(()=>validateSubmission({kind:'update',text:'Hallo',media:[]}));
 assert.throws(()=>validateSubmission({kind:'update',text:'',media:[]}));
 assert.throws(()=>validateSubmission({kind:'proof',location:{latitude:200,longitude:0,accuracy:1,timestamp:1}}));
 await kkPut('media',media,a.id,{kind:'image'});
 await assert.rejects(saveSubmission(b,{id:randomUUID(),kind:'update',text:'x',media:[media]}),/bestand/);
 const proof=await saveSubmission(a,{id:randomUUID(),kind:'proof',text:'Utrecht Centraal',station:'Utrecht Centraal',stationId:'nl-ut',media:[media],receivedAt:1,createdAt:1});assert.equal(proof.stationId,'nl-ut');assert.ok(proof.receivedAt>1);assert.ok(proof.createdAt>1);
 const data={id:randomUUID(),kind:'update',text:'Hallo',media:[media]};
 await saveSubmission(a,data);await saveSubmission(a,data);
 assert.equal((await ownSubmissions(a)).length,2);assert.equal((await ownSubmissions(b)).length,0);
 await assert.rejects(mediaLink(b,media),/Geen toegang/);
 await assert.rejects(saveSubmission(b,data),/Geen toegang/);
 await assert.rejects(saveSubmission(a,{id:randomUUID(),kind:'proof',text:'Utrecht',media:[]}),/foto/);
 const video=randomUUID();await kkPut('media',video,a.id,{kind:'video'});
 await assert.rejects(saveSubmission(a,{id:randomUUID(),kind:'proof',text:'Utrecht',media:[video]}),/foto/);
 await saveSubmission(a,{id:randomUUID(),kind:'update',text:'Update zonder foto',media:[]});
 assert.equal((await ownSubmissions(a)).length,3);
 console.log('PASS: required media, location validation, ownership, private lists, retry deduplication');
}finally{sqlite.close();}
