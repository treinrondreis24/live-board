import assert from 'node:assert/strict';
import http from 'node:http';
import {mock} from 'node:test';
mock.module('./admin-security.mjs',{namedExports:{adminAuthenticated:async()=>false}});
const {createBookletsGateway,BOOKLETS_PREFIX:p}=await import('./booklets-gateway.mjs');
let seen=[];
const backend=http.createServer((req,res)=>{let bytes=0;req.on('data',b=>bytes+=b.length);req.on('end',()=>{seen.push({url:req.url,headers:req.headers,bytes});res.setHeader('Content-Type','application/pdf');res.setHeader('Set-Cookie','unsafe=1');res.end('private-pdf');});});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));
const secret='s'.repeat(48),origin='https://treinbord.up.railway.app';
const gateway=createBookletsGateway({authenticate:async req=>req.headers.cookie==='owner=valid',configuration:()=>({upstream:`http://127.0.0.1:${backend.address().port}`,secret,origin})});
const front=http.createServer(async(req,res)=>{if(!await gateway(req,res,new URL(req.url,'http://test')))res.writeHead(404).end();});
await new Promise(r=>front.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${front.address().port}`;
try{
 for(const path of ['/api/state','/files/export/'+ 'a'.repeat(32),'/digital/'+'b'.repeat(32),'/import']){
   const r=await fetch(base+p+path);assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');
 }
 assert.equal(seen.length,0);
 assert.equal((await fetch(base+p,{redirect:'manual'})).headers.get('location'),'/seinhuis');
 assert.equal((await fetch(base+p+'/api/state',{headers:{cookie:'member=valid'}})).status,401);
 const headers={cookie:'owner=valid',origin,'x-booklets':'1','content-type':'application/json','x-booklets-gateway':'attacker'};
 for(const change of [{origin:'https://evil.example'},{origin:''},{'x-booklets':'0'}])assert.equal((await fetch(base+p+'/api/save',{method:'POST',headers:{...headers,...change},body:'{}'})).status,403);
 const ok=await fetch(base+p+'/files/export/'+'c'.repeat(32),{headers});
 assert.equal(await ok.text(),'private-pdf');assert.equal(ok.headers.get('set-cookie'),null);
 assert.equal(seen.at(-1).headers.cookie,undefined);assert.equal(seen.at(-1).headers['x-booklets-gateway'],secret);
 assert.equal((await fetch(base+p+'/api/upload',{method:'POST',headers,body:Buffer.alloc(1024*1024)})).status,200);
 assert.equal(seen.at(-1).bytes,1024*1024);
 await fetch(base+p+'//evil.example/path',{headers});assert.equal(seen.at(-1).url,'//evil.example/path');
 const callback=await fetch(base+p+'/google/callback?state=x&code=y');assert.equal(callback.status,200);assert.match(await callback.text(),/continue=1/);
 assert.equal((await fetch(base+p+'/google/callback?continue=1')).status,401);
 assert.equal((await fetch(base+p+'/api/setup',{method:'DELETE',headers})).status,405);
 console.log('Booklets gateway: authentication, owner scope, CSRF, streaming, header isolation and OAuth return passed');
}finally{front.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(r=>front.close(r)),new Promise(r=>backend.close(r))]);}
