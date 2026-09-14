import {readFile} from 'node:fs/promises';import {randomBytes,createHash} from 'node:crypto';import QRCode from 'qrcode';
import {readAdminSecurity,writeAdminSecurity} from './board-cache.mjs';
import {adminAuthenticated,allowed,countryFor,clientIP,passwordHash,base32,seal,consumeTotp,newSession} from './admin-security.mjs';
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
export async function handleTreinhuisAccess(req,res,url){
 const path=url.pathname,owner=path.startsWith('/stationschef/treinhuis-gebruikers'),activate=path.startsWith('/treinhuis/activeren');if(!owner&&!activate)return false;
 const known=['/stationschef/treinhuis-gebruikers','/stationschef/treinhuis-gebruikers.js','/stationschef/treinhuis-gebruikers/api','/treinhuis/activeren','/treinhuis/activeren.js','/treinhuis/activeren/api'];
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 for(const [k,v] of Object.entries({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}))res.setHeader(k,v);
 if(!known.includes(path)){json(404,{error:'Niet gevonden.'});return true;}
 if(owner&&!await adminAuthenticated(req)){json(403,{error:'Log in als eigenaar bij Stationschef.'});return true;}
 try{
 if(!path.endsWith('/api')){if(req.method!=='GET'){json(405,{error:'Niet toegestaan.'});return true;}const name=owner?'treinhuis-users':'treinhuis-activate',extension=path.endsWith('.js')?'js':'html';res.writeHead(200,{'Content-Type':extension==='js'?'text/javascript':'text/html; charset=utf-8'});res.end(await readFile(new URL('./'+name+'.'+extension,import.meta.url)));return true;}
 const record=await readAdminSecurity(),s=record.value,now=Date.now();if(!s?.user){json(409,{error:'Beheer is nog niet ingesteld.'});return true;}s.members||={};
 if(owner&&req.method==='GET'){json(200,{users:Object.values(s.members).map(u=>({name:u.name,email:u.email,active:!!u.active,scope:u.scope,pending:!u.active&&!!u.inviteHash&&u.inviteExpires>now}))});return true;}
 if(req.method!=='POST'){json(405,{error:'Niet toegestaan.'});return true;}
 if(req.headers.origin!=='https://'+req.headers.host){json(403,{error:'Open deze pagina op de eigen website.'});return true;}
 let n=0;const parts=[];for await(const chunk of req){n+=chunk.length;if(n>8192){json(413,{error:'Verzoek te groot.'});return true;}parts.push(chunk);}let data;try{data=JSON.parse(Buffer.concat(parts).toString());}catch{json(400,{error:'Ongeldig verzoek.'});return true;}
 const ip=hash(clientIP(req)||'unknown'),attempt=s.attempts[ip];s.attempts[ip]=attempt&&attempt.start>now-15*60000?attempt:{start:now,count:0};if(s.attempts[ip].count>=12){const retryAfter=Math.max(1,Math.ceil((s.attempts[ip].start+15*60000-now)/1000));res.setHeader('Retry-After',String(retryAfter));json(429,{error:'Te veel pogingen. Probeer over '+Math.ceil(retryAfter/60)+' minuten opnieuw met dezelfde activatielink. Je account is niet verwijderd.',retryAfter});return true;}s.attempts[ip].count++;record.revision=await writeAdminSecurity(s,record.revision);
 if(owner){
 const name=String(data.name||'').trim();if(data.action==='revoke'){if(!s.members[name]){json(404,{error:'Gebruiker niet gevonden.'});return true;}s.members[name].active=false;delete s.members[name].inviteHash;delete s.members[name].enrollment;for(const group of [s.sessions,s.devices])for(const [id,v] of Object.entries(group))if(v.username===name)delete group[id];await writeAdminSecurity(s,record.revision);json(200,{ok:true});return true;}
 if(data.action==='reinvite'){
 const user=Object.hasOwn(s.members,name)?s.members[name]:null;if(!user){json(404,{error:'Gebruiker niet gevonden.'});return true;}if(user.active){json(409,{error:'Dit account is al actief; een nieuwe activatielink is niet nodig.'});return true;}
 const token=randomBytes(32).toString('base64url');user.inviteHash=hash(token);user.inviteExpires=now+48*3600000;delete user.enrollment;await writeAdminSecurity(s,record.revision);json(200,{name,activationPath:'/treinhuis/activeren#'+token});return true;
 }
 const email=String(data.email||'').trim().toLowerCase();if(['__proto__','constructor','prototype'].includes(name)||!/^[a-zA-Z0-9_.@-]{3,80}$/.test(name)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254){json(400,{error:'Vul een gebruikersnaam en geldig e-mailadres in.'});return true;}
 if([s.user,...Object.values(s.members)].some(u=>u.name.toLowerCase()===name.toLowerCase())){json(409,{error:'Deze gebruikersnaam bestaat al.'});return true;}
 if(Object.keys(s.members).length>=20){json(400,{error:'Maximaal 20 extra beheerders.'});return true;}
 const token=randomBytes(32).toString('base64url');s.members[name]={name,email,scope:'treinhuis',active:false,inviteHash:hash(token),inviteExpires:now+48*3600000,createdAt:now};await writeAdminSecurity(s,record.revision);json(200,{name,activationPath:'/treinhuis/activeren#'+token});return true;
 }
 const user=Object.values(s.members).find(u=>!u.active&&u.inviteHash===hash(data.token||'')&&u.inviteExpires>now);if(!user){json(400,{error:'Deze activatielink is ongeldig, verlopen of al gebruikt.'});return true;}
 const country=countryFor(req);if(!allowed(s,country,now)){json(403,{error:'Activeren niet toegestaan vanuit '+(country||'een onbekend land')+'. Laat de eigenaar dit land opslaan met een authenticatorcode en probeer daarna opnieuw.'});return true;}
 if(data.action==='start'){
 if(typeof data.password!=='string'||data.password.length<14||data.password.length>256){json(400,{error:'Gebruik een wachtwoord van 14 tot 256 tekens.'});return true;}
 const secret=base32(randomBytes(20));user.enrollment={password:await passwordHash(data.password),secret:seal(secret),lastStep:-1,expires:now+10*60000};await writeAdminSecurity(s,record.revision);const uri=`otpauth://totp/Treinhuis:${encodeURIComponent(user.name)}?secret=${secret}&issuer=Treinhuis&algorithm=SHA1&digits=6&period=30`;json(200,{name:user.name,secret,qr:await QRCode.toDataURL(uri)});return true;
 }
 if(data.action!=='finish'||!user.enrollment||user.enrollment.expires<=now||!consumeTotp(user.enrollment,data.code,now)){json(400,{error:'De code klopt niet of de instelling is verlopen. Probeer opnieuw.'});return true;}
 Object.assign(user,{password:user.enrollment.password,secret:user.enrollment.secret,lastStep:user.enrollment.lastStep,recovery:[],active:true});delete user.inviteHash;delete user.inviteExpires;delete user.enrollment;newSession(s,res,now,false,country,user.name);await writeAdminSecurity(s,record.revision);json(200,{ok:true});return true;
 }catch(e){json(e.status||500,{error:e.status?e.message:'De wijziging is niet opgeslagen. Probeer opnieuw.'});return true;}
}
