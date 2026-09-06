import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initStorage, getStorageInfo, recordObservations, findTrendObservation, getHistory, getLatestByStation } from "./storage.mjs";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
loadDotEnv(path.join(__dirname,".env"));

const PORT=Number(process.env.PORT||8787);
const CLIENT_ID=process.env.DB_CLIENT_ID||"";
const API_KEY=process.env.DB_API_KEY||"";
const BASE="https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1";
const publicDir=path.join(__dirname,"public");
const config=JSON.parse(fs.readFileSync(path.join(__dirname,"config.json"),"utf8"));

const ITALY_BASES=[
  "https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno",
  "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno",
  "https://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno",
  "http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno"
];

const italyJourneyCache=new Map();
let italyState={
  scanning:false,
  lastScanAt:null,
  nextScanAt:null,
  currentIntervalMinutes:null,
  trains:[],
  warnings:[]
};

const stationCache=new Map();
const planCache=new Map();

// Historie-opslag: lokaal SQLite, online PostgreSQL via DATABASE_URL.
let dbState={scanning:false,lastScanAt:null,nextScanAt:null,currentIntervalMinutes:null,trains:[],warnings:[],stations:[]};

function loadDotEnv(filename){
  if(!fs.existsSync(filename)) return;
  for(const raw of fs.readFileSync(filename,"utf8").split(/\r?\n/)){
    const line=raw.trim(); if(!line||line.startsWith("#")) continue;
    const i=line.indexOf("="); if(i<0) continue;
    const key=line.slice(0,i).trim(); let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    if(!(key in process.env)) process.env[key]=value;
  }
}
function sendJson(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(obj));}
function sendFile(res,filename){
  const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8"};
  fs.readFile(filename,(err,data)=>{if(err){res.writeHead(404);return res.end("Not found")}res.writeHead(200,{"Content-Type":types[path.extname(filename).toLowerCase()]||"application/octet-stream","Cache-Control":"no-cache"});res.end(data);});
}
async function dbGet(url){
  const r=await fetch(url,{headers:{"DB-Client-ID":CLIENT_ID,"DB-Api-Key":API_KEY,"Accept":"application/xml,text/xml,*/*"}});
  const text=await r.text(); if(!r.ok) throw new Error(`DB API ${r.status}: ${text.slice(0,500)}`); return text;
}
function decodeXml(v=""){return String(v).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));}
function attrs(tag=""){const out={};const re=/([:\w-]+)\s*=\s*(["'])(.*?)\2/g;let m;while((m=re.exec(tag)))out[m[1]]=decodeXml(m[3]);return out;}
function firstTag(block,name){const m=block.match(new RegExp(`<${name}\\b([^>]*)\\/?\\s*>`,"i"));return m?attrs(m[1]):null;}
function parseStops(xml){const out=[];const re=/<s\b([^>]*)>([\s\S]*?)<\/s>/gi;let m;while((m=re.exec(xml))){const s=attrs(m[1]),body=m[2];out.push({id:s.id||"",eva:s.eva||"",tl:firstTag(body,"tl"),ar:firstTag(body,"ar"),dp:firstTag(body,"dp")});}return out;}
function parseStations(xml){const out=[];const re=/<station\b([^>]*)\/?>/gi;let m;while((m=re.exec(xml))){const a=attrs(m[1]);if(a.eva)out.push({name:a.name||"",eva:String(a.eva),ds100:a.ds100||""});}return out;}
async function resolveStation(pattern){
  if(stationCache.has(pattern)) return stationCache.get(pattern);
  const list=parseStations(await dbGet(`${BASE}/station/${encodeURIComponent(pattern)}`));
  if(!list.length) throw new Error(`Station niet gevonden: ${pattern}`);
  const exact=list.find(s=>s.name.toLowerCase()===pattern.toLowerCase())||list[0];stationCache.set(pattern,exact);return exact;
}
function tzParts(date){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:config.timezone||"Europe/Berlin",year:"2-digit",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const get=t=>parts.find(p=>p.type===t)?.value;return {date:`${get("year")}${get("month")}${get("day")}`,hour:get("hour"),minute:get("minute")};
}
function clockMinutes(s){if(s==="24:00")return 1440;const[h,m]=s.split(":").map(Number);return h*60+m;}
function localMinutes(date){const p=tzParts(date);return Number(p.hour)*60+Number(p.minute);}
function intervalFor(date){const m=localMinutes(date);for(const x of config.scanSchedule){if(m>=clockMinutes(x.from)&&m<clockMinutes(x.to))return Number(x.everyMinutes);}return 60;}
function nextDelay(date){
  const interval=intervalFor(date),p=tzParts(date),minute=Number(p.minute),sec=date.getSeconds(),ms=date.getMilliseconds();
  let add=interval-(minute%interval);if(add===0)add=interval;let aligned=add*60000-sec*1000-ms;
  const nowM=localMinutes(date);let boundary=Infinity;
  for(const x of config.scanSchedule){const b=clockMinutes(x.to);if(b>nowM&&b<1440)boundary=Math.min(boundary,(b-nowM)*60000-sec*1000-ms);}
  if(!Number.isFinite(boundary))boundary=(1440-nowM)*60000-sec*1000-ms;
  return {interval,delay:Math.max(1000,Math.min(aligned,boundary))};
}
async function getPlanWindow(station){
  const all=[],before=Number(config.planHoursBefore||1),after=Number(config.planHoursAfter||2),now=new Date();
  for(let off=-before;off<=after;off++){
    const p=tzParts(new Date(now.getTime()+off*3600000)),key=`${station.eva}-${p.date}-${p.hour}`;
    let cached=planCache.get(key);if(!cached){cached=parseStops(await dbGet(`${BASE}/plan/${station.eva}/${p.date}/${p.hour}`));planCache.set(key,cached);}all.push(...cached);
  }
  return all;
}
async function getChanges(station){return parseStops(await dbGet(`${BASE}/fchg/${station.eva}`));}
function mergeEvent(p,c){if(!p&&!c)return null;return {...(p||{}),...(c||{})};}
function mergeStop(p,c){return {...p,tl:c?.tl||p?.tl||null,ar:mergeEvent(p?.ar,c?.ar),dp:mergeEvent(p?.dp,c?.dp),hasRealtime:Boolean(c)};}
function parseDbTime(s){if(!s||!/^\d{10}$/.test(s))return null;return new Date(2000+Number(s.slice(0,2)),Number(s.slice(2,4))-1,Number(s.slice(4,6)),Number(s.slice(6,8)),Number(s.slice(8,10)),0,0);}
function hhmm(s){const d=parseDbTime(s);return d?new Intl.DateTimeFormat("nl-NL",{hour:"2-digit",minute:"2-digit",hour12:false}).format(d):"--:--";}
function delayMinutes(e){const p=parseDbTime(e?.pt),c=parseDbTime(e?.ct);return p&&c?Math.round((c-p)/60000):0;}
function pathParts(v){return v?v.split("|").map(x=>x.trim()).filter(Boolean):[];}
function routeFor(stop,stationName){const before=pathParts(stop.ar?.cpth||stop.ar?.ppth),after=pathParts(stop.dp?.cpth||stop.dp?.ppth);return {from:before[0]||stationName,to:after.at(-1)||stationName};}
function allowedAtStation(stop,cfg){
  const n=String(stop.tl?.n||"").trim();
  if(!cfg.trainNumbers.includes(n))return false;
  const cat=String(stop.tl?.c||"").toUpperCase().trim();
  const allowed=(config.allowedCategories||[]).map(x=>String(x).toUpperCase());
  return !allowed.length||allowed.includes(cat);
}

function eventModeFor(cfg,number){
  const n=String(number);
  if((cfg.arrivalTrainNumbers||[]).includes(n))return "arrival";
  if((cfg.departureTrainNumbers||[]).includes(n))return "departure";
  return "auto";
}

function resolveEvent(stop,mode){
  if(mode==="arrival")return {event:stop.ar||null,resolvedMode:"arrival"};
  if(mode==="departure")return {event:stop.dp||null,resolvedMode:"departure"};
  if(stop.dp)return {event:stop.dp,resolvedMode:"departure"};
  if(stop.ar)return {event:stop.ar,resolvedMode:"arrival"};
  return {event:null,resolvedMode:"auto"};
}

function normalize(stop,station,cfg){
  const tl=stop.tl||{},
        category=String(tl.c||""),
        number=String(tl.n||""),
        train=[category,number].filter(Boolean).join(" ").trim();

  const configuredMode=eventModeFor(cfg,number);
  const {event,resolvedMode}=resolveEvent(stop,configuredMode);

  // If a train is explicitly configured as arrival/departure and that event
  // is absent at this station, do not silently use the opposite event.
  if(!event||!train)return null;

  const route=routeFor(stop,station.name),
        delay=delayMinutes(event),
        cancelled=event.cs==="c";

  let status="Op tijd",type="ok";
  if(cancelled){
    status="Geannuleerd";type="cancel";
  }else if(delay>=1){
    status=`+${delay} min`;type=delay>30?"major-delay":"delay";
  }else if(delay<=-1){
    status=`${delay} min`;type="info";
  }

  const planned=parseDbTime(event.pt);

  return {
    id:stop.id,
    trainKey:`${category}|${number}`,
    time:hhmm(event.pt),
    plannedTime:hhmm(event.pt),
    currentTime:hhmm(event.ct||event.pt),
    hasChangedTime:Boolean(event.ct && hhmm(event.ct)!==hhmm(event.pt)),
    plannedTimestamp:planned?planned.getTime():0,
    from:route.from,
    to:route.to,
    train,
    category,
    number,
    eventMode:resolvedMode,
    status,
    type,
    delay,
    cancelled,
    observedAt:station.name,
    hasRealtime:Boolean(stop.hasRealtime),
    trend30:null
  };
}

async function scanStation(cfg){
  const station=await resolveStation(cfg.name),
        [planned,changes]=await Promise.all([getPlanWindow(station),getChanges(station)]),
        changeMap=new Map(changes.map(s=>[s.id,s])),
        rows=[],
        planIds=new Set();

  for(const p of planned){
    planIds.add(p.id);
    const m=mergeStop(p,changeMap.get(p.id));
    if(allowedAtStation(m,cfg)){
      const row=normalize(m,station,cfg);
      if(row)rows.push(row);
    }
  }

  for(const c of changes){
    if(planIds.has(c.id)||!allowedAtStation(c,cfg))continue;
    const row=normalize({...c,hasRealtime:true},station,cfg);
    if(row)rows.push(row);
  }

  return {station,rows};
}
function chooseBest(items){const now=Date.now();return [...items].sort((a,b)=>{if(a.hasRealtime!==b.hasRealtime)return a.hasRealtime?-1:1;return Math.abs(a.plannedTimestamp-now)-Math.abs(b.plannedTimestamp-now);})[0];}
async function addTrend30(train,now){
  if(train.cancelled){train.trend30=null;return;}
  const target=now-30*60000,min=now-40*60000,max=now-20*60000;
  const old=await findTrendObservation({
    source:"DB",
    trainKey:train.trainKey,
    station:train.observedAt||"",
    eventMode:train.eventMode||"",
    min,max,target
  });
  if(!old){train.trend30=null;return;}
  const diff=Number(train.delay)-Number(old.delay_minutes);
  train.trend30=diff>=3?"up":diff<=-3?"down":null;
}
async function performScan(){
  if(dbState.scanning)return;
  dbState.scanning=true;
  const all=[],warnings=[],stations=[];
  try{
    for(const cfg of config.stations){
      try{
        const r=await scanStation(cfg);
        stations.push({
          configuredName:cfg.name,
          actualName:r.station.name,
          eva:r.station.eva,
          trainNumbers:cfg.trainNumbers,
          arrivalTrainNumbers:cfg.arrivalTrainNumbers||[],
          departureTrainNumbers:cfg.departureTrainNumbers||[]
        });
        all.push(...r.rows);
      }catch(e){warnings.push(`${cfg.name}: ${e.message}`);}
    }

    const now=Date.now();
    // Bewaar per scanpunt, niet alleen de regel die op het kantoorbord gekozen wordt.
    for(const row of all) await addTrend30(row,now);
    await recordObservations(all,"DB",now);

    const groups=new Map();
    for(const row of all){
      if(!groups.has(row.trainKey))groups.set(row.trainKey,[]);
      groups.get(row.trainKey).push(row);
    }
    const trains=[];
    for(const items of groups.values())trains.push(chooseBest(items));
    trains.sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);

    dbState.trains=trains.slice(0,Number(config.maxTrains||40));
    dbState.warnings=warnings;
    dbState.stations=stations;
    dbState.lastScanAt=new Date(now).toISOString();
    console.log(`[${new Date().toLocaleTimeString()}] DB-scan: ${dbState.trains.length} geselecteerde trein(en), ${all.length} scanpunt-observaties opgeslagen`);
    if(warnings.length)console.log(warnings.join(" | "));
  }finally{dbState.scanning=false;}
}
function scheduleNext(){const {interval,delay}=nextDelay(new Date());dbState.currentIntervalMinutes=interval;dbState.nextScanAt=new Date(Date.now()+delay).toISOString();setTimeout(async()=>{await performScan();scheduleNext();},delay);}


function normalizeStationName(value=""){
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,"");
}

function sameStation(a,b){
  const x=normalizeStationName(a),y=normalizeStationName(b);
  return x===y || x.includes(y) || y.includes(x);
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function italyFetch(pathname,{expectJson=false}={}){
  let lastError=null;

  for(const base of ITALY_BASES){
    try{
      const r=await fetch(`${base}/${pathname}`,{
        headers:{
          "Accept":expectJson?"application/json,text/plain,*/*":"text/plain,*/*",
          "User-Agent":"Treinrondreis-Vertrekbord/1.1"
        },
        signal:AbortSignal.timeout(12000)
      });

      if(r.status===204) return expectJson?null:"";
      const text=await r.text();

      if(!r.ok){
        lastError=new Error(`ViaggiaTreno ${r.status}: ${text.slice(0,160)}`);
        continue;
      }

      if(!expectJson) return text;

      try{return JSON.parse(text);}
      catch(e){
        lastError=new Error(`ViaggiaTreno gaf geen geldige JSON terug.`);
      }
    }catch(e){
      lastError=e;
    }
  }

  throw lastError||new Error("ViaggiaTreno niet bereikbaar.");
}

function parseAutocomplete(text,number){
  const out=[];

  for(const raw of String(text||"").split(/\r?\n/)){
    const line=raw.trim();
    if(!line||!line.includes("|")) continue;

    const [label,value]=line.split("|",2);
    const parts=String(value||"").trim().split("-");
    if(parts.length<2) continue;

    const n=String(parts[0]||number).trim();
    const origin=String(parts[1]||"").trim();
    const midnight=parts.length>=3?String(parts.slice(2).join("-")).trim():"";

    if(origin) out.push({number:n,origin,midnight,label:label.trim()});
  }

  return out;
}

async function fetchItalyTrainDetail(candidate,number){
  const tries=[];

  if(candidate.midnight){
    tries.push(`andamentoTreno/${encodeURIComponent(candidate.origin)}/${encodeURIComponent(number)}/${encodeURIComponent(candidate.midnight)}`);
  }

  tries.push(`andamentoTreno/${encodeURIComponent(candidate.origin)}/${encodeURIComponent(number)}`);

  let last=null;
  for(const p of tries){
    try{
      const data=await italyFetch(p,{expectJson:true});
      if(data) return data;
    }catch(e){last=e;}
  }

  if(last) throw last;
  return null;
}

function findItalyStop(data,station){
  const stops=Array.isArray(data?.fermate)?data.fermate:[];
  return stops.find(s=>sameStation(s?.stazione,station))||null;
}

async function resolveItalyJourney(cfg){
  const dayKey=new Intl.DateTimeFormat("sv-SE",{
    timeZone:"Europe/Rome",
    year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date());

  const key=`${dayKey}|${cfg.number}|${cfg.station}`;
  if(italyJourneyCache.has(key)) return italyJourneyCache.get(key);

  const text=await italyFetch(`cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(cfg.number)}`);
  const candidates=parseAutocomplete(text,cfg.number);

  if(!candidates.length){
    throw new Error(`trein ${cfg.number} niet gevonden`);
  }

  for(const candidate of candidates){
    try{
      const data=await fetchItalyTrainDetail(candidate,cfg.number);
      if(data&&findItalyStop(data,cfg.station)){
        const result={candidate,data};
        italyJourneyCache.set(key,result);
        return result;
      }
    }catch(_){}
    await sleep(80);
  }

  // Als er maar één kandidaat is, bewaren we die ook als het stationveld
  // onverwacht anders gespeld is, zodat we een duidelijke fout kunnen melden.
  if(candidates.length===1){
    const data=await fetchItalyTrainDetail(candidates[0],cfg.number);
    const result={candidate:candidates[0],data};
    italyJourneyCache.set(key,result);
    return result;
  }

  throw new Error(`geen rit van ${cfg.number} via ${cfg.station} gevonden`);
}

function msValue(...values){
  for(const v of values){
    const n=Number(v);
    if(Number.isFinite(n)&&n>0) return n;
  }
  return null;
}

function hhmmMs(value){
  const ms=Number(value);
  if(!Number.isFinite(ms)||ms<=0) return "--:--";
  return new Intl.DateTimeFormat("nl-NL",{
    timeZone:"Europe/Rome",
    hour:"2-digit",minute:"2-digit",hour12:false
  }).format(new Date(ms));
}

function italyEvent(stop,mode){
  if(mode==="arrival"){
    return {
      planned:msValue(stop?.arrivoTeorico,stop?.programmata),
      actual:msValue(stop?.arrivoReale,stop?.effettiva),
      delay:Number(stop?.ritardoArrivo ?? stop?.ritardo ?? 0),
      track:String(
        stop?.binarioEffettivoArrivoDescrizione ??
        stop?.binarioProgrammatoArrivoDescrizione ??
        ""
      ).trim()
    };
  }

  if(mode==="departure"){
    return {
      planned:msValue(stop?.partenzaTeorica,stop?.programmata),
      actual:msValue(stop?.partenzaReale,stop?.effettiva),
      delay:Number(stop?.ritardoPartenza ?? stop?.ritardo ?? 0),
      track:String(
        stop?.binarioEffettivoPartenzaDescrizione ??
        stop?.binarioProgrammatoPartenzaDescrizione ??
        ""
      ).trim()
    };
  }

  // Roma 8508/8509: gebruik vertrek als dat bestaat, anders aankomst.
  const dep=italyEvent(stop,"departure");
  if(dep.planned) return dep;
  return italyEvent(stop,"arrival");
}

function italyCancelled(data,stop){
  if(String(data?.tipoTreno||"").toUpperCase()==="ST") return true;
  if(Number(data?.provvedimento)===1) return true;
  if(Number(stop?.actualFermataType)===3) return true;
  return false;
}

function italyPartial(data,stop){
  if(Number(data?.provvedimento)===2) return true;
  return ["PP","SI","SF"].includes(String(data?.tipoTreno||"").toUpperCase());
}

function italyTrainName(data,number){
  const comp=String(data?.compNumeroTreno||"").trim();
  if(comp) return comp;
  const cat=String(data?.categoriaDescrizione||data?.categoria||"").trim();
  return [cat,number].filter(Boolean).join(" ").trim()||`Treno ${number}`;
}

async function addItalyTrend(train,now){
  if(train.cancelled){train.trend30=null;return;}

  const target=now-30*60000;
  const min=now-40*60000;
  const max=now-20*60000;
  const old=await findTrendObservation({
    source:"ViaggiaTreno",
    trainKey:train.trainKey,
    station:train.station||"",
    eventMode:train.mode||"",
    min,max,target
  });

  if(!old){train.trend30=null;return;}

  const diff=Number(train.delay)-Number(old.delay_minutes);
  train.trend30=diff>=3?"up":diff<=-3?"down":null;
}

async function scanOneItaly(cfg){
  const resolved=await resolveItalyJourney(cfg);
  const data=resolved.data;

  if(!data) throw new Error(`geen detaildata voor ${cfg.number}`);

  const stop=findItalyStop(data,cfg.station);
  if(!stop) throw new Error(`${cfg.station} niet in rit ${cfg.number}`);

  const event=italyEvent(stop,cfg.mode);
  const cancelled=italyCancelled(data,stop);
  const partial=italyPartial(data,stop);

  let delay=Number(event.delay);
  if(!Number.isFinite(delay)) delay=Number(data?.ritardo||0);
  if(!Number.isFinite(delay)) delay=0;

  let status="IN ORARIO";
  let type="ok";

  if(cancelled){
    status="CANCELLATO";
    type="cancel";
  }else if(partial){
    status="PARZ. CANC.";
    type="partial";
  }else if(delay>30){
    status=`+${delay} MIN`;
    type="major-delay";
  }else if(delay>0){
    status=`+${delay} MIN`;
    type="delay";
  }else if(delay<0){
    status=`${delay} MIN`;
    type="info";
  }

  const origin=String(
    data?.origineEstera ||
    data?.origine ||
    data?.origineZero ||
    ""
  ).trim();

  const destination=String(
    data?.destinazioneEstera ||
    data?.destinazione ||
    data?.destinazioneZero ||
    ""
  ).trim();

  const time=hhmmMs(event.planned||event.actual);

  return {
    trainKey:`IT|${cfg.number}|${cfg.station}|${cfg.mode}`,
    number:String(cfg.number),
    train:italyTrainName(data,cfg.number),
    from:origin||"—",
    to:destination||"—",
    station:cfg.station,
    mode:cfg.mode,
    time,
    plannedTimestamp:Number(event.planned||event.actual||0),
    track:event.track||"—",
    delay,
    status,
    type,
    cancelled,
    trend30:null,
    lastDetection:String(data?.stazioneUltimoRilevamento||"").trim(),
    lastDetectionAt:data?.oraUltimoRilevamento||null
  };
}

async function performItalyScan(){
  if(!config.italy?.enabled||italyState.scanning) return;
  italyState.scanning=true;

  const rows=[];
  const warnings=[];

  try{
    for(const cfg of config.italy.trains||[]){
      try{
        rows.push(await scanOneItaly(cfg));
      }catch(e){
        warnings.push(`${cfg.number} (${cfg.station}): ${e.message}`);
      }
      // Rustig aan doen richting de ongedocumenteerde bron.
      await sleep(120);
    }

    rows.sort((a,b)=>(a.plannedTimestamp||0)-(b.plannedTimestamp||0));

    const now=Date.now();
    for(const row of rows) await addItalyTrend(row,now);
    if(rows.length) await recordObservations(rows,"ViaggiaTreno",now);

    italyState.trains=rows;
    italyState.warnings=warnings;
    italyState.lastScanAt=new Date(now).toISOString();

    console.log(
      `[${new Date().toLocaleTimeString()}] Italia-scan: `+
      `${rows.length} geselecteerde trein(en)`
    );

    if(warnings.length) console.log("Italia:",warnings.join(" | "));
  }finally{
    italyState.scanning=false;
  }
}

function scheduleNextItaly(){
  if(!config.italy?.enabled) return;

  const {interval,delay}=nextDelay(new Date());
  italyState.currentIntervalMinutes=interval;
  italyState.nextScanAt=new Date(Date.now()+delay).toISOString();

  setTimeout(async()=>{
    await performItalyScan();
    scheduleNextItaly();
  },delay);
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host}`);
    if(url.pathname==="/api/health")return sendJson(res,200,{ok:true,credentialsConfigured:Boolean(CLIENT_ID&&API_KEY),api:BASE,storage:getStorageInfo(),config,dbState,italyState});
    if(url.pathname==="/api/storage")return sendJson(res,200,getStorageInfo());
    if(url.pathname==="/api/history"){
      const source=url.searchParams.get("source")||undefined;
      const trainNumber=url.searchParams.get("train")||undefined;
      const station=url.searchParams.get("station")||undefined;
      const hours=Number(url.searchParams.get("hours")||24);
      const limit=Number(url.searchParams.get("limit")||500);
      const observations=await getHistory({source,trainNumber,station,hours,limit});
      return sendJson(res,200,{source:source||"all",train:trainNumber||null,station:station||null,hours,count:observations.length,observations});
    }
    if(url.pathname.startsWith("/api/station/")){
      const station=decodeURIComponent(url.pathname.slice("/api/station/".length));
      const source=url.searchParams.get("source")||"DB";
      const hours=Number(url.searchParams.get("hours")||6);
      const limit=Number(url.searchParams.get("limit")||100);
      const observations=await getLatestByStation({station,source,hours,limit});
      return sendJson(res,200,{source,station,count:observations.length,observations});
    }
    if(url.pathname==="/api/italy"){
      if(!italyState.lastScanAt&&!italyState.scanning) await performItalyScan();

      if(!italyState.lastScanAt&&italyState.warnings.length){
        return sendJson(res,503,{
          source:"ViaggiaTreno",
          error:italyState.warnings.join(" | ")
        });
      }

      return sendJson(res,200,{
        source:"ViaggiaTreno",
        lastScanAt:italyState.lastScanAt,
        nextScanAt:italyState.nextScanAt,
        currentIntervalMinutes:italyState.currentIntervalMinutes,
        warnings:italyState.warnings,
        trains:italyState.trains
      });
    }
    if(url.pathname==="/api/trains"){
      if(!dbState.lastScanAt&&!dbState.scanning)await performScan();
      if(!dbState.lastScanAt&&dbState.warnings.length)return sendJson(res,503,{error:dbState.warnings.join(" | ")});
      return sendJson(res,200,{source:"DB Timetables",updatedAt:dbState.lastScanAt,lastScanAt:dbState.lastScanAt,nextScanAt:dbState.nextScanAt,currentIntervalMinutes:dbState.currentIntervalMinutes,warnings:dbState.warnings,stations:dbState.stations,trains:dbState.trains});
    }
    let requested=url.pathname==="/"?"/index.html":url.pathname;requested=path.normalize(requested).replace(/^(\.\.[/\\])+/,"");const filename=path.join(publicDir,requested);if(!filename.startsWith(publicDir)){res.writeHead(403);return res.end("Forbidden")}sendFile(res,filename);
  }catch(e){sendJson(res,500,{error:e.message});}
});
await initStorage();

server.listen(PORT,async()=>{
  const storage=getStorageInfo();
  console.log("");
  console.log("Treinrondreis Live Board v2.0");
  console.log(`Open: http://localhost:${PORT}`);
  console.log(`DB credentials: ${CLIENT_ID&&API_KEY?"ingesteld":"ONTBREKEN"}`);
  console.log(`Historie: ${storage.backend} (${storage.historyDays} dagen)`);
  console.log("");
  for(const st of config.stations)console.log(` - ${st.name}: ${st.trainNumbers.join(", ")}`);
  console.log("");
  await Promise.allSettled([performScan(),performItalyScan()]);
  scheduleNext();
  scheduleNextItaly();
});
