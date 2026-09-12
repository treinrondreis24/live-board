import {randomBytes,createHash,createHmac,timingSafeEqual,scrypt as scryptCallback,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {isIP} from 'node:net';
import {readFile} from 'node:fs/promises';
import geoip from 'geoip-lite';
import QRCode from 'qrcode';
import {readAdminSecurity,writeAdminSecurity} from './board-cache.mjs';

const scrypt=promisify(scryptCallback),SESSION='tr_admin_session',TRUST='tr_admin_device',DAY=86400000;
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const safe=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const token=()=>randomBytes(32).toString('base64url');
const key=()=>createHash('sha256').update('treinreiziger-admin-v1\0'+(process.env.ADMIN_ENCRYPTION_KEY||process.env.BOARD_ADMIN_PASSWORD||'')).digest();
function seal(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);return Buffer.concat([iv,c.update(value,'utf8'),c.final(),c.getAuthTag()]).toString('base64url');}
function unseal(value){const b=Buffer.from(value,'base64url'),d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,v=0,out='';for(const b of bytes){v=(v<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(v>>>bits)&31];}}if(bits)out+=alphabet[(v<<(5-bits))&31];return out;}
function decode32(s){let bits=0,v=0,out=[];for(const c of s){v=(v<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;out.push((v>>>bits)&255);}}return Buffer.from(out);}
export function totp(secret,time=Date.now()){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const h=createHmac('sha1',decode32(secret)).update(counter).digest(),o=h[19]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0');}
function consumeTotp(user,code,now){if(!/^\d{6}$/.test(String(code)))return false;const current=Math.floor(now/30000);for(const step of [current,current-1,current+1])if(step>(user.lastStep??-1)&&safe(totp(unseal(user.secret),step*30000),code)){user.lastStep=step;return true;}return false;}
async function passwordHash(p){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(p,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex');}
async function verifyPassword(p,encoded){const [salt,digest]=encoded.split(':');return safe((await scrypt(String(p).slice(0,512),salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex'),digest);}
export function clientIP(req){const raw=process.env.RAILWAY_ENVIRONMENT_ID?req.headers['x-real-ip']:req.socket.remoteAddress;const ip=String(raw||'').replace(/^::ffff:/,'');return isIP(ip)?ip:null;}
export function countryFor(req){const ip=clientIP(req);return ip?geoip.lookup(ip)?.country||null:null;}
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));}
function cookie(res,name,value,seconds){const existing=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:[existing]),`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`]);}
function headers(res){res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');}
function reply(res,status,data){headers(res);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
async function body(req){let n=0,parts=[];for await(const b of req){n+=b.length;if(n>8192)fail('Verzoek te groot.',413);parts.push(b);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{fail('Ongeldig verzoek.');}}
const fresh=()=>({user:null,pending:{},sessions:{},devices:{},attempts:{},countries:[{code:'NL',until:null}]});
function prune(s,now){for(const group of ['pending','sessions','devices'])for(const [id,v] of Object.entries(s[group]))if(v.expires<=now)delete s[group][id];for(const [id,v] of Object.entries(s.attempts))if(v.start<now-15*60000)delete s.attempts[id];}
export function allowed(s,country,now=Date.now()){return !!country&&s.countries.some(c=>c.code===country&&(!c.until||c.until>now));}
export function sessionFor(req,s,country,now=Date.now()){const v=s.sessions[hash(cookies(req)[SESSION]||'')];if(!v||v.expires<=now)return null;if(v.recovery)return v;return v.country===country&&allowed(s,country,now)?v:null;}
export async function securityStatus(){return !!(await readAdminSecurity()).value?.user;}
export async function adminAuthenticated(req){const s=(await readAdminSecurity()).value;if(!s?.user)return false;const session=sessionFor(req,s,countryFor(req));return !!session&&!session.recovery;}
function consumeRecovery(user,code){const h=hash(String(code||'').replace(/[\s-]/g,'').toUpperCase());const i=user.recovery.findIndex(x=>safe(x,h));if(i<0)return false;user.recovery.splice(i,1);return true;}
function codes(){return Array.from({length:10},()=>randomBytes(10).toString('hex').toUpperCase());}
function newSession(s,res,now,recovery=false,country=null){const t=token();s.sessions[hash(t)]={expires:now+(recovery?15*60000:12*3600000),recovery,created:now,country};cookie(res,SESSION,t,recovery?900:43200);}
function countryList(input){if(!Array.isArray(input)||!input.length||input.length>250)fail('Kies minstens één land.');const display=new Intl.DisplayNames(['nl'],{type:'region'});return input.map(v=>{const code=String(v.code||'').toUpperCase();if(!/^[A-Z]{2}$/.test(code)||display.of(code)===code)fail('Onbekend land.');const until=v.until?Number(v.until):null;if(until&&(!Number.isFinite(until)||until<=Date.now()))fail('De einddatum moet in de toekomst liggen.');return {code,until};});}

// Mutation requests use a durable CAS revision. Racing requests fail rather than
// accepting a reused TOTP/recovery code or reviving a revoked session.
export async function handleAdminSecurity(req,res,url){
 const path=url.pathname;
 if(['/stationschef','/stationschef/','/seinhuis','/seinhuis/'].includes(path)){
  headers(res);res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(new URL('./admin-security.html',import.meta.url)));return true;
 }
 if(['/admin-security.js','/admin-security.css'].includes(path)){headers(res);res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});res.end(await readFile(new URL('.'+path,import.meta.url)));return true;}
 if(!path.startsWith('/api/admin-security/'))return false;
 headers(res);
 try{
  const record=await readAdminSecurity(),s=record.value||fresh(),now=Date.now(),country=countryFor(req);prune(s,now);
  const session=sessionFor(req,s,country,now),action=path.slice('/api/admin-security/'.length);
  if(req.method==='GET'&&action==='session'){reply(res,200,{setup:!s.user,authenticated:!!session,recovery:!!session?.recovery,country,username:session?s.user.name:undefined});return true;}
  if(req.method==='GET'&&action==='settings'){
   if(!session)fail('Log eerst in.',401);
   reply(res,200,{username:s.user.name,country,countries:s.countries,recovery:session.recovery,recoveryCodesRemaining:s.user.recovery.length,devices:Object.entries(s.devices).map(([id,d])=>({id,label:d.label,created:d.created,expires:d.expires})),appStatus:'De beheerbasis is klaar. Pagina- en inhoudsbeheer volgt in stap 3.'});return true;
  }
  if(req.method!=='POST')fail('Niet gevonden.',404);
  const expected='https://'+req.headers.host;
  if(req.headers.origin!==expected)fail('Open het beheer op de eigen website.',403);
  const input=await body(req),ip=hash(clientIP(req)||'unknown');
  const rate=s.attempts[ip]||{start:now,count:0};
  if(rate.count>=12)fail('Te veel pogingen. Wacht 15 minuten.',429);
  // Persist attempts before password hashing to limit both expensive work and
  // repeated guesses. Success does not reset the rate window.
  rate.count++;s.attempts[ip]=rate;record.revision=await writeAdminSecurity(s,record.revision);
  const commit=async data=>{await writeAdminSecurity(s,record.revision);reply(res,200,data);};
  if(action==='setup-start'){
   if(s.user)fail('De beheerder is al ingesteld.',409);
   const bootstrap=process.env.BOARD_ADMIN_PASSWORD||'';
   if(bootstrap.length<12||!safe(hash(input.currentPassword||''),hash(bootstrap)))fail('Inloggegevens kloppen niet.',401);
   if(!/^[a-zA-Z0-9_.@-]{3,80}$/.test(input.username||''))fail('Gebruik 3–80 letters, cijfers, punten of streepjes voor de gebruikersnaam.');
   if(typeof input.password!=='string'||input.password.length<14||input.password.length>256)fail('Gebruik een wachtwoord van 14 tot 256 tekens.');
   const secret=base32(randomBytes(20)),t=token();
   s.pending={};s.pending[hash(t)]={expires:now+10*60000,name:input.username,password:await passwordHash(input.password),secret:seal(secret),lastStep:-1};
   const uri=`otpauth://totp/Treinreiziger:${encodeURIComponent(input.username)}?secret=${secret}&issuer=Treinreiziger&algorithm=SHA1&digits=6&period=30`;
   await commit({challenge:t,secret,qr:await QRCode.toDataURL(uri),country});return true;
  }
  if(action==='setup-finish'){
   if(s.user)fail('De beheerder is al ingesteld.',409);
   const pending=s.pending[hash(input.challenge||'')];if(!pending)fail('De instelling is verlopen. Begin opnieuw.');
   if(!consumeTotp(pending,input.code,now))fail('De authenticatorcode klopt niet of is al gebruikt.',401);
   // Do not activate an account the owner cannot use from the current network.
   if(country!=='NL')fail('Activeer vanuit Nederland. Je bestaande beheer blijft beschikbaar.',403);
   const recovery=codes();s.user={name:pending.name,password:pending.password,secret:pending.secret,lastStep:pending.lastStep,recovery:recovery.map(hash)};s.pending={};newSession(s,res,now,false,country);
   await commit({ok:true,recoveryCodes:recovery});return true;
  }
  if(!s.user)fail('Stel eerst de beheerder in.',409);
  if(action==='login'){
   const valid=await verifyPassword(input.password||'',s.user.password);
   if(!valid||!safe(String(input.username||'').toLowerCase(),s.user.name.toLowerCase()))fail('Inloggegevens kloppen niet.',401);
   const recovery=!!input.recoveryCode;
   if(recovery){if(!consumeRecovery(s.user,input.recoveryCode))fail('Herstelcode klopt niet of is al gebruikt.',401);}
   else{
    if(!allowed(s,country,now))fail('Dit land is niet toegestaan of kon niet worden vastgesteld. Gebruik de herstelroute.',403);
    const device=s.devices[hash(cookies(req)[TRUST]||'')];
    const trusted=country==='NL'&&device&&device.expires>now;
    const verified=trusted?false:consumeTotp(s.user,input.code,now);
    if(!trusted&&!verified)fail('Vul een geldige authenticatorcode in. Elke code kan eenmaal gebruikt worden.',401);
    if(input.trust&&country==='NL'&&verified){const t=token();s.devices[hash(t)]={created:now,expires:now+30*DAY,label:String(input.deviceName||'Mijn browser').slice(0,80)};cookie(res,TRUST,t,30*86400);}
   }
   newSession(s,res,now,recovery,country);await commit({ok:true,recovery});return true;
  }
  if(!session)fail('Log eerst in.',401);
  if(action==='logout'){delete s.sessions[hash(cookies(req)[SESSION]||'')];cookie(res,SESSION,'',0);await commit({ok:true});return true;}
  if(!['countries','revoke-device','password','recovery-codes'].includes(action))fail('Niet gevonden.',404);
  if(!(session.recovery?consumeRecovery(s.user,input.recoveryCode):consumeTotp(s.user,input.code,now)))fail(session.recovery?'Gebruik een tweede, ongebruikte herstelcode.':'Vul een nieuwe authenticatorcode in.',401);
  if(action==='countries'){
   const countries=countryList(input.countries);
   if(country&&!countries.some(c=>c.code===country&&(!c.until||c.until>now)))fail('Laat je huidige land toegestaan om jezelf niet buiten te sluiten.');
   s.countries=countries;await commit({ok:true,relogin:session.recovery});return true;
  }
  if(session.recovery)fail('Log na herstel opnieuw in met je authenticator.',403);
  if(action==='revoke-device'){delete s.devices[String(input.id)];s.sessions={};cookie(res,SESSION,'',0);cookie(res,TRUST,'',0);await commit({ok:true,relogin:true});return true;}
  if(action==='password'){
   if(typeof input.password!=='string'||input.password.length<14||input.password.length>256)fail('Gebruik 14 tot 256 tekens.');
   s.user.password=await passwordHash(input.password);s.sessions={};s.devices={};cookie(res,SESSION,'',0);cookie(res,TRUST,'',0);await commit({ok:true,relogin:true});return true;
  }
  const recovery=codes();s.user.recovery=recovery.map(hash);await commit({ok:true,recoveryCodes:recovery});return true;
 }catch(e){reply(res,e.status||500,{error:e.status?e.message:'De beveiligingsinstellingen konden niet worden verwerkt.'});return true;}
}
