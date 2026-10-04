import {floraMail} from './flora-mail.mjs';
import {floraGoogle} from './flora-google.mjs';
import {readFile} from 'node:fs/promises';
import {adminAuthenticated} from './admin-security.mjs';
import {readAdminSecurity} from './board-cache.mjs';
import {readFlora,writeFlora} from './flora-store.mjs';
import {evaluate,validateEvidence,hash,twoMonthsBefore,reviewSignature,alarmView} from './flora-engine.mjs';
import {fetchBookings,sanityConfig} from './flora-sanity.mjs';
import {applyFollowup} from './flora-followup.mjs';
import {scheduleInfo} from './flora-schedule.mjs';

const prefix='/seinhuis/flora';
const googleSession=req=>String(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('tr_admin_session='))||'';
export function parseCSV(text){
 const rows=[];let row=[],value='',quoted=false;const delimiter=text.split(/\r?\n/)[0].includes(';')?';':',';
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===delimiter){row.push(value);value='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(Boolean))rows.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw Error('Niet afgesloten aanhalingstekens in CSV.');row.push(value);if(row.some(Boolean))rows.push(row);
 const headers=(rows.shift()||[]).map(x=>x.trim().replace(/^\uFEFF/,''));if(new Set(headers).size!==headers.length)throw Error('Dubbele kolomnamen in CSV.');return rows.map(r=>{if(r.length!==headers.length)throw Error('CSV-regel heeft een afwijkend aantal kolommen.');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
export function createFloraHandler({authenticate=adminAuthenticated,read=readFlora,write=writeFlora,sync=fetchBookings,actor=async()=>((await readAdminSecurity()).value?.user?.name||'Seinhuis-beheerder'),configuration=sanityConfig,google=floraGoogle,mail=floraMail}={}){
 return async(req,res,url)=>{
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  for(const [k,v] of Object.entries({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}))res.setHeader(k,v);
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};
  if(!await authenticate(req)){if(req.method==='GET'&&[prefix,prefix+'/'].includes(url.pathname)){res.writeHead(303,{Location:'/seinhuis'});res.end();return true;}return reply(401,{error:'Log eerst in bij Seinhuis.'});}
  const path=url.pathname.slice(prefix.length);
  try{
   if(req.method==='GET'){
    if(path==='/google/callback'){let result='connected';try{await google.callback(url.searchParams,googleSession(req));}catch(e){result=e.message;}res.writeHead(303,{Location:prefix+'/?gmail='+encodeURIComponent(result)});res.end();return true;}
    const files={'':'flora.html','/':'flora.html','/flora.js':'flora.js','/flora.css':'flora.css'};
    if(files[path]){const ext=files[path].split('.').pop();res.writeHead(200,{'Content-Type':({html:'text/html',js:'text/javascript',css:'text/css'})[ext]+'; charset=utf-8'});res.end(await readFile(new URL('./'+files[path],import.meta.url)));return true;}
    if(path==='/api/mail/status')return reply(200,await mail.status());
    if(path==='/api/state'){const data=await read(),gmail=await google.status();data.state.findings=data.state.findings.map(f=>{const next={...f,reviewSignature:reviewSignature(f)};return {...next,viewStatus:alarmView(next)};});return reply(200,{...data,gmail,schedule:scheduleInfo(data.state),connection:{sanityConfigured:!!configuration().token,lastSync:data.state.lastSync,syncError:data.state.syncError||null,email:gmail.email,payment:'Betaallink aanwezig: hotelbevestiging wordt gecontroleerd'}});}
    return reply(404,{error:'Niet gevonden.'});
   }
   if(req.method!=='POST')return reply(405,{error:'Methode niet toegestaan.'});
   const origin=process.env.FLORA_PUBLIC_ORIGIN||'https://treinbord.up.railway.app';
   if(req.headers.origin!==origin||req.headers['x-flora']!=='1'||!String(req.headers['content-type']).startsWith('application/json'))return reply(403,{error:'Open FloRA vanuit Seinhuis.'});
   let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>3*1024*1024)return reply(413,{error:'Bestand is te groot (maximaal 3 MB).'});}
   let input;try{input=JSON.parse(text);}catch{return reply(400,{error:'Ongeldige invoer.'});}
   if(path==='/api/mail/start'){if(input.mode&&!['attention','rules-only','manual'].includes(input.mode))return reply(400,{error:'Onbekende controle.'});const result=await mail.start({pilot:input.pilot===true,mode:input.mode||'manual'});void mail.tick();return reply(202,result);}
   if(path==='/api/google/start')return reply(200,{url:await google.start(googleSession(req))});
   if(path==='/api/google/test')return reply(200,await google.test());
   const {state,revision}=await read();if(input.revision!==revision)return reply(409,{error:'FloRA is ondertussen gewijzigd. Herlaad eerst.'});
   const now=new Date().toISOString(),user=await actor(),audit=(action,detail)=>state.audit.push({at:now,user,action,detail});
   let evaluated=false;
   if(path==='/api/sync'||path==='/api/check'){state.bookings=await sync();state.lastSync=now;state.syncError=null;applyFollowup(state,{now,mode:'manual',user});evaluated=true;}
   else if(path==='/api/import-preview'||path==='/api/import'){
    const rows=validateEvidence(input.format==='csv'?parseCSV(String(input.content||'')):JSON.parse(String(input.content||''))),digest=hash(rows);
    const unknown=rows.filter(e=>!state.bookings.some(b=>String(b.index)===e.trip&&(b.todos||[]).some(t=>t._key===e.todoKey))).length;
    if(path.endsWith('preview'))return reply(200,{digest,rows,unknown,message:`${rows.length} reserveringen; ${unknown} zonder eenduidig gekoppelde todo. Controleer de tabel voor opslaan.`});
    if(input.digest!==digest)return reply(400,{error:'Bekijk eerst het importvoorbeeld.'});
    const byId=new Map(state.evidence.map(e=>[e.id,e]));for(const e of rows)byId.set(e.id,{...e,importedAt:now});state.evidence=[...byId.values()];state.imports.push({at:now,user,name:String(input.name||'Import').slice(0,200),count:rows.length,digest});audit('Bestand geïmporteerd',`${rows.length} reserveringen`);
   }
   else if(path==='/api/seen'){
    const f=state.findings.find(x=>x.id===input.id);if(!f||f.status!=='alarm')return reply(404,{error:'Open alarm niet gevonden.'});
    if(input.signature!==reviewSignature(f))return reply(409,{error:'Het alarm is gewijzigd. Open het opnieuw voordat je het markeert.'});
    f.viewed={signature:reviewSignature(f),at:now,user,note:String(input.reason||'').trim().slice(0,2000)};
    f.history.push({at:now,user,status:'bekeken',reason:f.viewed.note||'Bekeken; alarm blijft open.'});audit('Alarm bekeken',f.id);
   }
   else if(path==='/api/review'){
    const f=state.findings.find(x=>x.id===input.id);if(!f)return reply(404,{error:'Melding niet gevonden; voer controles opnieuw uit.'});
    if(!['alarm','attention','checked','automatic'].includes(input.status)||typeof input.reason!=='string'||input.reason.trim().length<5)return reply(400,{error:'Kies een status en geef een toelichting (minimaal 5 tekens).'});
    f.override=input.status==='automatic'?null:{status:input.status,reason:input.reason.trim().slice(0,2000),user,at:now};f.history.push({at:now,user,status:input.status,reason:input.reason.trim().slice(0,2000)});audit('Melding beoordeeld',f.id);
   }
   else if(path==='/api/rules-preview'||path==='/api/rules'){
    if(!['low','accept'].includes(input.partialNames))return reply(400,{error:'Ongeldige naamregel.'});
    const rules={...state.rules,partialNames:input.partialNames,version:state.rules.version+1},result=evaluate({...state,rules});
    if(path.endsWith('preview'))return reply(200,{digest:hash(rules),alarms:result.findings.filter(f=>f.status==='alarm').length,attention:result.findings.filter(f=>f.status==='attention').length});
    if(input.digest!==hash(rules))return reply(400,{error:'Test de regels eerst.'});state.ruleHistory.push({at:now,user,rules:state.rules});state.rules=rules;audit('Controleregels gewijzigd',`Versie ${rules.version}`);
   }
   else if(path==='/api/defer'){
    const b=state.bookings.find(b=>String(b.index)===String(input.trip));
    if(!b?.dateDeparture||!/^\d{4}-\d{2}-\d{2}$/.test(input.until||'')||input.until>twoMonthsBefore(b.dateDeparture)||input.until<=now.slice(0,10)||!input.reason?.trim())return reply(400,{error:'Uitstel kan alleen in de toekomst en uiterlijk twee maanden voor vertrek, met reden.'});
    state.deferrals[String(input.trip)]={until:input.until,reason:String(input.reason).slice(0,2000),at:now,user};audit('Alarm uitgesteld',String(input.trip));
   }
   else return reply(404,{error:'Niet gevonden.'});
   if(!evaluated)Object.assign(state,evaluate(state,now));const next=await write(state,revision);let emailStarted=false;if(path==='/api/check'&&(await google.status()).connected){await mail.start();void mail.tick();emailStarted=true;}return reply(200,{ok:true,revision:next,emailStarted});
  }catch(e){return reply(e.status||400,{error:e.message||'FloRA kon de aanvraag niet verwerken.'});}
 };
}
export const handleFlora=createFloraHandler();
