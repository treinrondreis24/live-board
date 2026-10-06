import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {sign,verify,endpoint,eventRecord,encrypt,decrypt,subscribe,EVENT} from './expedia-core.mjs';
import {initExpedia,readSubscription,saveSubscription,reserveSubscription,storeEvent,listEvents} from './expedia-store.mjs';
import {createExpediaHandler} from './expedia.mjs';
const env={ADMIN_ENCRYPTION_KEY:'test-only',EXPEDIA_CLIENT_ID:'test-id',EXPEDIA_CLIENT_SECRET:'test-secret'};
const payload={specversion:'1.0',type:EVENT,id:'event-1',time:'2026-10-05T10:00:00Z',data:{itinerary_id:'73559294378081',update_date_time:'2026-10-05T09:59:00Z',status:'Confirmed'}};
const raw=Buffer.from(JSON.stringify(payload)),url=endpoint(env),secret='test-shared-secret';
const authorization=Object.entries(sign(secret,raw,url)).map(([k,v])=>`${k}='${v}'`).join(',');
test('HMAC protects body, host, path and secret; duplicate attributes are rejected',()=>{
 assert.equal(verify(secret,raw,url,'MAC '+authorization),true);
 for(const [body,target,key] of [[Buffer.from('{}'),url,secret],[raw,new URL('/different',url),secret],[raw,new URL('https://different.example/api/expedia/itinerary-events'),secret],[raw,url,'wrong']])assert.equal(verify(key,body,target,'MAC '+authorization),false);
 assert.equal(verify(secret,raw,url,'MAC '+authorization+",ts='1234567890'"),false);
 assert.equal(verify(secret,raw,url,'Bearer '+authorization),false);
});
test('encrypted secret survives storage without exposing plaintext',()=>{const sealed=encrypt(secret,env);assert.ok(!sealed.includes(secret));assert.equal(decrypt(sealed,env),secret);assert.throws(()=>decrypt(sealed,{ADMIN_ENCRYPTION_KEY:'wrong'}));assert.throws(()=>encrypt(secret,{}));});
test('events retain history, retries are idempotent and old updates remain identifiable',async()=>{
 const sqlite=new DatabaseSync(':memory:');await initExpedia({sqlite});
 await storeEvent(eventRecord(raw));await storeEvent(eventRecord(raw));
 const older={...payload,id:'older',data:{...payload.data,update_date_time:'2026-10-04T10:00:00Z'}};await storeEvent(eventRecord(Buffer.from(JSON.stringify(older))));
 assert.equal((await listEvents(payload.data.itinerary_id)).length,2);assert.equal((await listEvents('unknown')).length,0);
 await saveSubscription({secret:encrypt(secret,env)});assert.equal(decrypt((await readSubscription()).secret,env),secret);sqlite.close();
});
test('activation lists first, saves encrypted secret and does not create duplicate subscriptions',async()=>{
 let config={},created=0,subscriptions=[];const calls=[];
 const fetcher=async(target,options)=>{calls.push(target);if(target.endsWith('/oauth/token'))return Response.json({access_token:'token'});if(options.method==='POST'){created++;subscriptions=[{subscription_id:'subscription-1',endpoint:url.href,event_type:EVENT}];return Response.json({...subscriptions[0],shared_secret:secret},{status:201});}return Response.json(subscriptions);};
 const deps={env,fetcher,read:async()=>config,reserve:async value=>{config=value;return true;},save:async value=>{config=value;}};
 assert.equal((await subscribe(deps)).active,true);assert.equal(created,1);assert.equal(decrypt(config.secret,env),secret);assert.ok(calls[1].endsWith('/subscriptions'));
 await subscribe(deps);assert.equal(created,1);
 config={};await assert.rejects(subscribe(deps),/sleutel ontbreekt/);assert.equal(created,1);
});
test('receiver only acknowledges persisted signed data; admin endpoints require authentication and origin',async()=>{
 let stored=0,fail=false;
 const handler=createExpediaHandler({env,authenticate:async req=>req.headers.testauth==='yes',read:async()=>({secret:encrypt(secret,env),state:'active'}),list:async()=>[],store:async()=>{if(fail)throw Error('db down');stored++;}});
 async function call(path,method='GET',headers={},body=raw){const req=Readable.from([body]);req.method=method;req.headers=headers;const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code){this.code=code;},end(body){this.body=body;}};await handler(req,res,new URL(path,url));return res;}
 assert.equal((await call(url.pathname,'POST',{authorization:'MAC '+authorization})).code,200);assert.equal(stored,1);
 assert.equal((await call(url.pathname,'POST',{authorization:'bad'})).code,401);assert.equal(stored,1);
 fail=true;assert.equal((await call(url.pathname,'POST',{authorization:'MAC '+authorization})).code,503);
 assert.equal((await call('/seinhuis/flora/expedia/status')).code,401);
 const status=await call('/seinhuis/flora/expedia/status','GET',{testauth:'yes'});assert.equal(status.code,200);assert.ok(!status.body.includes(secret));
 assert.equal((await call('/seinhuis/flora/expedia/activate','POST',{testauth:'yes',origin:'https://attacker.example'})).code,403);
});
