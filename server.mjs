import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initStorage,getStorageInfo,recordObservations,findTrendObservation,
  getHistory,getLatestByStation,getLatestForPlannedWindow,
  startLegacyMigration,getDataHubMigrationState,getDataSources,getDataHubStats,
  getServiceRuns,getCanonicalEvents,getCombinedTrain
} from "./storage.mjs";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
loadDotEnv(path.join(__dirname,".env"));

const PORT=Number(process.env.PORT||8787);
const CLIENT_ID=process.env.DB_CLIENT_ID||"";
const API_KEY=process.env.DB_API_KEY||"";
const BASE="https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1";
const publicDir=path.join(__dirname,"public");
const config=JSON.parse(fs.readFileSync(path.join(__dirname,"config.json"),"utf8"));
const FERNVERKEHR_CATEGORIES=new Set(
  (config.fernverkehrCategories||["ICE","IC","EC","ECE","TGV","RJ","RJX","NJ","EN","D","WB","WEST","FLX"])
    .map(x=>String(x).toUpperCase().trim())
);
function isFernverkehrCategory(category=""){
  return FERNVERKEHR_CATEGORIES.has(String(category).toUpperCase().trim());
}

const ITALY_BASES=[
  "https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno",
  "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno",
  "https://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno",
  "http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno"
];

const italyJourneyCache=new Map();
const stationCache=new Map();
const planCache=new Map();

let italyState={scanning:false,lastScanAt:null,nextScanAt:null,currentIntervalMinutes:null,trains:[],warnings:[]};
let dbState={scanning:false,lastScanAt:null,nextScanAt:null,currentIntervalMinutes:null,trains:[],warnings:[],stations:[]};
let collectorState={lastScanAt:null,byStation:{},warnings:[]};
let nightjetPlanState={scanning:false,dateKey:null,lastUpdatedAt:null,rows:[],warnings:[]};

function loadDotEnv(filename){
  if(!fs.existsSync(filename)) return;
  for(const raw of fs.readFileSync(filename,"utf8").split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith("#"))continue;
    const i=line.indexOf("=");if(i<0)continue;
    const key=line.slice(0,i).trim();let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    if(!(key in process.env))process.env[key]=value;
  }
}
function sendJson(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(obj));}
function sendFile(res,filename){
  const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml"};
  fs.readFile(filename,(err,data)=>{
    if(err){res.writeHead(404);return res.end("Not found");}

    // V4.1.3: vertraging >30 min moet op zowel groot als mobiel bord
    // altijd rood blijven, ongeacht oudere CSS-cascade/caching.
    if(path.extname(filename).toLowerCase()===".css"){
      const base=path.basename(filename).toLowerCase();
      if(base==="styles.css"||base==="mobile.css"){
        data=Buffer.concat([data,Buffer.from(`
/* v4.1.3 delay-color guard */
.db-status.major-delay,.m-status.major-delay{color:#c92828!important;}
`)]);
      }
    }

    res.writeHead(200,{"Content-Type":types[path.extname(filename).toLowerCase()]||"application/octet-stream","Cache-Control":"no-cache"});
    res.end(data);
  });
}
let dbRequestQueue=Promise.resolve();
let dbLastRequestStartedAt=0;

