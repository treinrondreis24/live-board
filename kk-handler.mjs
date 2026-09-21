import {networkView,saveNetwork,testNetwork} from './hilta-next/service.mjs';
import {addOfflineParticipant} from './kk-offline-participant.mjs';
import {adminSaveClaim} from './kk-admin-claim.mjs';
import {adminJourney} from './kk-admin-journey.mjs';
import {deleteProof} from './kk-proof-delete.mjs';
import {adminRouteOptions,adminRoutePreview,adminRouteConfirm} from './kk-hilta-admin.mjs';
import {externalDistance} from './kk-distance.mjs';
import {pendingRoutes} from './kk-pending-routes.mjs';
import {currentFeature,featureArchive,featureSave,featureStop,featureVote} from './kk-feature.mjs';
import {setProofOrder} from './kk-proof-order.mjs';
import {withdrawalDetails} from './kk-withdrawal.mjs';
import {liveboard} from './kk-liveboard.mjs';
import {createParticipantReset} from './password-reset.mjs';
import {editUpdate,deleteUpdate,deleteParticipant} from './kk-moderation.mjs';
import {personalScorecard,scorecardOptions} from './kk-scorecard.mjs';
import {saveClaim,ownClaim,claimFile,listClaims} from './kk-claims.mjs';
import {scoreboard,startTimestamp} from './kk-scoreboard.mjs';
import {previewMedia} from './kk-preview.mjs';
import {hiltaContext,proposeHilta,confirmHilta} from './kk-hilta.mjs';
import {registerPassword,loginPassword,setApproval,canUseProof} from './kk-password.mjs';
import {assignTeam,updatePage,updateMedia} from './kk-updates.mjs';
import {saveBlog,publishBlog,unpublishBlog,publicBlog,blogMedia,EDITOR_OWNER} from './kk-blog.mjs';
import {readFile} from 'node:fs/promises';
import {upload,uploadStatus,saveSubmission,ownSubmissions,mediaLink} from './kk-submissions.mjs';
import {mediaReady} from './kk-media.mjs';
import {randomBytes,randomInt,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {adminAuthenticated,clientIP} from './admin-security.mjs';
import {kkGet,kkPut,kkTake,kkDelete,kkList,kkLimit,kkCleanup,kkAdminSubmissions,kkPatchParticipant,kkJourneyRoutes} from './kk-store.mjs';
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
async function participant(req){const id=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kk_session='))?.slice(11);if(!id)return null;const s=await kkGet('session',hash(id));if(!s||Number(s.expires)<=Date.now())return null;const user=(await kkGet('participant',s.owner))?.value;const credential=await kkGet('password',s.owner);return user&&!user.deleting&&(s.value.credentialVersion||'')===(credential?.value.version||'')?user:null;}
export function validateProfile(data,user,admin=false){
 const fullName=text(data.fullName),displayName=text(data.displayName,80),edition=Number(data.edition),startTime=!admin&&user.startTime?user.startTime:text(data.startTime,5),companion=text(data.companion),station=text(data.station),distance=data.distance===''||data.distance==null?null:Number(data.distance);
 if(!fullName||!displayName||(!admin||data.edition)&&![12,24].includes(edition)||(!admin||startTime)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime))fail('Vul naam, weergavenaam, editie en starttijd in.');
 const startDate=(!admin&&user.startDate)||String(data.startDate||user.startDate||'2026-09-19');if((!admin||startTime)&&startTimestamp(startDate,startTime)===null)fail('Vul een geldige startdatum in.');
 const rotterdamTime=text(data.rotterdamTime,5);if((!admin||rotterdamTime)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(rotterdamTime))fail('Vul de verwachte tijd bij meldpunt Rotterdam in.');
 if(!admin&&distance===null)fail('Vul je verwachte aantal kilometers in.');
 if(data.together&&!companion)fail('Vul de naam van je reisgenoot in.');
 if(distance!==null&&(!Number.isFinite(distance)||distance<0||distance>10000))fail('Vul een geldig aantal kilometers in.');
 return {...user,fullName,displayName,edition,startTime,startDate,rotterdamTime,together:!!data.together,companion:data.together?companion:'',station,distance,competition:'2026',updatedAt:Date.now()};
}
export async function sendCode(email,code){
 if(!process.env.RESEND_API_KEY||!process.env.KK_EMAIL_FROM)fail('E-mailcodes zijn nog niet beschikbaar. Probeer later opnieuw.',503);
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({from:process.env.KK_EMAIL_FROM,to:[email],subject:'Je inlogcode voor Kilometer Kampioen',text:`Je inlogcode is ${code}. Deze code is 10 minuten geldig en werkt één keer. Heb je geen code aangevraagd? Dan kun je deze e-mail negeren.`})});
 if(!r.ok)fail('De e-mail kon niet worden verstuurd. Probeer later opnieuw.',503);
}
const assets={'/treinhuis/netwerk':'hilta-next/admin.html','/treinhuis/netwerk.js':'hilta-next/admin.js','/treinhuis/netwerk.css':'hilta-next/admin.css','/treinhuis/offline.js':'kk-offline-participant.js','/treinhuis/journey.js':'kk-admin-journey.js','/treinhuis/routes.js':'kk-hilta-admin.js','/kilometerkampioen/feature.js':'kk-feature.js','/treinhuis/feature.js':'kk-feature-admin.js','/kilometerkampioen/proof-order.js':'kk-proof-order.js','/kilometerkampioen/reliable.js':'kk-reliable.js','/kilometerkampioen/stations.js':'kk-stations.js','/kilometerkampioen/stations.css':'kk-stations.css','/kilometerkampioen/manifest.webmanifest':'kk.webmanifest','/kilometerkampioen/install.js':'kk-install.js','/kilometerkampioen/sw.js':'kk-sw.js','/kilometerkampioen/icon-180.png':'kk-icon-180.png','/kilometerkampioen/icon-192.png':'kk-icon-192.png','/kilometerkampioen/icon-512.png':'kk-icon-512.png','/kilometerkampioen/scorecard.js':'kk-scorecard-ui.js','/kilometerkampioen/claims.js':'kk-claims.js','/treinhuis/claims.js':'kk-claims-admin.js','/kilometerkampioen':'kk-app.html','/kilometerkampioen/':'kk-app.html','/kilometerkampioen/app.js':'kk-app.js','/kilometerkampioen/app.css':'kk-app.css','/treinhuis':'kk-admin.html','/treinhuis/':'kk-admin.html','/treinhuis/app.js':'kk-admin.js','/treinhuis/teams.js':'kk-admin-teams.js','/kilometerkampioen/forms.js':'kk-forms.js','/kilometerkampioen/hilta.js':'kk-hilta.js','/treinhuis/blog.js':'kk-blog-admin.js','/kilometerkampioen/liveblog':'kk-blog.html','/kilometerkampioen/liveblog.js':'kk-blog-public.js','/kilometerkampioen/rich.js':'kk-rich.js','/kilometerkampioen/community.js':'kk-community.js','/kilometerkampioen/login.js':'kk-login.js','/kilometerkampioen/navigation.js':'kk-navigation.js'};
let cleanupAt=0;
export async function handleKilometerkampioen(req,res,url){
 const path=url.pathname;if(!path.startsWith('/kilometerkampioen')&&!path.startsWith('/treinhuis'))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: blob:; media-src 'self' https: blob:; connect-src 'self'; frame-src 'self' https://treinposities.nl; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
 if(req.method==='GET'&&path==='/kilometerkampioen/scorekaart.xlsx'){
 const file=await readFile(new URL('./kk-scorekaart-leeg.xlsx',import.meta.url));
 res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Hilta-scorekaart-2026.xlsx"','Content-Length':file.length});res.end(file);return true;
 }
 const admin=path.startsWith('/treinhuis');
 if(req.method==='GET'&&['/kilometerkampioen/registreren','/kilometerkampioen/eindclaim'].includes(path.replace(/\/$/,''))){res.writeHead(303,{Location:path.includes('/registreren')?'/kilometerkampioen/?registreren=1':'/kilometerkampioen/#eindclaim'});res.end();return true;}
 if(req.method==='GET'&&(path==='/kilometerkampioen/api/scorecard-options'||path==='/kilometerkampioen/api/scorecard.xlsx')){
 const user=await participant(req);if(!user)fail('Log eerst in.',401);
 if(path.endsWith('scorecard-options')){json(res,200,await scorecardOptions(user));return true;}
 if(!await kkLimit('scorecard:'+user.id,30,3600000))fail('Te veel downloads. Probeer het later opnieuw.',429);
 const file=await personalScorecard(user,url.searchParams.get('checkpoint'));res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Mijn-Hilta-scorekaart-2026.xlsx"','Content-Length':file.length});res.end(file);return true;
 }
 if(path==='/kilometerkampioen/liveblog'){
 res.removeHeader('X-Frame-Options');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https:; connect-src 'self'; frame-ancestors https:; base-uri 'none'; form-action 'none'");
 }
 if(req.method==='GET'&&path==='/kilometerkampioen/api/liveblog'){json(res,200,{posts:await publicBlog()});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/blog-photo'){res.writeHead(302,{Location:await blogMedia(url.searchParams.get('post'),url.searchParams.get('id'))});res.end();return true;}
 if(admin&&!await adminAuthenticated(req,'treinhuis')){if(req.method==='GET'&&!path.includes('/api/')){res.writeHead(303,{Location:'/stationschef'});res.end();}else json(res,401,{error:'Log in met je beheeraccount.'});return true;}
 if(assets[path]&&req.method==='GET'){const f=assets[path];res.writeHead(200,{'Content-Type':f.endsWith('.png')?'image/png':f.endsWith('.webmanifest')?'application/manifest+json':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(await readFile(new URL(f,import.meta.url)));return true;}
 if(Date.now()>cleanupAt){cleanupAt=Date.now()+600000;await kkCleanup();}
 if(admin&&req.method==='GET'&&(path==='/treinhuis/api/scorecard-options'||path==='/treinhuis/api/scorecard.xlsx')){const record=await kkGet('participant',url.searchParams.get('owner'));if(!record)fail('Deelnemer niet gevonden.',404);const user={...record.value,id:record.id};if(path.endsWith('scorecard-options')){json(res,200,await scorecardOptions(user));return true;}if(!await kkLimit('admin-scorecard:'+user.id,30,3600000))fail('Te veel downloads. Probeer later opnieuw.',429);const file=await personalScorecard(user,url.searchParams.get('checkpoint'));res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Hilta-scorekaart-herberekend.xlsx"','Cache-Control':'no-store','Content-Length':file.length});res.end(file);return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/network-next'){json(res,200,await networkView(url.searchParams.get('revision')));return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/features'){json(res,200,{posts:await featureArchive()});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/feature'){const user=await participant(req);if(!user)fail('Log eerst in.',401);json(res,200,{post:await currentFeature(user)});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/route-options'){json(res,200,adminRouteOptions());return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/pending-routes'){json(res,200,{rows:await pendingRoutes()});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/participants'){const [participants,claims]=await Promise.all([kkList('participant'),kkList('claim')]);json(res,200,{participants:participants.map(r=>r.value),claims:claims.map(r=>({id:r.id,receivedAt:r.value.receivedAt,km:r.value.km}))});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/status'){json(res,200,{email:!!(process.env.RESEND_API_KEY&&process.env.KK_EMAIL_FROM),auth:!!secret(),media:mediaReady(),memory:process.memoryUsage(),uploads:uploadStatus()});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/journey'){const user=await participant(req);if(!user)fail('Log eerst in.',401);if(!canUseProof(user))fail('Mijn bewijs is beschikbaar na goedkeuring.',403);json(res,200,{summary:(await scoreboard(user.id))[0],routes:await kkJourneyRoutes(user.id)});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/claim'){const user=await participant(req);if(!user)fail('Log eerst in.',401);json(res,200,{claim:await ownClaim(user)});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/claims'){json(res,200,{claims:await listClaims()});return true;}
 if(req.method==='GET'&&path.endsWith('/api/claim-file')){const user=admin?null:await participant(req);if(!admin&&!user)fail('Log eerst in.',401);json(res,200,{url:await claimFile(user,url.searchParams.get('claim'),url.searchParams.get('file'),admin)});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/session'){json(res,200,{participant:await participant(req),emailReady:!!(process.env.RESEND_API_KEY&&process.env.KK_EMAIL_FROM)});return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/hilta'){const user=await participant(req);if(!user)fail('Log eerst in.',401);json(res,200,await hiltaContext(user,url.searchParams.get('proofId')));return true;}
 if(req.method==='GET'&&path==='/kilometerkampioen/api/submissions'){const user=await participant(req);if(!user)fail('Log eerst in.',401);json(res,200,{submissions:await ownSubmissions(user)});return true;}
 if(req.method==='GET'&&path.endsWith('/api/media')){const user=admin?null:await participant(req);if(!admin&&!user)fail('Log eerst in.',401);const id=url.searchParams.get('id');const original=await mediaLink(user,id,admin);const row=await kkGet('media',id);json(res,200,url.searchParams.get('preview')==='1'?await previewMedia(row):{url:original,type:row.value.type});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/journey'){json(res,200,await adminJourney(url.searchParams.get('owner')));return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/submissions'){json(res,200,await kkAdminSubmissions(Object.fromEntries(url.searchParams)));return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/liveboard'){json(res,200,await liveboard());return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/scoreboard'){json(res,200,{rows:await scoreboard()});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/hilta'){json(res,200,{route:(await kkGet('hilta-current',url.searchParams.get('proofId')))?.value||null});return true;}
 if(admin&&req.method==='GET'&&path==='/treinhuis/api/blog'){json(res,200,{drafts:(await kkList('blog-draft')).map(r=>r.value),published:(await publicBlog()).map(p=>p.id)});return true;}
 if(req.method==='GET'&&['/kilometerkampioen/api/updates','/kilometerkampioen/api/update-media'].includes(path)){if(!await participant(req))fail('Log eerst in.',401);json(res,200,path.endsWith('/updates')?await updatePage({before:url.searchParams.get('before')||'',teams:url.searchParams.getAll('team'),q:url.searchParams.get('q')||'',participantId:url.searchParams.get('participant')||'',after:url.searchParams.get('after')||''}):await updateMedia(url.searchParams.get('update'),url.searchParams.get('id'),url.searchParams.get('preview')==='1'));return true;}
 if(req.method!=='POST')fail('Niet gevonden.',404);
 if(!origin(req))fail('Open dit formulier op de eigen website.',403);
 if(path==='/kilometerkampioen/api/claim-upload'){const user=await participant(req);if(!canUseProof(user))fail('Je aanmelding moet eerst worden goedgekeurd.',403);json(res,200,await upload(req,user,true));return true;}
 if(path==='/kilometerkampioen/api/upload'){const user=await participant(req);if(!user)fail('Log eerst in.',401);json(res,200,await upload(req,user));return true;}
 if(admin&&path==='/treinhuis/api/blog-upload'){json(res,200,await upload(req,{id:EDITOR_OWNER}));return true;}
 const data=await body(req);
 if(admin&&path==='/treinhuis/api/network-next-save'){json(res,200,await saveNetwork(data));return true;}
 if(admin&&path==='/treinhuis/api/network-next-test'){json(res,200,await testNetwork(data));return true;}
 if(admin&&path==='/treinhuis/api/offline-participant'){json(res,200,{participant:await addOfflineParticipant(data)});return true;}
 if(admin&&path==='/treinhuis/api/admin-claim-save'){json(res,200,{claim:await adminSaveClaim(data)});return true;}
 if(admin&&path==='/treinhuis/api/route-preview'){json(res,200,{proposal:await adminRoutePreview(data)});return true;}
 if(admin&&path==='/treinhuis/api/route-confirm'){json(res,200,{route:await adminRouteConfirm(data)});return true;}
 if(admin&&path==='/treinhuis/api/route-distance'){try{json(res,200,await externalDistance(String(data.from||''),String(data.to||'')));}catch(e){fail(e.message);}return true;}
 if(admin&&path==='/treinhuis/api/feature-save'){json(res,200,{post:await featureSave(data)});return true;}
 if(admin&&path==='/treinhuis/api/feature-stop'){await featureStop(data);json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/password-reset'){json(res,200,await createParticipantReset(data.id));return true;}
 if(admin&&path==='/treinhuis/api/proof-delete'){if(data.confirm!==true)fail('Bevestig het verwijderen.');json(res,200,{ok:true,...await deleteProof(data.id)});return true;}
 if(admin&&path==='/treinhuis/api/proof-order'){json(res,200,{submission:await setProofOrder(null,data,true)});return true;}
 if(admin&&path==='/treinhuis/api/participant-save'){const row=await kkGet('participant',data.id);if(!row||row.value.deleting)fail('Deelnemer niet beschikbaar.',404);const profile=validateProfile(data,row.value,true);const changes=Object.fromEntries(['fullName','displayName','edition','startTime','startDate','rotterdamTime','together','companion','station','distance','updatedAt'].map(k=>[k,profile[k]]));await kkPatchParticipant(data.id,changes);json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/participant-delete'){if(data.confirm!==true)fail('Bevestig het verwijderen.');await deleteParticipant(data.id);json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/update-save'){await editUpdate(data);json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/update-delete'){if(data.confirm!==true)fail('Bevestig het verwijderen.');await deleteUpdate(data.id);json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/start-time'){const row=await kkGet('participant',data.id);if(!row)fail('Deelnemer niet gevonden.',404);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.startTime||''))fail('Vul een geldige starttijd in.');const startDate=data.startDate||row.value.startDate||'2026-09-19';if(startTimestamp(startDate,data.startTime)===null)fail('Ongeldige startdatum.');await kkPatchParticipant(data.id,{startTime:data.startTime,startDate,updatedAt:Date.now()});json(res,200,{ok:true});return true;}
 if(admin&&path==='/treinhuis/api/approve-many'){if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>200||data.ids.some(id=>! /^[a-f0-9]{64}$/.test(id)))fail('Selecteer maximaal 200 accounts.');const approved=[],failed=[];for(const id of [...new Set(data.ids)]){try{await setApproval(id,true);approved.push(id);}catch{failed.push(id);}}json(res,200,{approved,failed});return true;}
 if(admin&&path==='/treinhuis/api/approval'){if(typeof data.approved!=='boolean')fail('Ongeldige goedkeuring.');await setApproval(data.id,data.approved);json(res,200,{ok:true});return true;}
 if(['/kilometerkampioen/api/register','/kilometerkampioen/api/password-login'].includes(path)){
 const email=emailOf(data.email),ip=digest(clientIP(req)||'unknown');
 if(!await kkLimit('password-ip:'+ip,30,3600000)||!await kkLimit('password-email:'+hash(email),10,3600000))fail('Te veel pogingen. Probeer over een uur opnieuw.',429);
 const user=path.endsWith('/register')?await registerPassword(email,data):await loginPassword(email,data.password);
 const session=token();await kkPut('session',hash(session),user.id,{credentialVersion:user.credentialVersion||''},Date.now()+7*86400000);cookie(res,session,7*86400);json(res,200,{participant:user});return true;
 }
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
  const session=token();await kkPut('session',hash(session),user.id,{credentialVersion:(await kkGet('password',user.id))?.value.version||''},Date.now()+7*86400000);cookie(res,session,7*86400);json(res,200,{participant:user});return true;
 }
 const user=await participant(req);if(!user)fail('Log eerst in.',401);
 if(path==='/kilometerkampioen/api/proof-order'){json(res,200,{submission:await setProofOrder(user,data)});return true;}
 if(path==='/kilometerkampioen/api/feature-vote'){json(res,200,{post:await featureVote(user,data)});return true;}
 if(path==='/kilometerkampioen/api/withdrawal'){const withdrawal=withdrawalDetails(user,data);await kkPatchParticipant(user.id,{withdrawal});json(res,200,{withdrawal});return true;}
 if(path==='/kilometerkampioen/api/claim-save'){json(res,200,{claim:await saveClaim(user,data)});return true;}
 if(path==='/kilometerkampioen/api/hilta-propose'){json(res,200,{proposal:await proposeHilta(user,data)});return true;}
 if(path==='/kilometerkampioen/api/hilta-confirm'){json(res,200,{confirmation:await confirmHilta(user,data)});return true;}
 if(path==='/kilometerkampioen/api/submit'){json(res,200,{submission:await saveSubmission(user,data)});return true;}
 if(path==='/kilometerkampioen/api/profile'){const profile=validateProfile(data,user);const changes=Object.fromEntries(['fullName','displayName','edition','rotterdamTime','together','companion','station','distance','updatedAt'].map(k=>[k,profile[k]]));if(!user.startTime)changes.startTime=profile.startTime;if(!user.startDate)changes.startDate=profile.startDate;const saved=await kkPatchParticipant(user.id,changes);json(res,200,{participant:saved});return true;}
 if(path==='/kilometerkampioen/api/logout'){const session=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kk_session='))?.slice(11);if(session)await kkDelete('session',hash(session));cookie(res,'',0);json(res,200,{ok:true});return true;}
 fail('Dit onderdeel is nog niet beschikbaar.',404);
 }catch(e){if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));json(res,e.status||500,{error:e.status?e.message:'Er ging iets mis. Je gegevens zijn nog niet bevestigd; probeer opnieuw.'});}return true;
}
