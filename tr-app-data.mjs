import {contentUrl,getTrips} from './tr-app-content.mjs';
import fs from 'node:fs/promises';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {unzipSync} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {parseDutchPlan,combineDutchRows} from './nl-planning.mjs';
import {recordAppStationAdded} from './board-cache.mjs';

export function parseStationCatalog(bytes){
 const z=unzipSync(bytes,{filter:f=>f.name==='stations.dat'});
 return new TextDecoder('windows-1252').decode(z['stations.dat']).split(/\r?\n/).filter(l=>!l.startsWith('@')).map(l=>l.split(',').map(s=>s.trim())).filter(f=>f[0]==='1'&&f[4]==='NL').map(f=>({id:'nl-'+f[1].toLowerCase(),code:f[1].toUpperCase(),name:f.at(-1),country:'NL'}));
}
let bytes,catalog=[],loaded=0,loading,queue=Promise.resolve(),news,newsLoading,stats,statWrites=Promise.resolve();
const temporary=new Map();
setInterval(()=>{for(const [k,s]of temporary)if(s.until<Date.now()&&!s.loading)temporary.delete(k);},60000).unref();
export function activeAppStation(code){const s=temporary.get(code);return s&&s.until>Date.now()?s.station:null;}
export function acceptAppRow(row){const s=temporary.get(row.stationShortCode);if(!s||s.until<Date.now())return;const old=s.live.get(row.id);if(!old||old.messageTimestamp<row.messageTimestamp)s.live.set(row.id,row);}
async function ensureCatalog(){
 if(bytes&&Date.now()-loaded<6*3600000)return;
 if(!loading)loading=(async()=>{const r=await fetch('https://data.ndovloket.nl/ns/ns-latest.zip',{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Nederlandse stationslijst tijdelijk niet beschikbaar');const b=new Uint8Array(await r.arrayBuffer());if(b.length>30*1024*1024)throw Error('Dienstregeling te groot');const c=parseStationCatalog(b);if(c.length<100)throw Error('Onvolledige stationslijst');bytes=b;catalog=c;loaded=Date.now();})().finally(()=>loading=null);
 await loading;
}
async function onDemand(station){
 for(const [k,s]of temporary)if(s.until<Date.now())temporary.delete(k);
 let s=temporary.get(station.code);
 if(!s){if(temporary.size>=100)throw Error('Het is druk. Probeer dit station later opnieuw.');s={station,until:0,live:new Map()};temporary.set(station.code,s);}
 s.until=Date.now()+30*60000;
 if(!s.plan||s.planAt!==loaded){if(!s.loading){s.loading=queue.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{const w=new Worker(new URL(import.meta.url),{workerData:{appPlan:true,bytes,station},resourceLimits:{maxOldGenerationSizeMb:192}});const timer=setTimeout(()=>{void w.terminate();reject(Error('Ophalen duurt te lang; probeer opnieuw'));},60000);w.once('message',p=>{clearTimeout(timer);s.plan=p;s.planAt=loaded;resolve();});w.once('error',e=>{clearTimeout(timer);reject(e);});w.once('exit',c=>{clearTimeout(timer);if(c)reject(Error('Dienstregeling kon niet worden geladen'));});})).finally(()=>s.loading=null);queue=s.loading;}await s.loading;}
 const now=Date.now();for(const [k,r]of s.live)if(r.plannedTimestamp<now-86400000)s.live.delete(k);
 const live=[...s.live.values()].map(r=>now-r.messageTimestamp>180000?{...r,hasRealtime:false,delay:0,expectedTimestamp:r.plannedTimestamp}:r);
 return {source:'NDOV',notice:'Dienstregeling met ontvangen actuele berichten. Zonder actuele meting tonen we een klokje.',departures:{all:combineDutchRows(s.plan.rows.filter(r=>r.plannedTimestamp>=now-60000&&r.plannedTimestamp<now+86400000),live,now)}};
}
const safeUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'?u.href:null;}catch{return null;}};
export function parseNews(xml){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Ongeldige nieuwsfeed');
 const p=new XMLParser({ignoreAttributes:false}).parse(xml),items=p.rss?.channel?.item;if(!items)throw Error('Nieuwsfeed niet beschikbaar');
 const clean=s=>String(s||'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v<=0x10ffff?String.fromCodePoint(v):'';}).replace(/&(nbsp|amp|quot|apos|lt|gt);/g,(_,n)=>({nbsp:' ',amp:'&',quot:'\"',apos:"'",lt:'<',gt:'>'}[n])).replace(/<[^>]*>/g,' ').replace(/lees meer\s*\.\.\.\s*$/i,'').replace(/\s+/g,' ').trim();
 return (Array.isArray(items)?items:[items]).slice(0,30).map(i=>({title:clean(i.title),url:safeUrl(i.link),date:i.pubDate,summary:clean(i.description).slice(0,240),image:contentUrl(i.image,['www.treinreiziger.nl','treinreiziger.nl']),categories:(Array.isArray(i.category)?i.category:[i.category]).filter(Boolean).map(clean)})).filter(i=>i.url&&['treinreiziger.nl','www.treinreiziger.nl'].includes(new URL(i.url).hostname));
}
async function getNews(){if(news&&Date.now()-news.at<5*60000)return news;if(!newsLoading)newsLoading=(async()=>{try{const r=await fetch('https://www.treinreiziger.nl/category/nieuws/feed/',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Nieuws tijdelijk niet bereikbaar');const xml=await r.text();if(xml.length>2e6)throw Error('Nieuwsfeed te groot');news={at:Date.now(),items:parseNews(xml)};return news;}catch(e){if(news)return {...news,stale:true};throw e;}})().finally(()=>newsLoading=null);return newsLoading;}
export function createTreinreizigerHandler({stations,getBoard}){
 const foreign=stations.filter(s=>s.country!=='NL');
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 return async(req,res,url)=>{
 if(!url.pathname.startsWith('/app'))return false;
 try{
 const assets={'/app':'tr-app.html','/app/':'tr-app.html','/app/app.js':'tr-app.js','/app/app.css':'tr-app.css','/app/sw.js':'tr-app-sw.js','/app/icon.svg':'tr-app-icon.svg','/app/manifest.webmanifest':'tr-app.webmanifest'};
 if(assets[url.pathname]){const file=assets[url.pathname],type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; frame-src https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"});res.end(await fs.readFile(new URL(file,import.meta.url)));return true;}
 if(req.method==='GET'&&url.pathname==='/app/api/trips'){json(res,200,await getTrips());return true;}
 if(req.method==='GET'&&url.pathname==='/app/api/news'){json(res,200,await getNews());return true;}
 if(url.pathname==='/app/api/stations'){await ensureCatalog();json(res,200,{stations:[...catalog,...foreign].sort((a,b)=>a.name.localeCompare(b.name,'nl'))});return true;}
 if(url.pathname.startsWith('/app/api/board/')){const id=decodeURIComponent(url.pathname.split('/').at(-1));let s=foreign.find(s=>s.id===id);if(!s){await ensureCatalog();s=catalog.find(s=>s.id===id);}if(!s){json(res,404,{error:'Station niet gevonden'});return true;}const stored=stations.find(x=>x.id===s.id);const p=stored?await getBoard(stored):await onDemand(s);const now=Date.now();json(res,200,{name:s.name,country:s.country,source:p?.source||'',notice:p?.notice||'',updatedAt:p?.lastScanAt||null,departures:(p?.departures?.all||[]).filter(r=>(r.cancelled?r.plannedTimestamp:r.expectedTimestamp||r.plannedTimestamp)>=now-60000).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp).slice(0,250).map(r=>({number:r.number,category:r.category,to:r.to,time:r.time||r.plannedTime,plannedTimestamp:r.plannedTimestamp,expectedTimestamp:r.expectedTimestamp,track:r.track,delay:r.delay,cancelled:r.cancelled,hasRealtime:r.hasRealtime,route:r.futureRoute||r.futureStops||r.route||[]}))});return true;}
 if(req.method==='POST'&&url.pathname==='/app/api/added'){
 if(req.headers.origin&&new URL(req.headers.origin).host!==url.host){json(res,403,{error:'Niet toegestaan'});return true;}let body='';for await(const b of req){body+=b;if(body.length>512)throw Error('Verzoek te groot');}const {station}=JSON.parse(body);if(![...catalog,...foreign].some(s=>s.id===station)){json(res,400,{error:'Onbekend station'});return true;}
 await recordAppStationAdded(station);json(res,200,{ok:true});return true;
 }
 json(res,404,{error:'Niet gevonden'});
 }catch(e){json(res,503,{error:e.message||'Tijdelijk niet beschikbaar'});}return true;
 };
}
if(!isMainThread&&workerData?.appPlan)parentPort.postMessage(parseDutchPlan(workerData.bytes,[workerData.station],Date.now()));
