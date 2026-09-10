import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import {readBoardSettings,writeBoardSettings} from './board-cache.mjs';
import {swissDirections,matchesSwissDirection} from './swiss-directions.mjs';
let catalog={},saved=new Map(),provider,legacyMatch;
const attempts=new Map(),cookieName='treinbord_beheer';
export const defaultAppearance={accent:'#e5303c',text:'#252525',background:'#ffffff',alternate:'#faf8f5',buttonStart:'#1c6e92',buttonEnd:'#669620',font:'treinrondreis',width:1050,density:'normal',fullOpen:false,defaultTab:'all',showUpdated:true};
export async function initBoardAdmin({config,swissStations,norwegianStations,belgianStations,getPayload,matchDirection}){
 provider=getPayload;legacyMatch=matchDirection;
 catalog={...Object.fromEntries(Object.entries(config.stationPages||{}).map(([id,p])=>[id,{id,name:p.station||p.title,country:p.country||'DE',engine:'standard',title:p.title,directions:p.quickDirections||[]}]))};
 for(const [stations,country,engine] of [[belgianStations,'BE','standard'],[norwegianStations,'NO','standard'],[swissStations,'CH','swiss']])for(const [id,s] of Object.entries(stations))catalog[id]={id,name:s.name,country:s.country||country,engine,title:'Vertrektijden '+s.name,directions:engine==='swiss'?swissDirections[id]||[]:[]};
 saved=new Map((await readBoardSettings()).map(r=>[r.page,r]));
}
export function defaultBoardSettings(page){if(!Object.hasOwn(catalog,page))throw Error('Onbekend station');const s=catalog[page];return {title:s.title,footer:'',enabled:true,directions:structuredClone(s.directions).map((d,i)=>({...d,id:d.id||'richting-'+i,enabled:true,limit:8})),appearance:{...defaultAppearance}};}
function cleanText(v,max=200){return String(v??'').trim().slice(0,max);}
export function validateBoardSettings(page,input){
 if(!Object.hasOwn(catalog,page)||!input||typeof input!=='object'||Array.isArray(input))throw Error('Ongeldige instellingen');
 const result=defaultBoardSettings(page);result.title=cleanText(input.title,120)||result.title;result.footer=cleanText(input.footer,1500);result.enabled=input.enabled!==false;
 if(!Array.isArray(input.directions)||input.directions.length>40)throw Error('Gebruik maximaal 40 richtingsfilters.');
 const allowed=['id','label','target','also','futureStops','categories','excludedCategories','mode','brand','excludeBrand','serviceBrand','via','avoid','internationalIC','regionalOnly','enabled','limit'];
 result.directions=input.directions.map((v,i)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Ongeldig filter');
  const d={};for(const key of allowed)if(v[key]!==undefined)d[key]=v[key];
  d.id=cleanText(d.id,80)||'richting-'+i;d.label=cleanText(d.label,120);if(!d.label)throw Error('Geef elk filter een naam.');
  for(const key of ['also','futureStops','categories','excludedCategories'])if(d[key]!==undefined){if(!Array.isArray(d[key])||d[key].length>40)throw Error('Ongeldige filterlijst');d[key]=d[key].map(s=>cleanText(s,120)).filter(Boolean);}
  for(const key of ['target','brand','excludeBrand','serviceBrand','via','avoid'])if(d[key]!=null)d[key]=cleanText(d[key],120);
  d.mode=d.mode==='water'?'water':'rail';d.enabled=d.enabled!==false;d.limit=Math.min(30,Math.max(1,Number(d.limit)||8));return d;
 });
 if(new Set(result.directions.map(d=>d.id)).size!==result.directions.length)throw Error('Filters moeten een unieke identificatie hebben.');
 const a=input.appearance||{};
 for(const key of ['accent','text','background','alternate','buttonStart','buttonEnd'])if(/^#[a-f\d]{6}$/i.test(a[key]||''))result.appearance[key]=a[key];
 result.appearance.font=['treinrondreis','system','arial','verdana'].includes(a.font)?a.font:'treinrondreis';
 result.appearance.width=Math.min(1800,Math.max(600,Number(a.width)||1050));result.appearance.density=['compact','normal','roomy'].includes(a.density)?a.density:'normal';
 result.appearance.fullOpen=a.fullOpen===true;result.appearance.showUpdated=a.showUpdated!==false;result.appearance.defaultTab=['all','fernverkehr','regional'].includes(a.defaultTab)?a.defaultTab:'all';
 return result;
}
function matches(page,row,d){
 if(row.mergedServices)return row.mergedServices.some(r=>matches(page,r,d));
 if(d.excludedCategories?.includes(row.category))return false;
 if((row.transportMode||'rail')!==(d.mode||'rail'))return false;
 if(catalog[page].engine==='swiss')return matchesSwissDirection(row,d);
 const stops=row.futureRoute?.length?row.futureRoute:[row.to],norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 if(d.avoid&&stops.some(s=>norm(s)===norm(d.avoid)))return false;
 if(!d.categories?.length&&!d.futureStops?.length&&!d.serviceBrand&&!d.internationalIC&&!d.regionalOnly)return !d.via||stops.some(s=>norm(s)===norm(d.via));
 return legacyMatch(row,d);
}
export function applyBoardSettings(page,payload,override){
 if(!payload||!catalog[page])return payload;
 const settings=override||saved.get(page)?.settings;if(!settings)return payload;
 const rows=payload.departures?.all||[];
 return {...payload,title:settings.title,boardSettings:{footer:settings.footer,appearance:settings.appearance,enabled:settings.enabled},
  quick:settings.enabled?settings.directions.filter(d=>d.enabled).map(d=>{const trains=rows.filter(r=>matches(page,r,d)).slice(0,d.limit);return {id:d.id,label:d.label,count:trains.length,trains};}):[],
  departures:settings.enabled?payload.departures:{all:[],fernverkehr:[],regional:[]},notice:settings.enabled?payload.notice:'Dit vertrekbord is tijdelijk uitgeschakeld.'};
}
const password=()=>String(process.env.BOARD_ADMIN_PASSWORD||'');
const configured=()=>password().length>=12;
const sign=value=>createHmac('sha256',password()).update(value).digest('hex');
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function authenticated(req){
 if(!configured())return false;
 const value=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 const [expires,nonce,signature]=value.split('.');return Number(expires)>Date.now()&&Number(expires)<Date.now()+13*3600000&&Boolean(nonce)&&equal(signature||'',sign(expires+'.'+nonce));
}
function reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Error('De instellingen zijn te groot.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
function origin(req){return (req.headers['x-forwarded-proto']==='https'||req.socket.encrypted?'https':'http')+'://'+req.headers.host;}
export async function handleBoardAdmin(req,res,url){
 if(!url.pathname.startsWith('/api/board-admin/'))return false;
 try{
  const action=url.pathname.slice('/api/board-admin/'.length);
  if(req.method==='GET'&&action==='session'){reply(res,200,{configured:configured(),authenticated:authenticated(req)});return true;}
  if(req.method==='POST'&&req.headers.origin!==origin(req)){reply(res,403,{error:'Open het beheer op de eigen website.'});return true;}
  if(req.method==='POST'&&action==='login'){
   if(!configured()){reply(res,503,{error:'Het beheerwachtwoord is nog niet ingesteld (minimaal 12 tekens).'});return true;}
   const ip=req.socket.remoteAddress||'unknown',now=Date.now(),times=(attempts.get(ip)||[]).filter(t=>now-t<15*60000);attempts.set(ip,times);
   if(times.length>=20){reply(res,429,{error:'Te veel pogingen. Probeer het over 15 minuten opnieuw.'});return true;}
   const input=await body(req);times.push(now);
   if(!equal(sign(String(input.password||'')),sign(password()))){reply(res,401,{error:'Het wachtwoord klopt niet.'});return true;}
   attempts.delete(ip);const value=(now+12*3600000)+'.'+randomBytes(18).toString('hex');
   res.setHeader('Set-Cookie',cookieName+'='+value+'.'+sign(value)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200'+(origin(req).startsWith('https:')?'; Secure':''));reply(res,200,{ok:true});return true;
  }
  if(!authenticated(req)){reply(res,401,{error:'Log eerst in.'});return true;}
  if(req.method==='POST'&&action==='logout'){res.setHeader('Set-Cookie',cookieName+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');reply(res,200,{ok:true});return true;}
  if(req.method==='GET'&&action==='boards'){reply(res,200,{boards:Object.values(catalog).map(c=>({...c,directions:undefined,revision:saved.get(c.id)?.revision||0,updatedAt:saved.get(c.id)?.updatedAt||null,settings:saved.get(c.id)?.settings||defaultBoardSettings(c.id),defaults:defaultBoardSettings(c.id)}))});return true;}
  if(req.method==='POST'&&['save','preview'].includes(action)){
   const input=await body(req),page=String(input.page||''),settings=validateBoardSettings(page,input.settings);
   if(action==='preview'){reply(res,200,applyBoardSettings(page,provider(page),settings));return true;}
   if(Number(input.revision)!==(saved.get(page)?.revision||0)){reply(res,409,{error:'Dit bord is ondertussen gewijzigd. Laad het opnieuw.'});return true;}
   const state=await writeBoardSettings(page,settings,Number(input.revision));saved.set(page,{...state,settings});reply(res,200,{ok:true,...state,settings});return true;
  }
  reply(res,404,{error:'Niet gevonden.'});
 }catch(e){reply(res,e.status||400,{error:e.message||'Opslaan is niet gelukt.'});}
 return true;
}
