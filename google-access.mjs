import {readFile} from 'node:fs/promises';
import {readAdminSecurity,writeAdminSecurity} from './board-cache.mjs';
import {sessionFor,countryFor,clientIP,consumeTotp,seal,unseal,locationFor,allowed} from './admin-security.mjs';
import {createGoogleLogin,googleLoginConfig} from './google-login.mjs';
import {hash,token,cookieValue,accessState,audit,googleSessionFor,GOOGLE_SESSION,GOOGLE_DEVICE,revokeDevice,blockAccount,APP_SCOPES} from './google-access-state.mjs';
const DAY=86400000,STATE_COOKIE='tr_google_state',SESSION_DAYS=30;
function setCookie(res,name,value,seconds){const existing=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:[existing]),`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`]);}
function fail(message,status=400,confirmationRequired=false){throw Object.assign(Error(message),{status,confirmationRequired});}
function legacyOwner(req,s,now){const v=sessionFor(req,s,countryFor(req),now);return v&&!v.recovery&&(!v.username||v.username===s.user.name)?v:null;}
function issueSession(g,d,id,res,now){const raw=token();g.sessions[hash(raw)]={email:d.email,sub:d.sub,device:id,created:now,verifiedAt:d.verifiedAt,expires:now+SESSION_DAYS*DAY,lastSeen:now};setCookie(res,GOOGLE_SESSION,raw,SESSION_DAYS*86400);}
function clean(g,now){for(const [id,v] of Object.entries(g.pending))if(v.expires<=now)delete g.pending[id];for(const [id,v] of Object.entries(g.sessions))if(v.expires<=now)delete g.sessions[id];}
async function body(req){let n=0,parts=[];for await(const b of req){n+=b.length;if(n>8192)fail('Verzoek te groot.',413);parts.push(b);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{fail('Ongeldig verzoek.');}}
export function createGoogleAccess({login=createGoogleLogin(),configuration=googleLoginConfig,read=readAdminSecurity,write=writeAdminSecurity,now=()=>Date.now()}={}){
 return async(req,res,url)=>{
  const path=url.pathname;
  if(!path.startsWith('/api/seinhuis-access/')&&!['/seinhuis/toegang','/seinhuis/toegang/','/seinhuis/toegang.js','/seinhuis/toegang.css','/seinhuis/google/callback'].includes(path))return false;
  for(const [k,v] of Object.entries({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}))res.setHeader(k,v);
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};
  const redirect=()=>{res.writeHead(303,{Location:'/seinhuis/toegang'});res.end();return true;};
  try{
   if(['/seinhuis/toegang','/seinhuis/toegang/','/seinhuis/toegang.js','/seinhuis/toegang.css'].includes(path)){
    if(req.method!=='GET')return json(405,{error:'Gebruik GET.'});
    const extension=path.endsWith('.js')?'js':path.endsWith('.css')?'css':'html';res.writeHead(200,{'Content-Type':({js:'text/javascript',css:'text/css',html:'text/html'})[extension]+'; charset=utf-8'});res.end(await readFile(new URL('./google-access.'+extension,import.meta.url)));return true;
   }
   let record=await read(),s=record.value,time=now();if(!s?.user)return json(409,{error:'Stel eerst de bestaande beheerder in.'});
   let g=accessState(s);clean(g,time);
   const country=countryFor(req),countryAllowed=allowed(s,country,time),current=googleSessionFor(req,s,country,time),owner=current?null:legacyOwner(req,s,time),isAdmin=current?current.role==='admin':!!owner;
   const action=path.slice('/api/seinhuis-access/'.length);
   if(req.method==='GET'&&action==='status'){
    const device=g.devices[hash(cookieValue(req,GOOGLE_DEVICE))];
    return json(200,{configured:login.configured(),authenticated:!!current,isAdmin,legacyOwner:!!owner,identity:current?.email,device:device?{email:device.email,status:device.status,label:device.label}:null,confirmation:isAdmin?{method:current?'google':'totp',validUntil:current?current.verifiedAt+10*60000:0}:null,currentDeviceId:isAdmin&&current?current.device:null,sessionDays:SESSION_DAYS,country,countryAllowed});
   }
   if(req.method==='GET'&&action==='overview'){
    if(!isAdmin)fail('Alleen beheerders kunnen toegang beheren.',403);
    return json(200,{appScopes:APP_SCOPES,accounts:Object.values(g.accounts).map(a=>({email:a.email,role:a.role,apps:a.apps,active:a.active,linked:!!a.sub})),devices:Object.entries(g.devices).map(([id,d])=>({id,...d})),sessions:Object.entries(g.sessions).map(([id,v])=>({id,email:v.email,device:v.device,created:v.created,expires:v.expires,lastSeen:v.lastSeen})),audit:g.audit.slice(-50).reverse()});
   }
   if(path==='/seinhuis/google/callback'){
    if(!countryAllowed)fail('Dit land is niet toegestaan of kon niet worden vastgesteld. De landencontrole geldt ook voor Google-login.',403);
    if(req.method!=='GET'||!login.configured())fail('Google-login is niet beschikbaar.',503);
    const state=url.searchParams.get('state')||'',pending=g.pending[hash(state)];
    if(!state||!pending||pending.expires<=time||pending.browser!==hash(cookieValue(req,STATE_COOKIE)))fail('Deze login is verlopen. Begin opnieuw.');
    delete g.pending[hash(state)];await write(s,record.revision);setCookie(res,STATE_COOKIE,'',0);
    if(url.searchParams.has('error')||!url.searchParams.get('code'))fail('Google-login is geannuleerd.');
    const identity=await login.finish(url.searchParams.get('code'),{nonce:pending.nonce,verifier:unseal(pending.verifier)});
    // Re-read after Google: never overwrite a concurrent revocation or block.
    record=await read();s=record.value;g=accessState(s);time=now();
    if(!allowed(s,countryFor(req),time))fail('Dit land is niet meer toegestaan. Er is geen Google-sessie geopend.',403);
    const account=g.accounts[identity.email];
    if(!account?.active)fail('Dit Google-account heeft geen toegang tot Seinhuis.',403);
    if(account.sub&&account.sub!==identity.sub)fail('Dit e-mailadres hoort bij een ander gekoppeld Google-account.',403);
    if(Object.values(g.accounts).some(a=>a.email!==identity.email&&a.sub===identity.sub))fail('Dit Google-account is al gekoppeld.',409);
    if(pending.reauth){
     const session=googleSessionFor(req,s,countryFor(req),time);
     if(!session||session.role!=='admin'||hash(cookieValue(req,GOOGLE_SESSION))!==pending.reauth.session||session.device!==pending.reauth.device||identity.email!==session.email||identity.sub!==session.sub)fail('Bevestig met hetzelfde beheerdersaccount in dezelfde browser. Er is geen toegang gewijzigd.',403);
     g.sessions[pending.reauth.session].verifiedAt=time;
     await write(s,record.revision);
     res.writeHead(303,{Location:'/seinhuis/toegang?confirmed='+encodeURIComponent(pending.reauth.channel)});res.end();return true;
    }
    const linking=pending.link===true;
    if(linking&&(!legacyOwner(req,s,time)||hash(cookieValue(req,'tr_admin_session'))!==pending.legacySession||account.role!=='admin'))fail('Koppel je beheerdersaccount opnieuw vanuit de bestaande beheerlogin.',403);
    account.sub=identity.sub;
    let raw=cookieValue(req,GOOGLE_DEVICE),id=hash(raw),d=g.devices[id];
    if(!raw||!d||d.sub!==identity.sub){
     if(Object.values(g.devices).filter(v=>v.email===identity.email).length>=50)fail('Te veel browsers geregistreerd. Vraag de beheerder oude browsers te verwijderen.',429);
     raw=token();id=hash(raw);d=g.devices[id]={email:identity.email,sub:identity.sub,status:'pending',label:pending.label||'Mijn browser',created:time};audit(g,'device-requested',identity.email,d.label,time);
    }
    if(linking){d.status='approved';d.approvedAt=time;d.approvedBy=s.user.name;audit(g,'admin-linked',s.user.name,identity.email,time);}
    Object.assign(d,{verifiedAt:time,lastSeen:time,browser:String(req.headers['user-agent']||'').slice(0,240),location:locationFor(req)});
    setCookie(res,GOOGLE_DEVICE,raw,400*86400);
    // Approval stays in the database. Browser cookie lifetimes are bounded by browsers.
    if(d.status==='approved'){
     issueSession(g,d,id,res,time);
     delete s.sessions[hash(cookieValue(req,'tr_admin_session'))];setCookie(res,'tr_admin_session','',0);
    }else setCookie(res,GOOGLE_SESSION,'',0);
    await write(s,record.revision);return redirect();
   }
   if(req.method!=='POST')fail('Niet gevonden.',404);
   const c=configuration();if(req.headers.origin!==c.origin||req.headers.host!==new URL(c.origin).host)fail('Open deze pagina op de eigen website.',403);
   if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('Gebruik JSON.',415);
   const input=await body(req);
   if(['start','link','reauth'].includes(action)){
    if(!countryAllowed)fail('Dit land is niet toegestaan of kon niet worden vastgesteld. Vraag een beheerder het land toe te staan.',403);
    if(!login.configured())fail('De Google-login moet nog worden ingesteld.',503);
    if(action==='link'){
     if(!owner||!consumeTotp(s.user,input.code,time))fail('Log in met het bestaande beheeraccount en bevestig met een verse Authenticator-code.',403);
    }
    if(action==='reauth'&&(!current||current.role!=='admin'))fail('Je beheerderssessie is verlopen. Log opnieuw in via de bestaande ingang of Google.',401);
    if(action==='reauth'&&(typeof input.channel!=='string'||!/^[-a-zA-Z0-9_]{16,64}$/.test(input.channel)))fail('Ongeldige bevestiging. Open het venster opnieuw.');
    if(Object.keys(g.pending).length>=200)fail('Te veel lopende logins. Probeer later opnieuw.',429);
    const ipKey='google:'+hash(clientIP(req)||'unknown'),rate=s.attempts[ipKey];
    s.attempts[ipKey]=rate&&rate.start>time-15*60000?rate:{start:time,count:0};
    if(s.attempts[ipKey].count>=20)fail('Te veel loginpogingen. Wacht 15 minuten.',429);s.attempts[ipKey].count++;
    const state=token(),browser=token(),nonce=token(),verifier=token();
    g.pending[hash(state)]={browser:hash(browser),nonce,verifier:seal(verifier),expires:time+10*60000,link:action==='link',legacySession:action==='link'?hash(cookieValue(req,'tr_admin_session')):null,label:String(input.label||'Mijn browser').slice(0,80)};
    if(action==='reauth')g.pending[hash(state)].reauth={session:hash(cookieValue(req,GOOGLE_SESSION)),device:current.device,channel:input.channel};
    await write(s,record.revision);setCookie(res,STATE_COOKIE,browser,600);
    return json(200,{url:login.start({state,nonce,verifier})});
   }
   if(action==='continue'){
    if(!countryAllowed)fail('Dit land is niet toegestaan of kon niet worden vastgesteld.',403);
    const id=hash(cookieValue(req,GOOGLE_DEVICE)),d=g.devices[id],a=d&&g.accounts[d.email];
    if(!d||d.status!=='approved'||!a?.active||a.sub!==d.sub)fail('Deze browser is nog niet goedgekeurd.',403);
    if(!d.verifiedAt||d.verifiedAt<time-10*60000)fail('Je browser is goedgekeurd. Meld je nog één keer aan via Google.',401);
    issueSession(g,d,id,res,time);d.verifiedAt=0;delete s.sessions[hash(cookieValue(req,'tr_admin_session'))];setCookie(res,'tr_admin_session','',0);await write(s,record.revision);return json(200,{ok:true});
   }
   if(action==='logout'){
    const v=g.sessions[hash(cookieValue(req,GOOGLE_SESSION))];if(v&&g.devices[v.device])g.devices[v.device].verifiedAt=0;delete g.sessions[hash(cookieValue(req,GOOGLE_SESSION))];setCookie(res,GOOGLE_SESSION,'',0);await write(s,record.revision);return json(200,{ok:true});
   }
   if(!isAdmin)fail('Alleen beheerders kunnen toegang beheren.',403);
   if(!['approve','revoke','block','enable','revoke-session','permissions'].includes(action))fail('Niet gevonden.',404);
   if(current?.role==='admin'){
    if(current.verifiedAt<time-10*60000)fail('Bevestig deze beheeractie via Google. Je blijft op deze pagina.',401,true);
   }else if(!consumeTotp(s.user,input.code,time))fail('Vul een verse Authenticator-code in.',403,true);
   const actor=current?.email||s.user.name;
   if(action==='permissions'){
    const a=g.accounts[input.email];if(!a)fail('Account niet gevonden.',404);
    if(a.role==='admin')fail('Beheerders hebben toegang tot alle onderdelen.');
    if(!Array.isArray(input.apps)||input.apps.length>Object.keys(APP_SCOPES).length||input.apps.some(scope=>typeof scope!=='string'||!Object.hasOwn(APP_SCOPES,scope))||new Set(input.apps).size!==input.apps.length)fail('Kies geldige Seinhuis-onderdelen.');
    a.apps=[...input.apps];audit(g,'permissions-changed',actor,a.email+' · '+a.apps.map(v=>APP_SCOPES[v]).join(', '),time);
   }else if(action==='approve'){
    const d=g.devices[input.id],a=d&&g.accounts[d.email];if(!d||!a?.active||a.sub!==d.sub)fail('Deze aanvraag kan niet worden goedgekeurd.');
    if(d.status!=='pending'&&d.status!=='revoked')fail('Deze browser is al goedgekeurd.');
    d.status='approved';d.approvedAt=time;d.approvedBy=actor;delete d.revokedAt;audit(g,'device-approved',actor,d.email+' · '+d.label,time);
   }else if(action==='revoke'){
    if(!revokeDevice(g,String(input.id),actor,time))fail('Browser niet gevonden.',404);
   }else if(action==='block'){
    if(!blockAccount(g,String(input.email),actor,time))fail('Account niet gevonden.',404);
   }else if(action==='enable'){
    const a=g.accounts[input.email];if(!a)fail('Account niet gevonden.',404);a.active=true;audit(g,'account-enabled',actor,a.email,time);
   }else{
    const v=g.sessions[input.id];if(!v)fail('Sessie niet gevonden.',404);g.devices[v.device].verifiedAt=0;delete g.sessions[input.id];audit(g,'session-revoked',actor,v.email,time);
   }
   await write(s,record.revision);return json(200,{ok:true});
  }catch(e){return json(e.status||400,{error:e.status?e.message:e.message==='De beveiliging is ondertussen gewijzigd. Probeer opnieuw.'?e.message:'De aanvraag kon niet worden verwerkt. Begin opnieuw of probeer later.',...(e.confirmationRequired?{confirmationRequired:true}:{})});}
 };
}
export const handleGoogleAccess=createGoogleAccess();
