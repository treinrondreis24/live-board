import {assignTeam,updatePage,updateMedia} from './kk-updates.mjs';
import {saveBlog,publishBlog,unpublishBlog,publicBlog,blogMedia,EDITOR_OWNER} from './kk-blog.mjs';
import {readFile} from 'node:fs/promises';
import {upload,saveSubmission,ownSubmissions,mediaLink} from './kk-submissions.mjs';
import {mediaReady} from './kk-media.mjs';
import {randomBytes,randomInt,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {adminAuthenticated,clientIP} from './admin-security.mjs';
import {kkGet,kkPut,kkTake,kkDelete,kkList,kkLimit,kkCleanup} from './kk-store.mjs';
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function secret(){return process.env.KK_AUTH_SECRET||process.env.ADMIN_ENCRYPTION_KEY||process.env.BOARD_ADMIN_PASSWORD;}
function digest(s){if(!secret())fail('De inlogdienst is nog niet ingesteld.',503);return createHmac('sha256',secret()).update(s).digest('hex');}
const emailOf=s=>{const e=String(s||'').trim().toLowerCase();if(e.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))fail('Vul een geldig e-mailadres in.');return e;};
const text=(s,n=200)=>String(s||'').trim().slice(0,n);
function origin(req){return req.headers.origin==='https://'+req.headers.host;}
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)fail('Het formulier is te groot.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('Ongeldig formulier.');}}
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
function cookie(res,value,maxAge){res.setHeader('Set-Cookie',`kk_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);}
async function participant(req){const id=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kk_session='))?.slice(11);if(!id)return null;const s=await kkGet('session',hash(id));if(!s||Number(s.expires)<=Date.now())return null;return (await kkGet('participant',s.owner))?.value||null;}
export function validateProfile(data,user){
 const fullName=text(data.fullName),displayName=text(data.displayName,80),edition=Number(data.edition),startTime=text(data.startTime,5),companion=text(data.companion),station=text(data.station),distance=data.distance===''||data.distance==null?null:Number(data.distance);
 if(!fullName||!displayName||![12,24].includes(edition)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime))fail('Vul naam, weergavenaam, editie en starttijd in.');
 if(data.together&&!companion)fail('Vul de naam van je reisgenoot in.');
 if(distance!==null&&(!Number.isFinite(distance)||distance<0||distance>10000))fail('Vul een geldig aantal kilometers in.');
 return {...user,fullName,displayName,edition,startTime,together:!!data.together,companion:data.together?companion:'',station,distance,competition:'2026',updatedAt:Date.now()};
}
export async function sendCode(email,code){
 if(!process.env.RESEND_API_KEY||!process.env.KK_EMAIL_FROM)fail('E-mailcodes zijn nog niet beschikbaar. Probeer later opnieuw.',503);
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({from:process.env.KK_EMAIL_FROM,to:[email],subject:'Je inlogcode voor Kilometer Kampioen',text:`Je inlogcode is ${code}. Deze code is 10 minuten geldig en werkt één keer. Heb je geen code aangevraagd? Dan kun je deze e-mail negeren.`})});
 if(!r.ok)fail('De e-mail kon niet worden verstuurd. Probeer later opnieuw.',503);
}
const assets={'/kilometerkampioen':'kk-app.html','/kilometerkampioen/':'kk-app.html','/kilometerkampioen/app.js':'kk-app.js','/kilometerkampioen/app.css':'kk-app.css','/treinhuis':'kk-admin.html','/treinhuis/':'kk-admin.html','/treinhuis/app.js':'kk-admin.js','/kilometerkampioen/forms.js':'kk-forms.js','/treinhuis/blog.js':'kk-blog-admin.js','/kilometerkampioen/liveblog':'kk-blog.html','/kilometerkampioen/liveblog.js':'kk-blog-public.js','/kilometerkampioen/rich.js':'kk-rich.js','/kilometerkampioen/community.js':'kk-community.js'};
let cleanupAt=0;
export async function handleKilometerkampioen(req,res,url){
 const path=url.pathname;if(!path.startsWith('/kilometerkampioen')&&!path.startsWith('/treinhuis'))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://www.treinreiziger.nl; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
 const admin=path.startsWith('/treinhuis');
 if(path==='/kilometerkampioen/liveblog'){
 res.removeHeader('X-Frame-Options');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https:; connect-src 'self'; frame-ancestors https:; base-uri 'none'; form-action 'none'");
 }
 if(req.method==='GET'&&path==='/kilometerkampioen/api/liveblog'){json(res,200,{posts:await publicBlog()});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/blog-photo'){res.writeHead(302,{Location:await blogMedia(url.searchParams.get('post'),url.searchParams.get('id'))});res.end();return true;}
 if(admin&&!await adminAuthenticated(req)){if(req.method==='GET'&&!path.includes('/api/')){res.writeHead(303,{Location:'/stationschef'});res.end();}else json(res,401,{error:'Log in met je beheeraccount.'});return true;}
 if(assets[path]&&req.method==='GET'){const f=assets[path];res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(await readFile(new URL(f,import.meta.url)));return true;}
 if(Date.now()>cleanupAt){cleanupAt=Date.now()+600000;await kkCleanup();}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/participants'){json(res,200,{participants:(await kkList('participant')).map(r=>r.value)});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/status'){json(res,200,{email:!!(process.env.RESEND_API_KEY&&process.env.KK_EMAIL_FROM),auth:!!secret(),media:mediaReady(),memory:process.memoryUsage()});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/session'){json(res,200,{participant:await participant(req),emailReady:!!(process.env.RESEND_API_KEY&&process.env.KK_EMAIL_FROM)});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/submissions'){const user=await participant(req);if(!user)fail('Log eerst in.',401);json(res,200,{submissions:await ownSubmissions(user)});return true;}
 if(req.method==='GET'&&path.endsWith('/api/media')){const user=admin?null:await participant(req);if(!admin&&!user)fail('Log eerst in.',401);json(res,200,{url:await mediaLink(user,url.searchParams.get('id'),admin)});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/submissions'){json(res,200,{submissions:(await kkList('submission')).map(r=>({...r.value,owner:r.owner}))});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/blog'){json(res,200,{drafts:(await kkList('blog-draft')).map(r=>r.value),published:(await publicBlog()).map(p=>p.id)});return true;}
 if(req.method==='GET'&&['/kilometerkampioen/api/updates','/kilometerkampioen/api/update-media'].includes(path)){if(!await participant(req))fail('Log eerst in.',401);json(res,200,path.endsWith('/updates')?await updatePage({before:url.searchParams.get('before')||'',teams:url.searchParams.getAll('team')}):await updateMedia(url.searchParams.get('update'),url.searchParams.get('id')));return true;}
 if(req.method!=='POST')fail('Niet gevonden.',404);
 if(!origin(req))fail('Open dit formulier op de eigen website.',403);
 if(path==='/kilometerkampioen/api/upload'){const user=await participant(req);if(!user)fail('Log eerst in.',401);json(res,200,await upload(req,user));return true;}
 if(admin&&path==='/treinhuis/api/blog-upload'){json(res,200,await upload(req,{id:EDITOR_OWNER}));return true;}
 const data=await body(req);
 if(admin&&path==='/treinhuis/api/team'){await assignTeam(data);json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/blog-save'){json(res,200,{draft:await saveBlog(data)});return true;}
 if(admin&&path==='/treinhuis/api/blog-publish'){await publishBlog(data.id);json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/blog-unpublish'){await unpublishBlog(data.id);json(res,200,{ok:true});return true;}
 if(path==='/kilometerkampioen/api/request-code'){
  const email=emailOf(data.email),id=hash(email),ip=digest(clientIP(req)||'unknown');
  if(!await kkLimit('ip:'+ip,20,3600000)||!await kkLimit('mail:'+id,5,3600000))fail('Te veel codes aangevraagd. Probeer over een uur opnieuw.',429);
  const challenge=token(),code=String(randomInt(0,1000000)).padStart(6,'0');
  await kkPut('challenge',challenge,id,{email,code:digest(challenge+code)},Date.now()+600000);
  try{await sendCode(email,code);}catch(e){await kkDelete('challenge',challenge);throw e;}
  json(res,200,{challenge});return true;
 }
 if(path==='/kilometerkampioen/api/verify-code'){
  if(!/^[\w-]{43}$/.test(data.challenge||'')||!/^\d{6}$/.test(data.code||''))fail('Vul de zescijferige code in.');
  // One atomic consume: a challenge can never open multiple sessions.
  const c=await kkTake('challenge',data.challenge),actual=digest(data.challenge+data.code);
  if(!c||Number(c.expires)<=Date.now()||!timingSafeEqual(Buffer.from(c.value.code),Buffer.from(actual)))fail('De code is ongeldig of verlopen. Vraag een nieuwe code aan.',401);
  let user=(await kkGet('participant',c.owner))?.value;
  if(!user){user={id:c.owner,email:c.value.email,createdAt:Date.now(),competition:'2026'};await kkPut('participant',user.id,user.id,user);}
  const session=token();await kkPut('session',hash(session),user.id,{},Date.now()+7*86400000);cookie(res,session,7*86400);json(res,200,{participant:user});return true;
 }
 const user=await participant(req);if(!user)fail('Log eerst in.',401);
 if(path==='/kilometerkampioen/api/submit'){json(res,200,{submission:await saveSubmission(user,data)});return true;}
 if(path==='/kilometerkampioen/api/profile'){const profile=validateProfile(data,user);await kkPut('participant',user.id,user.id,profile);json(res,200,{participant:profile});return true;}
 if(path==='/kilometerkampioen/api/logout'){const session=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kk_session='))?.slice(11);if(session)await kkDelete('session',hash(session));cookie(res,'',0);json(res,200,{ok:true});return true;}
 fail('Dit onderdeel is nog niet beschikbaar.',404);
 }catch(e){json(res,e.status||500,{error:e.status?e.message:'Er ging iets mis. Je gegevens zijn nog niet bevestigd; probeer opnieuw.'});}return true;
}