async function dbGet(url){
  // Met meer scanstations kan een eerste scan veel /station- en /plan-calls
  // veroorzaken. Serializeer alle DB-calls en houd standaard minimaal
  // 1250 ms tussen starts (~48 requests/min), ruim onder de gratis 60/min.
  let releaseQueue;
  const previous=dbRequestQueue;
  dbRequestQueue=new Promise(resolve=>{releaseQueue=resolve;});
  await previous;

  try{
    const minInterval=Math.max(
      1000,
      Number(process.env.DB_REQUEST_MIN_INTERVAL_MS||config.dbRequestMinIntervalMs||1250)
    );
    const wait=Math.max(0,minInterval-(Date.now()-dbLastRequestStartedAt));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    dbLastRequestStartedAt=Date.now();

    const r=await fetch(url,{
      headers:{
        "DB-Client-ID":CLIENT_ID,
        "DB-Api-Key":API_KEY,
        "Accept":"application/xml,text/xml,*/*"
      }
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`DB API ${r.status}: ${text.slice(0,500)}`);
    return text;
  }finally{
    releaseQueue();
  }
}
function decodeXml(v=""){return String(v).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));}
function attrs(tag=""){const out={};const re=/([:\w-]+)\s*=\s*(["'])(.*?)\2/g;let m;while((m=re.exec(tag)))out[m[1]]=decodeXml(m[3]);return out;}
function firstTag(block,name){const m=block.match(new RegExp(`<${name}\\b([^>]*)\\/?\\s*>`,"i"));return m?attrs(m[1]):null;}
function parseStops(xml){const out=[];const re=/<s\b([^>]*)>([\s\S]*?)<\/s>/gi;let m;while((m=re.exec(xml))){const s=attrs(m[1]),body=m[2];out.push({id:s.id||"",eva:s.eva||"",tl:firstTag(body,"tl"),ar:firstTag(body,"ar"),dp:firstTag(body,"dp")});}return out;}
function parseStations(xml){const out=[];const re=/<station\b([^>]*)\/?>/gi;let m;while((m=re.exec(xml))){const a=attrs(m[1]);if(a.eva)out.push({name:a.name||"",eva:String(a.eva),ds100:a.ds100||""});}return out;}
async function resolveStation(pattern){
  if(stationCache.has(pattern))return stationCache.get(pattern);
  const configured=[...(config.collectors||[]),...(config.stations||[])].find(x=>x.name===pattern&&x.eva);
  if(configured){const station={name:pattern,eva:String(configured.eva)};stationCache.set(pattern,station);return station;}
  const list=parseStations(await dbGet(`${BASE}/station/${encodeURIComponent(pattern)}`));
  if(!list.length)throw new Error(`Station niet gevonden: ${pattern}`);
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
async function getPlanHour(station,dateKey,hour){
  const hh=String(hour).padStart(2,"0"),key=`${station.eva}-${dateKey}-${hh}`;
  let cached=planCache.get(key);
  if(!cached){cached=parseStops(await dbGet(`${BASE}/plan/${station.eva}/${dateKey}/${hh}`));planCache.set(key,cached);}
  return cached;
}
async function getPlanWindow(station,{before,after}={}){
  const all=[],
        windowBefore=Number(before??config.planHoursBefore??1),
        windowAfter=Number(after??config.planHoursAfter??2),
        now=new Date();

  for(let off=-windowBefore;off<=windowAfter;off++){
    const p=tzParts(new Date(now.getTime()+off*3600000));
    all.push(...await getPlanHour(station,p.date,p.hour));
  }
  return all;
}
async function getChanges(station){return parseStops(await dbGet(`${BASE}/fchg/${station.eva}`));}
function mergeEvent(p,c){if(!p&&!c)return null;return {...(p||{}),...(c||{})};}
function mergeStop(p,c){return {...p,tl:c?.tl||p?.tl||null,ar:mergeEvent(p?.ar,c?.ar),dp:mergeEvent(p?.dp,c?.dp),hasRealtime:Boolean(c)};}

const DB_TIME_ZONE="Europe/Berlin";
function timeZoneOffsetMs(date,timeZone){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const v={};for(const p of parts){if(p.type!=="literal")v[p.type]=p.value;}
  return Date.UTC(Number(v.year),Number(v.month)-1,Number(v.day),Number(v.hour),Number(v.minute),Number(v.second))-date.getTime();
}
function parseDbTime(s){
  if(!s||!/^\d{10}$/.test(s))return null;
  const year=2000+Number(s.slice(0,2)),month=Number(s.slice(2,4))-1,day=Number(s.slice(4,6)),hour=Number(s.slice(6,8)),minute=Number(s.slice(8,10));
  const localAsUtc=Date.UTC(year,month,day,hour,minute,0,0);let instant=localAsUtc;
  for(let i=0;i<2;i++)instant=localAsUtc-timeZoneOffsetMs(new Date(instant),DB_TIME_ZONE);
  return new Date(instant);
}
function hhmm(s){const d=parseDbTime(s);return d?new Intl.DateTimeFormat("nl-NL",{timeZone:DB_TIME_ZONE,hour:"2-digit",minute:"2-digit",hour12:false}).format(d):"--:--";}
function delayMinutes(e){const p=parseDbTime(e?.pt),c=parseDbTime(e?.ct);return p&&c?Math.round((c-p)/60000):0;}
function pathParts(v){return v?v.split("|").map(x=>x.trim()).filter(Boolean):[];}
function uniqueRoute(parts){const out=[];for(const p of parts){if(!out.length||normalizeStationName(out.at(-1))!==normalizeStationName(p))out.push(p);}return out;}
function routeFor(stop,stationName){
  const before=pathParts(stop.ar?.cpth||stop.ar?.ppth),
        after=pathParts(stop.dp?.cpth||stop.dp?.ppth);
  const route=uniqueRoute([...before,stationName,...after]);
  return {
    from:before[0]||stationName,
    to:after.at(-1)||stationName,
    route,
    pastRoute:uniqueRoute(before),
    futureRoute:uniqueRoute(after)
  };
}
function selectorAllows(stop,cfg){
  const n=String(stop.tl?.n||"").trim(),
        cat=String(stop.tl?.c||"").toUpperCase().trim();

  if(cfg.allEvents){
    if((!stop.dp&&!stop.ar)||!n)return false;
    const cats=(cfg.categories||[]).map(x=>String(x).toUpperCase()),
          nums=(cfg.trainNumbers||[]).map(String);
    if(!cats.length&&!nums.length)return true;
    return cats.includes(cat)||nums.includes(n);
  }

  if(cfg.allDepartures){
    if(!stop.dp||!n)return false;
    const cats=(cfg.categories||[]).map(x=>String(x).toUpperCase());
    return !cats.length||cats.includes(cat);
  }

  if(!(cfg.trainNumbers||[]).includes(n))return false;
  const cats=(cfg.categories||config.allowedCategories||[]).map(x=>String(x).toUpperCase());
  return !cats.length||cats.includes(cat);
}
function eventModeFor(cfg,number){
  const n=String(number);
  if(cfg.allDepartures)return "departure";
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
function dbServiceDateFromStopId(id="") {
  const m=String(id).match(/-(\d{2})(\d{2})(\d{2})\d{4}-\d+$/);
  return m?`20${m[1]}-${m[2]}-${m[3]}`:"";
}
function countryForStation(name="") {
  const n=String(name);
  if(["Arnhem Centraal","Deventer","Utrecht Centraal","Amersfoort Centraal","Amsterdam Centraal"].some(x=>n===x))return "NL";
  if(["Wien Hbf","Innsbruck Hbf"].some(x=>n===x))return "AT";
  if(n==="Basel Bad Bf")return "CH";
  if([
    "Mannheim Hbf","Köln Hbf","Berlin Hbf","Bad Bentheim","Düsseldorf Hbf",
    "Hamburg Hbf","Hannover Hbf","Frankfurt(Main)Hbf","Frankfurt(M) Flughafen Fernbf",
    "Stuttgart Hbf","München Hbf","Osnabrück Hbf","Offenburg","Nürnberg Hbf","Berlin Hbf (tief)"
  ].some(x=>n===x))return "DE";
  return "";
}
function normalize(stop,station,cfg){
  const tl=stop.tl||{},category=String(tl.c||""),number=String(tl.n||""),train=[category,number].filter(Boolean).join(" ").trim();
  const configuredMode=eventModeFor(cfg,number),{event,resolvedMode}=resolveEvent(stop,configuredMode);
  if(!event||!train)return null;
  const route=routeFor(stop,station.name),delay=delayMinutes(event),cancelled=event.cs==="c";
  let status="Op tijd",type="ok";
  if(cancelled){status="Geannuleerd";type="cancel";}
  else if(delay>=1){status=`+${delay} min`;type=delay>30?"major-delay":"delay";}
  else if(delay<=-1){status=`${delay} min`;type="info";}
  const planned=parseDbTime(event.pt),expected=parseDbTime(event.ct||event.pt);
  const plannedTrack=String(event.pp||"").trim(),currentTrack=String(event.cp||event.pp||"").trim();
  return {
    id:stop.id,sourceTripId:`${category}|${number}`,sourceEventId:stop.id,serviceDate:dbServiceDateFromStopId(stop.id),
    trainKey:`${category}|${number}`,time:hhmm(event.pt),plannedTime:hhmm(event.pt),currentTime:hhmm(event.ct||event.pt),
    hasChangedTime:Boolean(event.ct&&hhmm(event.ct)!==hhmm(event.pt)),expectedTimestamp:expected?.getTime()||0,plannedTimestamp:planned?.getTime()||0,
    actualTimestamp:null,from:route.from,to:route.to,route:route.route,pastRoute:route.pastRoute,futureRoute:route.futureRoute,
    train,category,number,operatorCode:String(tl.o||""),eventMode:resolvedMode,status,type,delay,cancelled,
    observedAt:station.name,stationCode:String(station.eva||""),countryCode:countryForStation(station.name),
    hasRealtime:Boolean(stop.hasRealtime),plannedTrack,currentTrack,track:currentTrack||plannedTrack||"—",
    hasChangedTrack:Boolean(currentTrack&&plannedTrack&&currentTrack!==plannedTrack),trend30:null,rawStop:stop
  };
}
function rowsForSelector(stops,station,cfg){
  const rows=[];
  for(const stop of stops){if(selectorAllows(stop,cfg)){const row=normalize(stop,station,cfg);if(row)rows.push(row);}}
  return rows;
}
async function fetchMergedStation(name,windowCfg={}){
  const station=await resolveStation(name),
        [planned,changes]=await Promise.all([getPlanWindow(station,windowCfg),getChanges(station)]),
        changeMap=new Map(changes.map(s=>[s.id,s])),rows=[],planIds=new Set();
  for(const p of planned){planIds.add(p.id);rows.push(mergeStop(p,changeMap.get(p.id)));}
  for(const c of changes){if(!planIds.has(c.id))rows.push({...c,hasRealtime:true});}
  return {station,stops:rows};
}
function dedupeRows(rows){
  const map=new Map();
  for(const r of rows){const key=`${r.id}|${r.observedAt}|${r.eventMode}|${r.number}`;const old=map.get(key);if(!old||(!old.hasRealtime&&r.hasRealtime))map.set(key,r);}
  return [...map.values()];
}
// Passenger displays exclude charter trains, FlixTrain and WESTbahn.
// Apply this only after collection/storage so observations remain complete.
function isPassengerBoardTrain(row){
  const category=String(row.category||"").toUpperCase().replace(/[\s_-]+/g,"");
  return !["DZ","FLX","FLIXTRAIN","WB","WEST","WESTBAHN"].includes(category);
}

function visibleOnBoard(row,now){
  if(!isPassengerBoardTrain(row))return false;
  const normalRetentionMs=90*60*1000,cancelledRetentionMs=6*60*60*1000;
  if(row.cancelled){const p=Number(row.plannedTimestamp||0);return !p||now<=p+cancelledRetentionMs;}
  const e=Number(row.expectedTimestamp||row.plannedTimestamp||0);return !e||now<=e+normalRetentionMs;
}
function chooseBest(items){
  const now=Date.now();return [...items].sort((a,b)=>{
    const at=Number(a.expectedTimestamp||a.plannedTimestamp||0),bt=Number(b.expectedTimestamp||b.plannedTimestamp||0);
    const ad=at?Math.abs(at-now):Number.MAX_SAFE_INTEGER,bd=bt?Math.abs(bt-now):Number.MAX_SAFE_INTEGER;
    if(ad!==bd)return ad-bd;if(a.hasRealtime!==b.hasRealtime)return a.hasRealtime?-1:1;return Number(a.plannedTimestamp||0)-Number(b.plannedTimestamp||0);
  })[0];
}

function naturalTrainNumberSort(a,b){
  const an=Number(a),bn=Number(b);
  if(Number.isFinite(an)&&Number.isFinite(bn)&&an!==bn)return an-bn;
  return String(a).localeCompare(String(b),"nl",{numeric:true,sensitivity:"base"});
}
function boardMergeKey(row){
  if((row.eventMode||row.mode)!=="departure")return null;
  const station=normalizeStationName(row.observedAt||row.station||"");
  const planned=Number(row.plannedTimestamp||0);
  const destination=normalizeStationName(row.to||"");
  const track=String(row.track||"").trim().toUpperCase();
  // Missing times, destinations or tracks are not evidence of a shared departure.
  if(!station||!Number.isFinite(planned)||planned<=0||!destination||["","—","-","?"].includes(track))return null;
  return [station,Math.floor(planned/60000),destination,track].join("|");
}
function isFernverkehrRow(row){
  return (row.mergedServices||[row]).some(service=>isFernverkehrCategory(service.category));
}
function mergeEquivalentBoardTrains(rows){
  const buckets=new Map(),result=[];
  for(const input of rows){
    const row={...input};
    if(!row.cancelled&&Number(row.delay||0)>30)row.type="major-delay";
    const key=boardMergeKey(row);
    if(!key){result.push(row);continue;}
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(row);
  }
  for(const items of buckets.values()){
    if(items.length===1){result.push(items[0]);continue;}
    const members=items.flatMap(row=>row.mergedServices||[row]);
    const active=members.filter(row=>!row.cancelled);
    const first=[...(active.length?active:members)].sort((a,b)=>
      Number(b.delay||0)-Number(a.delay||0)||Number(Boolean(b.hasRealtime))-Number(Boolean(a.hasRealtime))
    )[0];
    const byCategory=new Map();
    for(const row of members){
      const category=String(row.category||"").trim();
      if(!byCategory.has(category))byCategory.set(category,new Set());
      for(const n of row.trainNumbers||[row.number]){
        const number=String(n||"").trim();if(number)byCategory.get(category).add(number);
      }
    }
    const labels=[...byCategory].sort(([a],[b])=>a.localeCompare(b)).map(([category,numbers])=>
      [category,[...numbers].sort(naturalTrainNumberSort).join(" / ")].filter(Boolean).join(" ")
    );
    const numbers=[...new Set([...byCategory.values()].flatMap(set=>[...set]))].sort(naturalTrainNumberSort);
    const cancelled=active.length===0;
    const partialCancellation=active.length>0&&active.length<members.length;
    const delay=Number(first.delay||0);
    const type=cancelled?"cancel":delay>30?"major-delay":partialCancellation?"delay":first.type;
    const status=cancelled?"Geannuleerd":partialCancellation
      ?`Deels geannuleerd${delay>0?` · +${delay} min`:""}`:first.status;
    result.push({
      ...first,cancelled,partialCancellation,type,status,
      merged:true,mergedCount:[...byCategory.values()].reduce((n,set)=>n+set.size,0),
      trainNumbers:numbers,train:labels.join(" / "),number:numbers.join(" / "),
      mergedTrainKeys:[...new Set(members.map(row=>row.trainKey).filter(Boolean))],
      // Retain per-service categories and routes for direction filters after merging.
      mergedServices:members.map(({rawStop,mergedServices,...row})=>row)
    });
  }
  return result.sort((a,b)=>{
    const at=Number(a.plannedTimestamp||0),bt=Number(b.plannedTimestamp||0);
    if(at!==bt)return at-bt;
    return String(a.train||"").localeCompare(String(b.train||""),"nl",{numeric:true,sensitivity:"base"});
  });
}
async function addTrend30(train,now){
  if(train.cancelled){train.trend30=null;return;}
  const target=now-30*60000,min=now-40*60000,max=now-20*60000;
  const old=await findTrendObservation({source:"DB",trainKey:train.trainKey,station:train.observedAt||"",eventMode:train.eventMode||"",min,max,target});
  if(!old){train.trend30=null;return;}
  const diff=Number(train.delay)-Number(old.delay_minutes);train.trend30=diff>=3?"up":diff<=-3?"down":null;
}
function selectorsForStation(name,list){return (list||[]).filter(x=>x.name===name);}
function monitoredStationNames(){return [...new Set([...(config.stations||[]),...(config.collectors||[])].map(x=>x.name))];}

async function performScan(){
  if(dbState.scanning)return;dbState.scanning=true;
  const boardRows=[],collectorRows=[],warnings=[],stations=[],collectorByStation={...collectorState.byStation};
  try{
    for(const name of monitoredStationNames()){
      try{
        const boardSelectors=selectorsForStation(name,config.stations),
              collectorSelectors=selectorsForStation(name,config.collectors),
              allSelectors=[...boardSelectors,...collectorSelectors],
              windowBefore=Math.max(
                Number(config.planHoursBefore||1),
                ...allSelectors.map(x=>Number(x.planHoursBefore||0))
              ),
              windowAfter=Math.max(
                Number(config.planHoursAfter||2),
                ...allSelectors.map(x=>Number(x.planHoursAfter||0))
              ),
              fetched=await fetchMergedStation(name,{before:windowBefore,after:windowAfter});

        for(const cfg of boardSelectors){
          boardRows.push(...rowsForSelector(fetched.stops,fetched.station,cfg));
        }

        const cRows=[];
        for(const cfg of collectorSelectors){
          cRows.push(...rowsForSelector(fetched.stops,fetched.station,cfg));
        }

        // Extra realtime Nightjet/EuroNight-collectie op ieder station dat we
        // toch al scannen. Dit verandert het hoofdbord niet en kost geen
        // extra station-call.
        const nightjetRealtimeSelector={
          allEvents:true,
          categories:config.nightjet?.categories||["NJ","EN"],
          trainNumbers:config.nightjet?.numbers||[]
        };
        cRows.push(...rowsForSelector(fetched.stops,fetched.station,nightjetRealtimeSelector));

        collectorByStation[name]=dedupeRows(cRows)
          .sort((a,b)=>(a.plannedTimestamp||0)-(b.plannedTimestamp||0));
        collectorRows.push(...collectorByStation[name]);
        collectorState.byStation[name]=collectorByStation[name];

        stations.push({
          configuredName:name,
          actualName:fetched.station.name,
          eva:fetched.station.eva,
          boardSelectors:boardSelectors.length,
          collectorSelectors:collectorSelectors.map(c=>c.id||"collector")
        });
      }catch(e){warnings.push(`${name}: ${e.message}`);}
    }

    const now=Date.now(),all=dedupeRows([...boardRows,...collectorRows]);
    for(const row of all)await addTrend30(row,now);
    await recordObservations(all,"DB",now);

    const displayRows=dedupeRows(boardRows).filter(row=>visibleOnBoard(row,now));
    const groups=new Map();
    for(const row of displayRows){const key=String(row.number||"").trim();if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    const selected=[];
    for(const items of groups.values())selected.push(chooseBest(items));

    // V4.1.3: dezelfde fysieke vertrekbeweging met meerdere treinnummers
    // wordt één bordregel. Opslag blijft volledig: alle individuele nummers
    // zijn hierboven al afzonderlijk naar de Data Hub geschreven.
    const trains=mergeEquivalentBoardTrains(selected);

    dbState.trains=trains.slice(0,Number(config.maxTrains||60));dbState.warnings=warnings;dbState.stations=stations;dbState.lastScanAt=new Date(now).toISOString();
    collectorState={lastScanAt:dbState.lastScanAt,byStation:collectorByStation,warnings};
    console.log(`[${new Date().toLocaleTimeString()}] DB-scan: ${dbState.trains.length} op hoofdbord, ${all.length} observaties opgeslagen`);
    if(warnings.length)console.log(warnings.join(" | "));
  }finally{dbState.scanning=false;}
}
function scheduleNext(){const {interval,delay}=nextDelay(new Date());dbState.currentIntervalMinutes=interval;dbState.nextScanAt=new Date(Date.now()+delay).toISOString();setTimeout(async()=>{await performScan();scheduleNext();},delay);}

function normalizeStationName(value=""){return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
function sameStation(a,b){
  const words=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
  const x=words(a),y=words(b);
  return Boolean(x&&y)&&(x===y||x.startsWith(y+" ")||y.startsWith(x+" "));
}
function routeContains(row,names){
  const route=Array.isArray(row.route)?row.route:[row.from,row.to];
  return route.some(s=>names.some(n=>sameStation(s,n)));
}
function futureRouteContains(row,names){
  const route=Array.isArray(row.futureRoute)&&row.futureRoute.length
    ? row.futureRoute
    : [row.to];
  return route.some(s=>names.some(n=>sameStation(s,n)));
}
function currentCollectorRows(station){
  return (collectorState.byStation[station]||[])
    .filter(r=>visibleOnBoard(r,Date.now()))
    .sort((a,b)=>(a.expectedTimestamp||a.plannedTimestamp||0)-(b.expectedTimestamp||b.plannedTimestamp||0));
}

function stationUpcomingDepartures(station){
  const now=Date.now(),graceMs=10*60*1000;

  const stations=Array.isArray(station)?station:[station];
  const rows=stations.flatMap(name=>collectorState.byStation[name]||[])
    .map(row=>stations.length>1?{...row,observedAt:stations[0]}:row)
    .filter(isPassengerBoardTrain)
    .filter(r=>r.eventMode==="departure")
    .filter(r=>{
      if(r.cancelled){
        const planned=Number(r.plannedTimestamp||0);
        return !planned||planned>=now-graceMs;
      }
      const expected=Number(r.expectedTimestamp||r.plannedTimestamp||0);
      return !expected||expected>=now-graceMs;
    });

  return mergeEquivalentBoardTrains(rows).sort((a,b)=>{
    const at=Number(a.plannedTimestamp||0),bt=Number(b.plannedTimestamp||0);
    if(at!==bt)return at-bt;
    return String(a.train||"").localeCompare(String(b.train||""),"nl",{numeric:true});
  });
}

function stationDirectionMatches(row,direction){
  if(row.mergedServices)return row.mergedServices.some(service=>stationDirectionMatches(service,direction));
  const normalizeCategory=value=>String(value||"").toUpperCase().replace(/[\s_-]+/g,"");
  const categories=direction.categories||[];
  const stops=direction.futureStops||[];
  const category=normalizeCategory(row.category);
  const internationalIC=direction.internationalIC&&category==="IC"&&routeContains(row,["Bad Bentheim","Berlin Hbf","Hannover Hbf","Osnabrück Hbf"]);
  if(direction.serviceBrand==="regiojet")return ["REGIOJET","RJI"].includes(category)||/REGIOJET/i.test(row.operatorName||row.operatorCode||"")||String(row.operatorCode)==="3247";
  if(direction.regionalOnly&&isFernverkehrCategory(row.category))return false;
  if(!categories.length&&!stops.length&&!direction.internationalIC)return false;
  if(categories.length&&!categories.some(c=>normalizeCategory(c)===category)&&!internationalIC)return false;
  return !stops.length||futureRouteContains(row,stops);
}

function stationQuickDirections(pageCfg,rows){
  return (pageCfg.quickDirections||[]).map(direction=>{
    const matches=rows
      .filter(r=>stationDirectionMatches(r,direction))
      .slice(0,8);

    return {
      id:direction.id,
      label:direction.label,
      count:matches.length,
      trains:matches
    };
  });
}

function stationPagePayload(pageId){
  const pageCfg=config.stationPages?.[pageId];
  if(!pageCfg)return null;

  const rows=stationUpcomingDepartures(pageCfg.stations||pageCfg.station);

  return {
    source:"DB Timetables",
    page:pageId,
    station:pageCfg.station,
    title:pageCfg.title,
    country:pageCfg.country,
    lastScanAt:collectorState.lastScanAt,
    quick:stationQuickDirections(pageCfg,rows),
    departures:{
      all:rows,
      fernverkehr:rows.filter(isFernverkehrRow),
      regional:rows.filter(r=>!isFernverkehrRow(r))
    }
  };
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

// -------- Volledige dagplanning voor Nightjet/EuroNight --------
function nextDateKey(dateKey){
  const y=2000+Number(dateKey.slice(0,2)),m=Number(dateKey.slice(2,4))-1,d=Number(dateKey.slice(4,6));
  const x=new Date(Date.UTC(y,m,d+1));return `${String(x.getUTCFullYear()).slice(-2)}${String(x.getUTCMonth()+1).padStart(2,'0')}${String(x.getUTCDate()).padStart(2,'0')}`;
}
function localDayBounds(dateKey){return {start:parseDbTime(`${dateKey}0000`).getTime(),end:parseDbTime(`${nextDateKey(dateKey)}0000`).getTime()};}
function explicitModeForStationTrain(stationName,number,stop){
  for(const cfg of config.stations||[]){if(cfg.name!==stationName)continue;if((cfg.arrivalTrainNumbers||[]).includes(String(number)))return "arrival";if((cfg.departureTrainNumbers||[]).includes(String(number)))return "departure";}
  return stop.dp?"departure":"arrival";
}
function nightjetTarget(stop){
  const cat=String(stop.tl?.c||"").toUpperCase(),num=String(stop.tl?.n||"");
  return (config.nightjet?.categories||[]).map(x=>String(x).toUpperCase()).includes(cat)||(config.nightjet?.numbers||[]).map(String).includes(num);
}
async function performNightjetDayPlan(){
  if(nightjetPlanState.scanning)return;nightjetPlanState.scanning=true;
  const dateKey=tzParts(new Date()).date,rows=[],warnings=[];
  try{
    for(const name of monitoredStationNames()){
      try{
        const station=await resolveStation(name);
        for(let h=0;h<24;h++){
          const stops=await getPlanHour(station,dateKey,h);
          for(const stop of stops){
            if(!nightjetTarget(stop))continue;
            const num=String(stop.tl?.n||""),mode=explicitModeForStationTrain(name,num,stop);
            const cfg={name,trainNumbers:[num],arrivalTrainNumbers:mode==="arrival"?[num]:[],departureTrainNumbers:mode==="departure"?[num]:[]};
            const row=normalize(stop,station,cfg);if(row)rows.push(row);
          }
          await sleep(Number(config.nightjet?.prefetchDelayMs||1500));
        }
      }catch(e){warnings.push(`${name}: ${e.message}`);}
    }
    const clean=dedupeRows(rows);
    nightjetPlanState={scanning:false,dateKey,lastUpdatedAt:new Date().toISOString(),rows:clean,warnings};
    // Plan-snapshot ook bewaren; realtime DB-observaties blijven aparte source DB.
    if(clean.length)await recordObservations(clean,"DB_PLAN",Date.now());
    console.log(`[${new Date().toLocaleTimeString()}] Dagplan Nightjet: ${clean.length} regels voor ${dateKey}`);
  }catch(e){nightjetPlanState.warnings=[e.message];nightjetPlanState.scanning=false;}
}
function scheduleNightjetDayCheck(){
  setInterval(()=>{const key=tzParts(new Date()).date;if(key!==nightjetPlanState.dateKey&&!nightjetPlanState.scanning)performNightjetDayPlan();},15*60*1000);
}
function historyRowToTrain(r){
  let route=r.route;if(typeof route==="string"){try{route=JSON.parse(route);}catch{route=[];}}
  return {
    trainKey:r.train_key,number:String(r.train_number||""),category:String(r.category||""),train:[r.category,r.train_number].filter(Boolean).join(" "),
    observedAt:r.station,eventMode:r.event_mode,station:r.station,plannedTimestamp:Number(r.planned_timestamp||0),expectedTimestamp:Number(r.expected_timestamp||0)||Number(r.planned_timestamp||0)+Number(r.delay_minutes||0)*60000,
    plannedTime:r.planned_time,currentTime:r.current_time||r.planned_time,delay:Number(r.delay_minutes||0),status:r.status||"",cancelled:Boolean(r.cancelled),
    from:r.origin||"—",to:r.destination||"—",track:r.current_track||r.track||r.planned_track||"—",plannedTrack:r.planned_track||"",currentTrack:r.current_track||r.track||"",route:Array.isArray(route)?route:[],hasRealtime:true
  };
}
async function getNightjetView(){
  const dateKey=tzParts(new Date()).date,{start,end}=localDayBounds(dateKey),cats=config.nightjet?.categories||[],nums=config.nightjet?.numbers||[];
  const history=(await getLatestForPlannedWindow({source:"DB",start,end,categories:cats,trainNumbers:nums,limit:5000})).map(historyRowToTrain);
  const planned=nightjetPlanState.dateKey===dateKey?nightjetPlanState.rows:[];
  const candidates=[...planned,...history].filter(isPassengerBoardTrain);
  const groups=new Map();
  for(const r of candidates){if(!nightjetTarget({tl:{c:r.category,n:r.number}}))continue;const key=String(r.number||"");if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const trains=[];for(const items of groups.values())trains.push(chooseBest(items));trains.sort((a,b)=>(a.plannedTimestamp||0)-(b.plannedTimestamp||0));
  return {dateKey,trains:mergeEquivalentBoardTrains(trains),planReady:nightjetPlanState.dateKey===dateKey&&!nightjetPlanState.scanning,planScanning:nightjetPlanState.scanning,planUpdatedAt:nightjetPlanState.lastUpdatedAt,warnings:nightjetPlanState.warnings};
}

// -------- ViaggiaTreno --------
async function italyFetch(pathname,{expectJson=false}={}){
  let lastError=null;for(const base of ITALY_BASES){try{
    const r=await fetch(`${base}/${pathname}`,{headers:{"Accept":expectJson?"application/json,text/plain,*/*":"text/plain,*/*","User-Agent":"Treinrondreis-Vertrekbord/3.0"},signal:AbortSignal.timeout(12000)});
    if(r.status===204)return expectJson?null:"";const text=await r.text();if(!r.ok){lastError=new Error(`ViaggiaTreno ${r.status}: ${text.slice(0,160)}`);continue;}
    if(!expectJson)return text;try{return JSON.parse(text);}catch{lastError=new Error("ViaggiaTreno gaf geen geldige JSON terug.");}
  }catch(e){lastError=e;}}throw lastError||new Error("ViaggiaTreno niet bereikbaar");
}
function parseAutocomplete(text){
  const out=[];for(const raw of String(text||"").split(/\r?\n/)){const line=raw.trim();if(!line)continue;const m=line.match(/^(.*?)\|(.*)$/);if(m)out.push({label:m[1],value:m[2]});else out.push({label:line,value:line});}return out;
}
function italyCandidateInfo(item,number){
  const value=String(item?.value||item?.label||"").trim();

  // ViaggiaTreno autocomplete gebruikt o.a.:
  // 666-S06000-1753135200000
  // dus: treinNummer - stationCode - vertrekdagTimestamp.
  //
  // De oude parser pakte per ongeluk het eerste getal ("666") als
  // origin station, waardoor andamentoTreno vrijwel altijd 204 teruggaf.
  const stationMatch=value.match(/(?:^|[-|])(S\d{5})(?=[-|]|$)/i)
                    || value.match(/\b(S\d{5})\b/i);
  const timestampMatch=value.match(/(\d{12,})\s*$/);

  const origin=stationMatch ? stationMatch[1].toUpperCase() : null;
  const timestamp=timestampMatch ? timestampMatch[1] : null;

  return {
    number:String(number),
    origin,
    timestamp,
    label:item?.label||value,
    value
  };
}
function italyDayKey(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function italyCandidateServiceDate(item){
  const label=String(item?.label||"");
  const m=label.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if(m)return `20${m[3]}-${m[2]}-${m[1]}`;
  const info=italyCandidateInfo(item,"");
  const ts=Number(info.timestamp||0);
  if(ts>0)return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ts));
  return italyDayKey();
}
async function fetchItalyTrainDetail(candidate,number){
  const c=italyCandidateInfo(candidate,number);
  if(!c.origin)throw new Error(`kan origine voor ${number} niet bepalen`);

  const suffix=c.timestamp?`/${encodeURIComponent(c.timestamp)}`:"";
  const data=await italyFetch(
    `andamentoTreno/${encodeURIComponent(c.origin)}/${encodeURIComponent(number)}${suffix}`,
    {expectJson:true}
  );

  if(!data)throw new Error(`geen detaildata voor ${number}`);
  return data;
}
function italyStops(data){return Array.isArray(data?.fermate)?data.fermate:[];}
function findItalyStop(data,name){return italyStops(data).find(s=>sameStation(s?.stazione,name))||null;}
async function resolveItalyJourney(cfg){
  const key=`${italyDayKey()}|${cfg.number}|${cfg.station}`;if(italyJourneyCache.has(key))return italyJourneyCache.get(key);
  const text=await italyFetch(`cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(cfg.number)}`),items=parseAutocomplete(text);
  if(!items.length)throw new Error(`trein ${cfg.number} niet gevonden`);
  const candidates=[];
  for(const item of items){
    try{
      const data=await fetchItalyTrainDetail(item,cfg.number);
      if(findItalyStop(data,cfg.station))candidates.push({item,data});
    }catch{}
    await sleep(80);
  }

  if(candidates.length){
    const today=italyDayKey();

    // Autocomplete kan dezelfde trein voor meerdere dagen teruggeven.
    // Geef een kandidaat met de datum van vandaag voorrang.
    candidates.sort((a,b)=>{
      const dateKey=item=>{
        const label=String(item?.label||"");
        const m=label.match(/(\d{2})\/(\d{2})\/(\d{2})/);
        return m ? `20${m[3]}-${m[2]}-${m[1]}` : "";
      };
      const aToday=dateKey(a.item)===today ? 0 : 1;
      const bToday=dateKey(b.item)===today ? 0 : 1;
      return aToday-bToday;
    });

    const result={candidate:candidates[0].item,data:candidates[0].data};
    italyJourneyCache.set(key,result);
    return result;
  }
  if(items.length===1){const data=await fetchItalyTrainDetail(items[0],cfg.number),result={candidate:items[0],data};italyJourneyCache.set(key,result);return result;}
  throw new Error(`geen rit van ${cfg.number} via ${cfg.station} gevonden`);
}
function msValue(...values){for(const v of values){const n=Number(v);if(Number.isFinite(n)&&n>0)return n;}return null;}
function hhmmMs(value){const ms=Number(value);if(!Number.isFinite(ms)||ms<=0)return "--:--";return new Intl.DateTimeFormat("nl-NL",{timeZone:"Europe/Rome",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(ms));}
function italyEvent(stop,mode){
  if(mode==="arrival"){
    const plannedTrack=String(stop?.binarioProgrammatoArrivoDescrizione??"").trim(),currentTrack=String(stop?.binarioEffettivoArrivoDescrizione??plannedTrack).trim();
    return {planned:msValue(stop?.arrivoTeorico,stop?.programmata),actual:msValue(stop?.arrivoReale,stop?.effettiva),delay:Number(stop?.ritardoArrivo??stop?.ritardo??0),plannedTrack,currentTrack,track:currentTrack||plannedTrack};
  }
  if(mode==="departure"){
    const plannedTrack=String(stop?.binarioProgrammatoPartenzaDescrizione??"").trim(),currentTrack=String(stop?.binarioEffettivoPartenzaDescrizione??plannedTrack).trim();
    return {planned:msValue(stop?.partenzaTeorica,stop?.programmata),actual:msValue(stop?.partenzaReale,stop?.effettiva),delay:Number(stop?.ritardoPartenza??stop?.ritardo??0),plannedTrack,currentTrack,track:currentTrack||plannedTrack};
  }
  const dep=italyEvent(stop,"departure");return dep.planned?dep:italyEvent(stop,"arrival");
}
function italyCancelled(data,stop){return String(data?.tipoTreno||"").toUpperCase()==="ST"||Number(data?.provvedimento)===1||Number(stop?.actualFermataType)===3;}
function italyPartial(data,stop){return Number(data?.provvedimento)===2||["PP","SI","SF"].includes(String(data?.tipoTreno||"").toUpperCase());}
function italyTrainName(data,number){const comp=String(data?.compNumeroTreno||"").trim();if(comp)return comp;const cat=String(data?.categoriaDescrizione||data?.categoria||"").trim();return [cat,number].filter(Boolean).join(" ").trim()||`Treno ${number}`;}
async function addItalyTrend(train,now){
  if(train.cancelled){train.trend30=null;return;}const target=now-30*60000,min=now-40*60000,max=now-20*60000;
  const old=await findTrendObservation({source:"ViaggiaTreno",trainKey:train.trainKey,station:train.station||"",eventMode:train.mode||"",min,max,target});
  if(!old){train.trend30=null;return;}const diff=Number(train.delay)-Number(old.delay_minutes);train.trend30=diff>=3?"up":diff<=-3?"down":null;
}
async function scanOneItaly(cfg){
  const resolved=await resolveItalyJourney(cfg),data=resolved.data;if(!data)throw new Error(`geen detaildata voor ${cfg.number}`);
  const stop=findItalyStop(data,cfg.station);if(!stop)throw new Error(`${cfg.station} niet in rit ${cfg.number}`);
  const event=italyEvent(stop,cfg.mode),cancelled=italyCancelled(data,stop),partial=italyPartial(data,stop);let delay=Number(event.delay);if(!Number.isFinite(delay))delay=Number(data?.ritardo||0);if(!Number.isFinite(delay))delay=0;
  let status="IN ORARIO",type="ok";if(cancelled){status="CANCELLATO";type="cancel";}else if(partial){status="PARZ. CANC.";type="partial";}else if(delay>30){status=`+${delay} MIN`;type="major-delay";}else if(delay>0){status=`+${delay} MIN`;type="delay";}else if(delay<0){status=`${delay} MIN`;type="info";}
  const origin=String(data?.origineEstera||data?.origine||data?.origineZero||"").trim(),destination=String(data?.destinazioneEstera||data?.destinazione||data?.destinazioneZero||"").trim();
  const plannedTs=Number(event.planned||event.actual||0),expectedTs=Number(event.actual||0)||plannedTs+(delay*60000);
  return {
    trainKey:`IT|${cfg.number}|${cfg.station}|${cfg.mode}`,
    sourceTripId:String(resolved.candidate?.value||`IT|${cfg.number}`),
    sourceEventId:String(stop?.id||stop?.idFermata||`${cfg.station}|${cfg.mode}`),
    serviceDate:italyCandidateServiceDate(resolved.candidate),
    number:String(cfg.number),train:italyTrainName(data,cfg.number),category:String(data?.categoriaDescrizione||data?.categoria||"").trim(),
    from:origin||"—",to:destination||"—",station:cfg.station,mode:cfg.mode,eventMode:cfg.mode,
    stationCode:String(stop?.id||stop?.idFermata||""),countryCode:"IT",
    time:hhmmMs(event.planned||event.actual),plannedTime:hhmmMs(event.planned||event.actual),currentTime:hhmmMs(event.actual||event.planned),
    plannedTimestamp:plannedTs,expectedTimestamp:expectedTs,actualTimestamp:Number(event.actual||0)||null,
    plannedTrack:event.plannedTrack,currentTrack:event.currentTrack,track:event.track||"—",delay,status,type,cancelled,trend30:null,
    lastDetection:String(data?.stazioneUltimoRilevamento||"").trim(),lastDetectionAt:data?.oraUltimoRilevamento||null,
    rawStop:stop,rawData:data
  };
}
async function performItalyScan(){
  if(!config.italy?.enabled||italyState.scanning)return;italyState.scanning=true;const rows=[],warnings=[];
  try{
    for(const cfg of config.italy.trains||[]){try{rows.push(await scanOneItaly(cfg));}catch(e){warnings.push(`${cfg.number} (${cfg.station}): ${e.message}`);}await sleep(120);}
    rows.sort((a,b)=>(a.plannedTimestamp||0)-(b.plannedTimestamp||0));const now=Date.now();for(const row of rows)await addItalyTrend(row,now);if(rows.length)await recordObservations(rows,"ViaggiaTreno",now);
    italyState.trains=mergeEquivalentBoardTrains(rows.filter(isPassengerBoardTrain));italyState.warnings=warnings;italyState.lastScanAt=new Date(now).toISOString();console.log(`[${new Date().toLocaleTimeString()}] Italia-scan: ${rows.length} geselecteerde trein(en)`);if(warnings.length)console.log("Italia:",warnings.join(" | "));
  }finally{italyState.scanning=false;}
}
function scheduleNextItaly(){if(!config.italy?.enabled)return;const {interval,delay}=nextDelay(new Date());italyState.currentIntervalMinutes=interval;italyState.nextScanAt=new Date(Date.now()+delay).toISOString();setTimeout(async()=>{await performItalyScan();scheduleNextItaly();},delay);}

function stationViewPayload(station,kind){
  let rows=currentCollectorRows(station);
  if(kind==="fern"){
    // De collector bewaart vanaf v4.1.2 alle treinsoorten, maar de bestaande
    // Mannheim/Wien-pagina's blijven bewust alleen Fernverkehr tonen.
    rows=rows.filter(r=>isFernverkehrCategory(r.category));
  }
  if(kind==="netherlands"){
    const targets=["Amsterdam Centraal","Arnhem Centraal","Venlo","Utrecht Centraal"];
    // Alleen toekomstige haltes ná Düsseldorf tellen. Zo komt een trein
    // die vanuit Nederland naar Duitsland rijdt niet per ongeluk op dit bord.
    rows=rows.filter(r=>futureRouteContains(r,targets));
  }
  rows=mergeEquivalentBoardTrains(rows);
  return {source:"DB Timetables",station,lastScanAt:collectorState.lastScanAt,count:rows.length,trains:rows};
}


// One bounded HTTP access probe per deployment. Does not subscribe to live data.
let ndovAccessProbe={status:"pending",checkedAt:null,httpStatus:null,liveDataReceived:false};
async function checkNdovAccess(){
  ndovAccessProbe={...ndovAccessProbe,status:"checking",startedAt:new Date().toISOString()};
  try{
    const response=await fetch("http://pubsub.ndovloket.nl/",{signal:AbortSignal.timeout(12000),redirect:"error"});
    const reader=response.body?.getReader();let text="",bytes=0;
    if(reader)try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>262144)break;text+=Buffer.from(part.value).toString("utf8");}}finally{await reader.cancel();}
    const denied=/access denied|forbidden|not authorized|unauthorized|geen toegang/i.test(text);
    ndovAccessProbe={status:response.ok&&!denied?"http_reachable":"http_denied_or_error",checkedAt:new Date().toISOString(),httpStatus:response.status,mentionsInfoPlus:/infoplus|DVS/i.test(text),mentionsZeroMQ:/zeromq|tcp:\/\//i.test(text),liveDataReceived:false};
  }catch(error){ndovAccessProbe={status:"connection_failed",checkedAt:new Date().toISOString(),errorCode:String(error.cause?.code||error.name||"ERROR"),liveDataReceived:false};}
  console.log("NDOV access probe:",JSON.stringify(ndovAccessProbe));
}

// NDOV InfoPlus/DVS: one subscription, initially observed alongside the DB board.
const ndovRows=new Map();
const ndovPending=new Map();
const ndovState={status:"starting",endpoint:"tcp://pubsub.ndovloket.nl:7664",startedAt:null,lastMessageAt:null,lastArnhemAt:null,messages:0,arnhemMessages:0,parseErrors:0,storageError:null};
let ndovParser,ndovSocket,ndovFlushing=false;
const ndovList=value=>value==null?[]:Array.isArray(value)?value:[value];
const ndovText=value=>String(value&&typeof value==="object"?value["#text"]??"":value??"").trim();
function ndovVariant(value,status){return ndovList(value).find(x=>x?.["@_InfoStatus"]===status);}
function ndovCurrent(value){return ndovVariant(value,"Actueel")??ndovVariant(value,"Gepland")??ndovList(value)[0];}
function ndovName(station){return ndovText(station?.LangeNaam)||ndovText(station?.MiddelNaam)||ndovText(station?.KorteNaam);}
function ndovClock(timestamp){return timestamp?new Intl.DateTimeFormat("nl-NL",{timeZone:"Europe/Amsterdam",hour:"2-digit",minute:"2-digit"}).format(timestamp):"--:--";}
function ndovProducts(value){
  if(!value||typeof value!=="object")return [];
  if(value.ReisInformatieProductDVS)return ndovList(value.ReisInformatieProductDVS);
  return Object.values(value).flatMap(ndovProducts);
}
function parseNdovRows(xml){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error("Unsupported XML declaration");
  const products=ndovProducts(ndovParser.parse(xml)),rows=[];
  for(const product of products){
    const dvs=product.DynamischeVertrekStaat,station=dvs?.RitStation;
    if(ndovText(station?.StationCode).toUpperCase()!=="AH")continue;
    const train=dvs.Trein;if(!train)continue;
    const number=ndovText(train.TreinNummer),ride=ndovText(dvs.RitId),date=ndovText(dvs.RitDatum);
    const plannedTimestamp=Date.parse(ndovText(ndovVariant(train.VertrekTijd,"Gepland")));
    const actualTime=Date.parse(ndovText(ndovVariant(train.VertrekTijd,"Actueel")));
    const messageTimestamp=Date.parse(product["@_TimeStamp"]);
    if(!number||!ride||!date||!Number.isFinite(plannedTimestamp)||!Number.isFinite(messageTimestamp))continue;
    const expectedTimestamp=Number.isFinite(actualTime)?actualTime:plannedTimestamp;
    const destination=ndovName(ndovCurrent(train.TreinEindBestemming));
    if(!destination)continue;
    const trackText=spoor=>[ndovText(spoor?.SpoorNummer),ndovText(spoor?.SpoorFase)].join("");
    const plannedTrack=trackText(ndovVariant(train.TreinVertrekSpoor,"Gepland"));
    const currentTrack=trackText(ndovCurrent(train.TreinVertrekSpoor));
    const changes=ndovList(train.Wijziging).map(x=>ndovText(x.WijzigingType));
    const cancelled=changes.includes("32"),departed=ndovText(train.TreinStatus)==="5";
    const notBoardable=[train.NietInstappen,train.RangeerBeweging,train.SpeciaalKaartje].some(x=>ndovText(x)==="J");
    const category=ndovText(train.TreinSoort?.["@_Code"])||ndovText(train.TreinSoort);
    const futureRoute=[...new Set([
      ...ndovList(train.TreinVleugel).flatMap(wing=>ndovList(ndovCurrent(wing.StopStations)?.Station).map(ndovName)),
      ...ndovList(ndovCurrent(train.VerkorteRoute)?.Station).map(ndovName),destination
    ].filter(Boolean))];
    const delay=Math.round((expectedTimestamp-plannedTimestamp)/60000);
    const status=cancelled?"Geannuleerd":notBoardable?"Niet instappen":delay>0?`+${delay} min`:"Op tijd";
    const id=`NDOV|AH|${date}|${ride}`;
    rows.push({id,source:"NDOV",sourceTripId:`${date}|${ride}`,sourceEventId:id,serviceDate:date,trainKey:`${category}|${number}`,number,rideId:ride,train:[category,number].filter(Boolean).join(" "),category,operatorCode:ndovText(train.Vervoerder),operatorName:ndovText(train.Vervoerder),observedAt:"Arnhem Centraal",stationCode:ndovText(station.UICCode)||"AH",countryCode:"NL",eventMode:"departure",plannedTimestamp,expectedTimestamp,plannedTime:ndovClock(plannedTimestamp),time:ndovClock(plannedTimestamp),currentTime:ndovClock(expectedTimestamp),plannedTrack,currentTrack,track:cancelled?"—":currentTrack||plannedTrack||"—",delay,status,type:cancelled?"cancel":delay>30?"major-delay":delay>0?"delay":"ok",cancelled,departed,notBoardable,from:"Arnhem Centraal",to:destination,route:["Arnhem Centraal",...futureRoute],futureRoute,pastRoute:[],hasRealtime:true,hasChangedTrack:Boolean(currentTrack&&plannedTrack&&currentTrack!==plannedTrack),messageTimestamp,rawStop:dvs});
  }
  return rows;
}
function acceptNdovRow(row){
  const old=ndovRows.get(row.id);
  if(old&&old.messageTimestamp>=row.messageTimestamp)return false;
  if(row.plannedTimestamp<Date.now()-86400000||row.plannedTimestamp>Date.now()+172800000)return false;
  ndovRows.set(row.id,row);ndovPending.set(row.id,row);
  ndovState.lastArnhemAt=new Date().toISOString();ndovState.arnhemMessages++;
  return true;
}
function ndovArnhemRows(){
  const cutoff=Date.now()-10*60000;
  return [...ndovRows.values()].filter(r=>!r.departed&&!r.notBoardable&&(r.cancelled?r.plannedTimestamp:r.expectedTimestamp)>=cutoff).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
}
function ndovStatus(){return {...ndovState,arnhemCount:ndovArnhemRows().length,pendingStorage:ndovPending.size,boardEnabled:process.env.NDOV_ARNHEM_ENABLED==="true",fresh:Boolean(ndovState.lastMessageAt&&Date.now()-Date.parse(ndovState.lastMessageAt)<180000)};}
async function flushNdov(){
  if(ndovFlushing||!ndovPending.size)return;
  ndovFlushing=true;const rows=[...ndovPending.values()];
  try{
    await recordObservations(rows,"NDOV");
    for(const r of rows)if(ndovPending.get(r.id)===r)ndovPending.delete(r.id);
    ndovState.storageError=null;
  }catch(e){ndovState.storageError=String(e.message).slice(0,180);}
  finally{ndovFlushing=false;}
}
async function startNdov(){
  if(process.env.NDOV_ENABLED==="false"){ndovState.status="disabled";return;}
  try{
    const [{Subscriber},{XMLParser},{gunzipSync,inflateSync}]=await Promise.all([import("zeromq"),import("fast-xml-parser"),import("node:zlib")]);
    ndovParser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,processEntities:true});
    ndovSocket=new Subscriber({linger:0,receiveHighWaterMark:1000,maxMessageSize:4194304,reconnectInterval:5000,reconnectMaxInterval:30000});
    ndovSocket.connect(ndovState.endpoint);ndovSocket.subscribe("/RIG/InfoPlusDVSInterface4");
    ndovState.startedAt=new Date().toISOString();ndovState.status="waiting_for_messages";
    setInterval(()=>{void flushNdov();for(const [id,row]of ndovRows)if(row.plannedTimestamp<Date.now()-86400000&&!ndovPending.has(id))ndovRows.delete(id);},10000).unref();
    for await(const parts of ndovSocket){
      if(parts.length<2)continue;
      ndovState.messages++;ndovState.lastMessageAt=new Date().toISOString();ndovState.status="receiving";
      try{
        let payload=Buffer.concat(parts.slice(1));
        if(payload[0]===0x1f&&payload[1]===0x8b)payload=gunzipSync(payload,{maxOutputLength:8388608});
        else if(payload[0]===0x78)payload=inflateSync(payload,{maxOutputLength:8388608});
        for(const row of parseNdovRows(payload.toString("utf8")))acceptNdovRow(row);
      }catch(e){ndovState.parseErrors++;ndovState.lastParseError=String(e.message).slice(0,160);}
    }
  }catch(e){ndovState.status="error";ndovState.error=String(e.message).slice(0,180);ndovSocket?.close();}
}

const pageRoutes={
  ...Object.fromEntries(Object.keys(config.stationPages||{}).flatMap(id=>[[`/embed/${id}`,"/koeln-embed.html"],[`/embed/${id}/`,"/koeln-embed.html"]])),
  "/mobile":"/mobile.html","/mobile/":"/mobile.html",
  "/embed/duesseldorf":"/koeln-embed.html","/embed/duesseldorf/":"/koeln-embed.html",
  "/embed/koeln":"/koeln-embed.html","/embed/koeln/":"/koeln-embed.html",
  "/nightjets":"/nightjets.html","/nightjets/":"/nightjets.html",
  "/duesseldorf":"/station-mobile.html","/duesseldorf/":"/station-mobile.html",
  "/wien":"/station-mobile.html","/wien/":"/station-mobile.html",
  "/mannheim":"/station-mobile.html","/mannheim/":"/station-mobile.html",
  "/datahub":"/datahub.html","/datahub/":"/datahub.html"
};

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host}`);
    if(url.pathname==="/api/health")return sendJson(res,200,{ok:true,credentialsConfigured:Boolean(CLIENT_ID&&API_KEY),api:BASE,storage:getStorageInfo(),config,dbState,collectorState:{lastScanAt:collectorState.lastScanAt,stations:Object.keys(collectorState.byStation)},italyState,nightjetPlanState:{dateKey:nightjetPlanState.dateKey,scanning:nightjetPlanState.scanning,lastUpdatedAt:nightjetPlanState.lastUpdatedAt,count:nightjetPlanState.rows.length,warnings:nightjetPlanState.warnings}});
    if(url.pathname==="/api/ndov/status")return sendJson(res,200,{access:ndovAccessProbe,receiver:ndovStatus()});
    if(url.pathname==="/api/ndov/arnhem")return sendJson(res,200,{...ndovStatus(),trains:ndovArnhemRows().map(({rawStop,...row})=>row)});
    if(url.pathname==="/api/storage")return sendJson(res,200,getStorageInfo());

    // V4 bron-onafhankelijke Data Hub API. Het bestaande board blijft de
    // oudere endpoints gebruiken zodat deze migratie geen schermgedrag wijzigt.
    if(url.pathname==="/api/v1/sources")return sendJson(res,200,{sources:await getDataSources()});
    if(url.pathname==="/api/v1/stats")return sendJson(res,200,{...(await getDataHubStats()),migration:getDataHubMigrationState()});
    if(url.pathname==="/api/v1/services"){
      const serviceDate=url.searchParams.get("date")||undefined,
            trainNumber=url.searchParams.get("train")||undefined,
            source=url.searchParams.get("source")||undefined,
            limit=Number(url.searchParams.get("limit")||250);
      const services=await getServiceRuns({serviceDate,trainNumber,source,limit});
      return sendJson(res,200,{serviceDate:serviceDate||null,train:trainNumber||null,source:source||null,count:services.length,services});
    }
    if(url.pathname==="/api/v1/events"){
      const serviceDate=url.searchParams.get("date")||undefined,
            trainNumber=url.searchParams.get("train")||undefined,
            station=url.searchParams.get("station")||undefined,
            source=url.searchParams.get("source")||undefined,
            latestOnly=url.searchParams.get("latest")!=="0",
            limit=Number(url.searchParams.get("limit")||500);
      const events=await getCanonicalEvents({serviceDate,trainNumber,station,source,latestOnly,limit});
      return sendJson(res,200,{serviceDate:serviceDate||null,train:trainNumber||null,station:station||null,source:source||null,latestOnly,count:events.length,events});
    }
    if(url.pathname.startsWith("/api/v1/train/")){
      const trainNumber=decodeURIComponent(url.pathname.slice("/api/v1/train/".length)),
            serviceDate=url.searchParams.get("date")||undefined;
      const [runs,combined]=await Promise.all([
        getServiceRuns({serviceDate,trainNumber,limit:100}),
        getCombinedTrain({trainNumber,serviceDate})
      ]);
      return sendJson(res,200,{trainNumber,serviceDate:serviceDate||null,runs,combined});
    }
    if(url.pathname.startsWith("/api/v1/station/")){
      const station=decodeURIComponent(url.pathname.slice("/api/v1/station/".length)),
            serviceDate=url.searchParams.get("date")||undefined,
            source=url.searchParams.get("source")||undefined,
            limit=Number(url.searchParams.get("limit")||500);
      const events=await getCanonicalEvents({serviceDate,station,source,latestOnly:true,limit});
      return sendJson(res,200,{station,serviceDate:serviceDate||null,source:source||null,count:events.length,events});
    }
    if(url.pathname==="/api/history"){
      const source=url.searchParams.get("source")||undefined,trainNumber=url.searchParams.get("train")||undefined,station=url.searchParams.get("station")||undefined,hours=Number(url.searchParams.get("hours")||24),limit=Number(url.searchParams.get("limit")||500);
      const observations=await getHistory({source,trainNumber,station,hours,limit});return sendJson(res,200,{source:source||"all",train:trainNumber||null,station:station||null,hours,count:observations.length,observations});
    }
    if(url.pathname.startsWith("/api/station/")){
      const station=decodeURIComponent(url.pathname.slice("/api/station/".length)),source=url.searchParams.get("source")||"DB",hours=Number(url.searchParams.get("hours")||6),limit=Number(url.searchParams.get("limit")||100);
      const observations=await getLatestByStation({station,source,hours,limit});return sendJson(res,200,{source,station,count:observations.length,observations});
    }
    const stationViewMatch=url.pathname.match(/^\/api\/views\/([a-z0-9-]+)\/?$/);
    const stationPageId=stationViewMatch?.[1];
    if(stationPageId&&Object.hasOwn(config.stationPages||{},stationPageId)){
      const payload=stationPagePayload(stationPageId);
      // Preserve the existing mobile API fields alongside the complete embed board.
      const legacy=stationPageId==="duesseldorf"?stationViewPayload("Düsseldorf Hbf","netherlands")
        :stationPageId==="wien"?stationViewPayload("Wien Hbf","fern")
        :stationPageId==="mannheim"?stationViewPayload("Mannheim Hbf","fern"):{};
      return sendJson(res,200,{...legacy,...payload});
    }
    if(url.pathname==="/api/views/nightjets")return sendJson(res,200,{source:"DB Timetables",...(await getNightjetView())});
    if(url.pathname==="/api/italy"){
      if(!italyState.lastScanAt&&!italyState.scanning)await performItalyScan();if(!italyState.lastScanAt&&italyState.warnings.length)return sendJson(res,503,{source:"ViaggiaTreno",error:italyState.warnings.join(" | ")});
      return sendJson(res,200,{source:"ViaggiaTreno",lastScanAt:italyState.lastScanAt,nextScanAt:italyState.nextScanAt,currentIntervalMinutes:italyState.currentIntervalMinutes,warnings:italyState.warnings,trains:italyState.trains});
    }
    if(url.pathname==="/api/trains"){
      if(!dbState.lastScanAt&&!dbState.scanning)await performScan();if(!dbState.lastScanAt&&dbState.warnings.length)return sendJson(res,503,{error:dbState.warnings.join(" | ")});
      return sendJson(res,200,{source:"DB Timetables",updatedAt:dbState.lastScanAt,lastScanAt:dbState.lastScanAt,nextScanAt:dbState.nextScanAt,currentIntervalMinutes:dbState.currentIntervalMinutes,warnings:dbState.warnings,stations:dbState.stations,trains:dbState.trains});
    }
    let requested=pageRoutes[url.pathname]||(url.pathname==="/"?"/index.html":url.pathname);requested=path.normalize(requested).replace(/^(\.\.[/\\])+/,'');const filename=path.join(publicDir,requested);if(!filename.startsWith(publicDir)){res.writeHead(403);return res.end("Forbidden");}sendFile(res,filename);
  }catch(e){sendJson(res,500,{error:e.message});}
});

await initStorage();
server.listen(PORT,async()=>{
  void checkNdovAccess();
  void startNdov();
  const storage=getStorageInfo();console.log("");console.log("Treinrondreis Multi-source Data Hub + Live Board v4.2.0");console.log(`Open: http://localhost:${PORT}`);console.log(`DB credentials: ${CLIENT_ID&&API_KEY?"ingesteld":"ONTBREKEN"}`);console.log(`Historie: ${storage.backend} (${storage.retention})`);console.log("");
  await Promise.allSettled([performScan(),performItalyScan()]);
  scheduleNext();scheduleNextItaly();scheduleNightjetDayCheck();setTimeout(()=>performNightjetDayPlan(),30000);

  // Bestaande v3-historie wordt op de achtergrond naar de nieuwe v4-laag
  // gekopieerd. Het live board blijft ondertussen gewoon bereikbaar.
  setTimeout(()=>{
    startLegacyMigration()
      .then(s=>console.log(`V4 historie-migratie: ${s.status}, ${s.migratedRows} rijen`))
      .catch(e=>console.error("V4 historie-migratie mislukt:",e));
  },15000);
});
