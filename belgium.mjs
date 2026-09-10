import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {recordObservations} from './storage.mjs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
export const belgianStations={
  antwerpen:{name:'Antwerpen-Centraal',uic:'8821006'},
  'brussel-zuid':{name:'Brussel-Zuid',uic:'8814001'},
  'brussel-noord':{name:'Brussel-Noord',uic:'8812005'},
  gent:{name:'Gent-Sint-Pieters',uic:'8892007'},
  liege:{name:'Liège-Guillemins',uic:'8841004'}
};
const root='https://api-management-opendata-production.azure-api.net/api/gtfs/feed/nmbssncb/';
export const belgiumState={status:'starting',lastPlanAt:null,lastRealtimeAt:null,error:null,stations:belgianStations};
let plan=null,live=null,busy=false,planDay='';
const zone='Europe/Brussels';
export function dayKey(ms){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms).replaceAll('-','');}
const clockFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
const clock=ms=>clockFormatter.format(ms);
// GTFS times are measured from local noon minus 12 hours, including on DST days.
export function gtfsTime(date,time){
  if(!/^\d{8}$/.test(date)||!/^\d+:\d{2}:\d{2}$/.test(time))return null;
  const noon=Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6),12);
  const localHour=+new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(noon);
  const [h,m,s]=time.split(':').map(Number);return noon-(localHour-12)*3600000-43200000+(h*3600+m*60+s)*1000;
}
export function* csv(text){
  let fields=[],field='',quoted=false,header=null;
  for(let i=0;i<=text.length;i++){
    const c=text[i]??'\n';
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===','||c==='\n')){fields.push(field.replace(/\r$/,''));field='';if(c==='\n'){if(!header)header=fields.map(x=>x.replace(/^\uFEFF/,''));else if(fields.length===header.length)yield Object.fromEntries(header.map((h,n)=>[h,fields[n]]));fields=[];}}
    else field+=c;
  }
}
export function parsePlan(bytes,now=Date.now()){
  const zip=unzipSync(bytes,{filter:f=>['stops.txt','trips.txt','routes.txt','stop_times.txt','calendar.txt','calendar_dates.txt','translations.txt'].includes(f.name)});
  const read=name=>csv(zip[name]?strFromU8(zip[name]):'');
  const dates=[-1,0,1].map(d=>dayKey(now+d*86400000)),services=new Map(dates.map(d=>[d,new Set()]));
  const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for(const r of read('calendar.txt'))for(const d of dates){const wd=new Date(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6)+'T12:00:00Z').getUTCDay();if(d>=r.start_date&&d<=r.end_date&&r[weekdays[wd]]==='1')services.get(d).add(r.service_id);}
  for(const r of read('calendar_dates.txt'))if(services.has(r.date)){if(r.exception_type==='1')services.get(r.date).add(r.service_id);if(r.exception_type==='2')services.get(r.date).delete(r.service_id);}
  const translations=new Map();for(const r of read('translations.txt'))if(r.language==='nl'&&r.field_name==='stop_name')translations.set(r.field_value,r.translation);
  const stops=new Map();for(const r of read('stops.txt'))stops.set(r.stop_id,{...r,name:translations.get(r.stop_name)||r.stop_name});
  const routes=new Map();for(const r of read('routes.txt'))routes.set(r.route_id,r);
  const trips=new Map();for(const r of read('trips.txt')){const days=dates.filter(d=>services.get(d).has(r.service_id));if(days.length)trips.set(r.trip_id,{...r,days,category:routes.get(r.route_id)?.route_short_name||'Trein',destination:translations.get(r.trip_headsign)||r.trip_headsign});}
  const rows=[];
  for(const r of read('stop_times.txt')){
    const trip=trips.get(r.trip_id),stop=stops.get(r.stop_id);if(!trip||!stop||r.pickup_type==='1')continue;
    const station=Object.entries(belgianStations).find(([,s])=>stop.parent_station==='gs:nmbssncb:S'+s.uic||stop.stop_id==='gs:nmbssncb:'+s.uic);if(!station)continue;
    for(const date of trip.days){const ts=gtfsTime(date,r.departure_time);if(!ts)continue;rows.push({page:station[0],tripId:r.trip_id,sequence:+r.stop_sequence,stopId:r.stop_id,date,plannedTimestamp:ts,plannedTrack:stop.platform_code||'',station:station[1],number:trip.trip_short_name,category:trip.category,to:trip.destination});}
  }
  if(!rows.length)throw new Error('Geen vertrekken voor de gekozen stations in de dienstregeling');
  return {rows,stops};
}
export function rowsWithRealtime(schedule,feed,now=Date.now()){
  const updates=new Map(),stamp=Number(feed?.header?.timestamp)*1000;
  const fresh=Number.isFinite(stamp)&&now-stamp<=180000&&stamp<=now+60000;
  if(fresh)for(const e of feed.entity||[]){const t=e.tripUpdate;if(!t?.trip?.tripId)continue;const key=t.trip.tripId+'|'+(t.trip.startDate||'');updates.set(key,t);}
  return schedule.rows.map(p=>{
    const update=updates.get(p.tripId+'|'+p.date)||updates.get(p.tripId+'|');
    const stopUpdate=update?.stopTimeUpdate?.find(s=>Number(s.stopSequence)===p.sequence);
    const cancelled=Number(update?.trip?.scheduleRelationship)===3||Number(stopUpdate?.scheduleRelationship)===1;
    const event=Number(stopUpdate?.scheduleRelationship)===2?null:stopUpdate?.departure;
    const hasRealtime=Boolean(event&&(Number.isFinite(event.time)||Number.isFinite(event.delay)));
    const expected=hasRealtime?(Number.isFinite(event.time)?event.time*1000:p.plannedTimestamp+event.delay*1000):p.plannedTimestamp;
    const currentStop=schedule.stops.get(stopUpdate?.stopId);
    const currentTrack=hasRealtime?(currentStop?.platform_code||p.plannedTrack):'';
    const delay=hasRealtime?Math.round((expected-p.plannedTimestamp)/60000):0;
    const id=p.date+'|'+p.tripId+'|'+p.sequence;
    return {id,source:'NMBS',sourceTripId:p.tripId,sourceEventId:id,serviceDate:p.date.slice(0,4)+'-'+p.date.slice(4,6)+'-'+p.date.slice(6),trainKey:p.category+'|'+p.number,number:p.number,train:p.category+' '+p.number,category:p.category,observedAt:p.station.name,stationCode:p.station.uic,countryCode:'BE',eventMode:'departure',plannedTimestamp:p.plannedTimestamp,expectedTimestamp:expected,plannedTime:clock(p.plannedTimestamp),time:clock(p.plannedTimestamp),currentTime:clock(expected),plannedTrack:p.plannedTrack,currentTrack,track:cancelled?'—':currentTrack||p.plannedTrack||'—',delay,cancelled,hasRealtime,status:cancelled?'Geannuleerd':hasRealtime?(delay?`+${delay} min`:'Op tijd'):'Volgens dienstregeling',from:p.station.name,to:p.to,route:[],page:p.page,messageTimestamp:stamp||null};
  });
}
async function download(path){
  const key=String(process.env.BMC_PARTNER_KEY||'').trim();if(!key)throw new Error('BMC_PARTNER_KEY ontbreekt');
  const r=await fetch(root+path,{headers:{'bmc-partner-key':key},signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw new Error('NMBS HTTP '+r.status);return r;
}
async function tick(){
  if(busy)return;busy=true;
  try{
    const now=Date.now();
    if(!plan||planDay!==dayKey(now)){
      const bytes=new Uint8Array(await(await download('static')).arrayBuffer());
      const next=await new Promise((resolve,reject)=>{const w=new Worker(new URL(import.meta.url),{workerData:{bytes,now},transferList:[bytes.buffer]});w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{if(code)reject(new Error('NMBS dienstregeling verwerken mislukt'));});});
      plan=next;planDay=dayKey(now);await saveBoardCache('NMBS:plan',{plan,planDay});belgiumState.lastPlanAt=new Date().toISOString();
      await recordObservations(rowsWithRealtime(plan,null,now).filter(r=>r.plannedTimestamp>=now-3600000&&r.plannedTimestamp<now+86400000),'NMBS',now);
    }
    const next=await(await download('rt/trip-update?format=json')).json();
    if(!next.header||!Array.isArray(next.entity))throw new Error('Ongeldige NMBS realtimefeed');
    live=next;await saveBoardCache('NMBS:live',live);belgiumState.lastRealtimeAt=new Date(Number(next.header.timestamp)*1000).toISOString();
    const rows=rowsWithRealtime(plan,live).filter(r=>r.plannedTimestamp>=now-3600000&&r.plannedTimestamp<now+86400000);
    await recordObservations(rows,'NMBS',Date.now());
    belgiumState.status=Date.now()-Number(next.header.timestamp)*1000>180000?'stale':'ready';belgiumState.error=null;
  }catch(e){belgiumState.status='error';belgiumState.error=String(e.message).slice(0,160);}finally{busy=false;}
}
export async function restoreBelgium(){const saved=await loadBoardCache('NMBS:plan');if(saved){plan=saved.plan;planDay=saved.planDay;live=await loadBoardCache('NMBS:live');if(live)belgiumState.lastRealtimeAt=new Date(Number(live.header.timestamp)*1000).toISOString();}}
export function startBelgium(){void tick();setInterval(()=>void tick(),30000).unref();}
export function belgianPayload(page){
  if(!belgianStations[page])return null;
  const now=Date.now(),rows=plan?rowsWithRealtime(plan,live,now).filter(r=>r.page===page&&r.expectedTimestamp>=now-60000&&r.plannedTimestamp<now+86400000).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp):[];
  const fern=r=>/^(IC|EC|ECD|ICE|TGV|EUR|EST|NJ|EN)$/i.test(r.category);
  return {title:'Vertrektijden '+belgianStations[page].name,country:'BE',source:'NMBS / Belgian Mobility',lastScanAt:belgiumState.lastRealtimeAt,quick:[],departures:{all:rows,fernverkehr:rows.filter(fern),regional:rows.filter(r=>!fern(r))},status:belgiumState.status,warnings:belgiumState.error?[belgiumState.error]:[]};
}
if(!isMainThread&&workerData?.bytes)parentPort.postMessage(parsePlan(workerData.bytes,workerData.now));
