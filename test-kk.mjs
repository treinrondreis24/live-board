import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {initBoardCache} from './board-cache.mjs';
import {kkGet,kkPut,kkLimit} from './kk-store.mjs';
import {handleKilometerkampioen,validateProfile} from './kk-handler.mjs';
import {BoundedCache} from './bounded-cache.mjs';
const sqlite=new DatabaseSync(':memory:');await initBoardCache({sqlite});
process.env.KK_AUTH_SECRET='unit-test-only-secret';process.env.RESEND_API_KEY='test';process.env.KK_EMAIL_FROM='test@example.org';
let mail,requests=0;const originalFetch=globalThis.fetch;globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://api.resend.com/emails');mail=JSON.parse(opts.body);requests++;return {ok:true};};
async function request(action,data,cookie='',origin='https://example.org'){
 const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=data?'POST':'GET';req.headers={host:'example.org',origin,cookie};req.socket={remoteAddress:'127.0.0.1'};
 let raw='',status,headers={};const res={setHeader(k,v){headers[k]=v;},writeHead(s,h){status=s;Object.assign(headers,h);},end(v){raw=v||'';}};
 await handleKilometerkampioen(req,res,new URL(action,'https://example.org'));return {status,headers,data:raw?JSON.parse(raw):null};
}
try{
 let r=await request('/kilometerkampioen/api/profile',{fullName:'x'});assert.equal(r.status,401);
 r=await request('/kilometerkampioen/api/request-code',{email:'person@example.org'},'','https://evil.example');assert.equal(r.status,403);assert.equal(requests,0);
 r=await request('/kilometerkampioen/api/request-code',{email:'Person@example.org'});assert.equal(r.status,200);const challenge=r.data.challenge,code=mail.text.match(/\b\d{6}\b/)[0];assert.equal(mail.to[0],'person@example.org');assert.ok(!(await kkGet('challenge',challenge)).payload.includes(code));
 r=await request('/kilometerkampioen/api/verify-code',{challenge,code});assert.equal(r.status,200);const cookie=r.headers['Set-Cookie'].split(';')[0];assert.match(r.headers['Set-Cookie'],/HttpOnly; Secure/);assert.equal((await request('/kilometerkampioen/api/verify-code',{challenge,code})).status,401);
 r=await request('/kilometerkampioen/api/profile',{fullName:'Jamie',displayName:'Jamie op reis',edition:24,startTime:'06:00',distance:'',station:'Utrecht'},cookie);assert.equal(r.status,200);assert.equal(r.data.participant.email,'person@example.org');
 assert.equal((await request('/kilometerkampioen/api/session',null,cookie)).data.participant.fullName,'Jamie');
 assert.equal((await request('/treinhuis/api/participants')).status,401);
 assert.equal((await request('/treinhuis/api/blog')).status,401);
 assert.equal((await request('/treinhuis/api/blog-publish',{id:'test'})).status,401);
 assert.equal((await request('/treinhuis/api/blog-upload',{})).status,401);
 assert.equal((await request('/kilometerkampioen/api/liveblog')).status,200);
 assert.equal((await request('/kilometerkampioen/api/blog-photo?post=test&id=private')).status,404);
 assert.throws(()=>validateProfile({fullName:'a',displayName:'b',edition:12,startTime:'29:00'},{}));
 await request('/kilometerkampioen/api/logout',{},cookie);assert.equal((await request('/kilometerkampioen/api/session',null,cookie)).data.participant,null);
 for(let i=0;i<3;i++)assert.equal(await kkLimit('test-limit',3,10000),true);assert.equal(await kkLimit('test-limit',3,10000),false);
 let now=0;const cache=new BoundedCache({max:2,ttl:10,now:()=>now});cache.set('a',[1]);cache.set('b',[2]);cache.set('c',[3]);assert.equal(cache.get('a'),undefined);assert.deepEqual(cache.get('c'),[3]);now=11;cache.prune();assert.equal(cache.size,0);
 console.log('PASS: login, replay protection, origin, private profile, admin guard, logout, throttle, bounded cache');
}finally{globalThis.fetch=originalFetch;sqlite.close();}
