import {randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {kkGet,kkPut,kkLimit,kkReplaceCredential} from './kk-store.mjs';
import {passwordHash as participantHash} from './kk-password.mjs';
import {readAdminSecurity,writeAdminSecurity} from './board-cache.mjs';
import {adminAuthenticated,passwordHash,consumeTotp,allowed,countryFor,clientIP} from './admin-security.mjs';
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const fail=(s,status=400)=>{throw Object.assign(Error(s),{status});};
export async function createParticipantReset(id){const p=await kkGet('participant',id),c=await kkGet('password',id);if(!p||p.value.deleting||!c)fail('Deelnemer met wachtwoord niet gevonden.',404);const token=randomBytes(32).toString('base64url');if(!await kkReplaceCredential(id,c.payload,{...c.value,resetHash:hash(token),resetExpires:Date.now()+86400000}))fail('Het account is ondertussen gewijzigd. Probeer opnieuw.',409);return {path:'/wachtwoord-herstellen#participant.'+id+'.'+token};}
export async function handlePasswordReset(req,res,url){
 if(!url.pathname.startsWith('/wachtwoord-herstellen'))return false;
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 for(const [k,v] of Object.entries({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}))res.setHeader(k,v);
 try{
 if(req.method==='GET'&&['/wachtwoord-herstellen','/wachtwoord-herstellen.js'].includes(url.pathname)){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});res.end(await readFile(new URL(url.pathname.endsWith('.js')?'./password-reset.js':'./password-reset.html',import.meta.url)));return true;}
 if(req.method!=='POST'||url.pathname!=='/wachtwoord-herstellen/api')fail('Niet gevonden.',404);
 if(req.headers.origin!=='https://'+req.headers.host)fail('Open het formulier op de eigen website.',403);
 let size=0,parts=[];for await(const c of req){size+=c.length;if(size>4096)fail('Formulier te groot.',413);parts.push(c);}let d;try{d=JSON.parse(Buffer.concat(parts).toString());}catch{fail('Ongeldig formulier.');}
 if(!await kkLimit('reset:'+hash(clientIP(req)||'unknown'),12,900000))fail('Te veel pogingen. Probeer over 15 minuten opnieuw.',429);
 if(d.action==='admin-link'){
 if(!await adminAuthenticated(req))fail('Log in als eigenaar.',403);
 const r=await readAdminSecurity(),u=r.value.members?.[d.name];if(!u?.active)fail('Kies een actieve beheerder.');
 const token=randomBytes(32).toString('base64url');u.resetHash=hash(token);u.resetExpires=Date.now()+86400000;await writeAdminSecurity(r.value,r.revision);json(200,{path:'/wachtwoord-herstellen#admin.'+encodeURIComponent(d.name)+'.'+token});return true;
 }
 const match=/^(participant|admin)\.(.+)\.([A-Za-z0-9_-]{43})$/.exec(String(d.token||''));if(!match)fail('Deze herstellink is ongeldig. Vraag een nieuwe link aan.');
 const [,kind,encoded,token]=match,id=decodeURIComponent(encoded),now=Date.now();
 if(kind==='participant'){
 const c=await kkGet('password',id),p=await kkGet('participant',id);if(!p||p.value.deleting||!c||c.value.resetHash!==hash(token)||c.value.resetExpires<=now)fail('Deze herstellink is verlopen of al gebruikt. Vraag een nieuwe link aan.');
 const salt=randomBytes(16).toString('hex'),key=await participantHash(d.password,salt);
 if(!await kkReplaceCredential(id,c.payload,{salt,key:key.toString('hex'),version:hash(token)}))fail('De link is inmiddels vernieuwd of gebruikt. Vraag zo nodig een nieuwe link aan.');
 }else{
 const r=await readAdminSecurity(),s=r.value,u=s?.members?.[id];if(!u?.active||u.resetHash!==hash(token)||u.resetExpires<=now)fail('Deze herstellink is verlopen of al gebruikt.');
 if(!allowed(s,countryFor(req)))fail('Dit land is niet toegestaan. Neem contact op met de eigenaar.',403);
 if(typeof d.password!=='string'||d.password.length<14||d.password.length>256)fail('Gebruik 14 tot 256 tekens.');
 if(!consumeTotp(u,d.code,now))fail('De authenticatorcode klopt niet of is al gebruikt. Probeer een nieuwe code.',401);
 u.password=await passwordHash(d.password);delete u.resetHash;delete u.resetExpires;
 for(const group of [s.sessions,s.devices])for(const [key,v] of Object.entries(group))if(v.username===id)delete group[key];
 await writeAdminSecurity(s,r.revision);
 }
 json(200,{ok:true});
 }catch(e){json(e.status||500,{error:e.status?e.message:'Opslaan is niet gelukt. Probeer opnieuw; vraag zo nodig een nieuwe link aan.'});}return true;
}
