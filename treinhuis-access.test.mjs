import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {initBoardCache,writeAdminSecurity} from './board-cache.mjs';import {adminAuthenticated,handleAdminSecurity,totp,passwordHash,seal,base32} from './admin-security.mjs';import {handleTreinhuisAccess} from './treinhuis-access.mjs';import {handleConnectionAdmin} from './connections-admin.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');process.env.BOARD_ADMIN_PASSWORD='test-secret-only-123456';process.env.RAILWAY_ENVIRONMENT_ID='test';
test('Treinhuis enrollment, scope, TOTP replay, owner protection and revocation',async()=>{
 const db=new DatabaseSync(':memory:');await initBoardCache({sqlite:db});const owner='test-owner-session',secret=base32(Buffer.alloc(20,1));await writeAdminSecurity({user:{name:'owner',password:await passwordHash('owner-password-test-123'),secret:seal(secret),recovery:[]},sessions:{[hash(owner)]:{expires:Date.now()+600000,country:'NL'}},devices:{},pending:{},attempts:{},countries:[{code:'NL'}]},0);
 const ownerJar={tr_admin_session:owner},memberJar={};
 const reqFor=(jar,body)=>{const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=body?'POST':'GET';req.headers={host:'example.test',origin:'https://example.test','x-real-ip':'145.100.100.100',cookie:Object.entries(jar).map(([k,v])=>k+'='+v).join('; ')};req.socket={};return req;};
 async function call(handler,path,body,jar=ownerJar,origin){const req=reqFor(jar,body);if(origin)req.headers.origin=origin;let status,result;const headers={};const res={setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},writeHead(s,h){status=s;Object.assign(headers,h);},end(v){result=JSON.parse(v);}};await handler(req,res,new URL('https://example.test'+path));if(status===200)for(const c of headers['Set-Cookie']||[]){const [k,v]=c.split(';')[0].split('=');jar[k]=v;}return {status,data:result};}
 const users='/stationschef/treinhuis-gebruikers/api',activation='/treinhuis/activeren/api';
 assert.equal((await call(handleTreinhuisAccess,users,{name:'Tester',email:'test@example.com'},{ })).status,403);
 assert.equal((await call(handleTreinhuisAccess,users,{name:'Tester',email:'test@example.com'},ownerJar,'https://evil.test')).status,403);
 const invite=await call(handleTreinhuisAccess,users,{name:'Tester',email:'test@example.com'});assert.equal(invite.status,200);let token=invite.data.activationPath.split('#')[1];const oldToken=token;const renewed=await call(handleTreinhuisAccess,users,{action:'reinvite',name:'Tester'});assert.equal(renewed.status,200);token=renewed.data.activationPath.split('#')[1];assert.notEqual(token,oldToken);assert.equal((await call(handleTreinhuisAccess,activation,{token:oldToken,action:'start',password:'member-test-password-123'},memberJar)).status,400);
 const start=await call(handleTreinhuisAccess,activation,{token,action:'start',password:'member-test-password-123'},memberJar);assert.equal(start.status,200);
 const finish=await call(handleTreinhuisAccess,activation,{token,action:'finish',code:totp(start.data.secret)},memberJar);assert.equal(finish.status,200);
 assert.equal(await adminAuthenticated(reqFor(memberJar)),false);assert.equal(await adminAuthenticated(reqFor(memberJar),'treinhuis'),true);
 assert.equal((await call(handleAdminSecurity,'/api/admin-security/settings',null,memberJar)).status,403);
 assert.equal((await call(handleTreinhuisAccess,users,null,memberJar)).status,403);
 assert.equal((await call(handleConnectionAdmin,'/stationschef/api/aansluitingen',null,memberJar)).status,401);
 assert.equal((await call(handleTreinhuisAccess,activation,{token,action:'start',password:'member-test-password-123'},memberJar)).status,400);
 assert.equal((await call(handleAdminSecurity,'/api/admin-security/login',{username:'Tester',password:'member-test-password-123',code:totp(start.data.secret)},{})).status,401);
 assert.equal((await call(handleAdminSecurity,'/api/admin-security/login',{username:'Tester',password:'member-test-password-123',code:totp(start.data.secret,Date.now()+30000)},memberJar)).status,200);
 assert.equal((await call(handleTreinhuisAccess,users,{action:'revoke',name:'Tester'})).status,200);
 assert.equal(await adminAuthenticated(reqFor(memberJar),'treinhuis'),false);assert.equal(await adminAuthenticated(reqFor(ownerJar)),true);db.close();
});
