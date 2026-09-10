import {unzipSync,strFromU8} from 'fflate';
import GTFS from 'gtfs-realtime-bindings';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {csv,gtfsTime,dayKey} from './belgium.mjs';
import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
import {recordObservations} from './storage.mjs';

export const frenchStations=Object.fromEntries([
 ['barcelona','Barcelona Sants','71718010'],
 ['paris-nord','Paris Gare du Nord','87271007'],['paris-lyon','Paris Gare de Lyon','87686006'],
 ['lille-europe','Lille Europe','87223263'],['lille-flandres','Lille Flandres','87286005'],
 ['montpellier','Montpellier Saint-Roch','87773002'],['montpellier-sud','Montpellier Sud de France','87688887'],
 ['nimes','Nîmes Centre','87775007'],['toulouse','Toulouse Matabiau','87611004'],['brive','Brive-la-Gaillarde','87594002'],
 ['collioure','Collioure','87784256'],['perpignan','Perpignan','87784009'],['narbonne','Narbonne','87781104'],
 ['beziers','Béziers','87781005'],['marseille','Marseille Saint-Charles','87751008'],['avignon-tgv','Avignon TGV','87318964'],['lyon','Lyon Part Dieu','87723197']
].map(([id,name,uic])=>[id,{name,uic}]));
const PLAN_URL='https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip';
const LIVE_URL='https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates';
const TRACK_URL='https://proxy.transport.data.gouv.fr/resource/sncf-siri-lite-estimated-timetable';
const clockFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'});
const clock=t=>clockFormatter.format(t);
export const franceState={status:'starting',lastPlanAt:null,lastRealtimeAt:null,error:null,stations:{}};
let plan=null,live=null,tracks=null,planDay='',busy=false,retryPlanAt=0;
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
const trackKey=(station,number,time)=>[station,String(number).trim().replace(/^0+(?=\d)/,''),time].join('|');
export function parseFrenchTracks(xml){
 if(XMLValidator.validate(xml)!==true)throw Error('SNCF-sporen: ongeldige XML');
 const doc=new XMLParser({removeNSPrefix:true,parseTagValue:false,processEntities:true}).parse(xml);
 const delivery=doc.Siri?.ServiceDelivery,at=Date.parse(delivery?.ResponseTimestamp);
 if(!Number.isFinite(at)||!delivery?.EstimatedTimetableDelivery)throw Error('SNCF-sporen: ongeldige levering');
 const rows=new Map(),wanted=new Set(Object.values(frenchStations).map(s=>s.uic));
 for(const d of array(delivery.EstimatedTimetableDelivery)){
  if(d.Status==='false')throw Error('SNCF-sporen: bron meldt een fout');
  for(const f of array(d.EstimatedJourneyVersionFrame))for(const j of array(f.EstimatedVehicleJourney)){
   if(j.Cancellation==='true')continue;
   const numbers=array(j.TrainNumbers?.TrainNumberRef);
   for(const c of [...array(j.RecordedCalls?.RecordedCall),...array(j.EstimatedCalls?.EstimatedCall)]){
    const station=String(c.StopPointRef||'').match(/(\d{8}):?$/)?.[1],time=Date.parse(c.AimedDepartureTime);
    const platform=typeof c.DeparturePlatformName==='string'?c.DeparturePlatformName.trim():'';
    if(!wanted.has(station)||!Number.isFinite(time)||!platform||platform.length>20||c.DepartureStatus==='cancelled')continue;
    for(const number of numbers){if(!/^\d+$/.test(String(number)))continue;const key=trackKey(station,number,time);
     rows.set(key,rows.has(key)&&rows.get(key)!==platform?null:platform);
    }
   }
  }
 }
 return {at,rows:Object.fromEntries(rows)};
}
export function parseFrenchPlan(bytes,now=Date.now()){
 const zip=unzipSync(bytes,{filter:f=>['stops.txt','routes.txt','trips.txt','stop_times.txt','calendar.txt','calendar_dates.txt'].includes(f.name)});
 const read=n=>csv(zip[n]?strFromU8(zip[n]):'');
 const dates=[-1,0,1,2].map(d=>dayKey(now+d*86400000)),services=new Map(dates.map(d=>[d,new Set()]));
 const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
 for(const r of read('calendar.txt'))for(const d of dates){const wd=new Date(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6)+'T12:00:00Z').getUTCDay();if(d>=r.start_date&&d<=r.end_date&&r[weekdays[wd]]==='1')services.get(d).add(r.service_id);}
 for(const r of read('calendar_dates.txt'))if(services.has(r.date)){if(r.exception_type==='1')services.get(r.date).add(r.service_id);if(r.exception_type==='2')services.get(r.date).delete(r.service_id);}
 const byParent=new Map(Object.entries(frenchStations).map(([page,s])=>['StopArea:OCE'+s.uic,page]));
 const stops=new Map([...read('stops.txt')].map(s=>[s.stop_id,{name:s.stop_name,page:byParent.get(s.parent_station)||byParent.get(s.stop_id),platform:s.platform_code||''}]));
 const routes=new Map([...read('routes.txt')].filter(r=>Number(r.route_type)===2||(Number(r.route_type)>=100&&Number(r.route_type)<200)).map(r=>[r.route_id,r]));
 const trips=new Map();for(const r of read('trips.txt')){const days=dates.filter(d=>services.get(d).has(r.service_id));if(days.length&&routes.has(r.route_id))trips.set(r.trip_id,{...r,days,stops:[]});}
 for(const r of read('stop_times.txt')){const trip=trips.get(r.trip_id);if(trip&&stops.has(r.stop_id))trip.stops.push({stopId:r.stop_id,seq:Number(r.stop_sequence),arrival:r.arrival_time,departure:r.departure_time,pickup:r.pickup_type!=='1',...stops.get(r.stop_id)});}
 const rows=[];
 for(const [tripId,t] of trips){t.stops.sort((a,b)=>a.seq-b.seq);for(let i=0;i<t.stops.length-1;i++){
  const s=t.stops[i];if(!s.page||!s.pickup)continue;
  const kind=s.stopId.match(/^StopPoint:OCE(.+)-\d+$/)?.[1]||'Train';
  const category=kind.startsWith('TGV')?'TGV':kind.startsWith('INTERCITES')?'IC':kind==='Train TER'?'TER':kind==='Lyria'?'TGV Lyria':kind;
  const futureRoute=t.stops.slice(i+1).map(x=>x.name),number=t.trip_short_name||t.trip_headsign||'';
  for(const date of t.days){const plannedTimestamp=gtfsTime(date,s.departure);if(!Number.isFinite(plannedTimestamp))continue;rows.push({page:s.page,tripId,date,sequence:s.seq,stopId:s.stopId,number,category,plannedTimestamp,plannedTrack:s.platform,to:t.stops.at(-1).name,futureRoute});}
 }}
 for(const page of Object.keys(frenchStations))if(!rows.some(r=>r.page===page))throw Error('SNCF-dienstregeling ontbreekt voor '+page);
 return {rows,generatedAt:now};
}
export function decodeFrenchLive(bytes){return GTFS.transit_realtime.FeedMessage.toObject(GTFS.transit_realtime.FeedMessage.decode(bytes),{longs:Number,enums:Number});}
export function frenchRows(schedule,feed,now=Date.now(),trackFeed=tracks){
 const at=Number(feed?.header?.timestamp)*1000,fresh=Number.isFinite(at)&&now-at<=300000&&at<=now+60000;
 const updates=new Map();if(fresh)for(const e of feed.entity||[]){const t=e.tripUpdate;if(t?.trip?.tripId&&!e.isDeleted)updates.set(t.trip.tripId+'|'+(t.trip.startDate||''),t);}
 return schedule.rows.filter(p=>p.plannedTimestamp>=now-6*3600000&&p.plannedTimestamp<now+86400000).map(p=>{
  const u=updates.get(p.tripId+'|'+p.date),stop=u?.stopTimeUpdate?.find(s=>s.stopSequence!==undefined?Number(s.stopSequence)===p.sequence:s.stopId===p.stopId);
  const cancelled=u?.trip?.scheduleRelationship===3||stop?.scheduleRelationship===1;
  const event=stop?.scheduleRelationship===2?null:stop?.departure,hasRealtime=Boolean(event&&(Number.isFinite(event.time)||Number.isFinite(event.delay)));
  const expected=hasRealtime?(Number.isFinite(event.time)?event.time*1000:p.plannedTimestamp+event.delay*1000):p.plannedTimestamp;
  const delay=hasRealtime?Math.round((expected-p.plannedTimestamp)/60000):0,s=frenchStations[p.page],id=['SNCF',p.date,p.tripId,p.sequence].join('|');
  const currentTrack=!cancelled&&trackFeed?.at<=now+60000&&now-trackFeed.at<=300000?trackFeed.rows?.[trackKey(s.uic,p.number,p.plannedTimestamp)]||'':'';
  return {id,page:p.page,source:'SNCF',sourceTripId:p.tripId,sourceEventId:id,serviceDate:p.date.slice(0,4)+'-'+p.date.slice(4,6)+'-'+p.date.slice(6),trainKey:p.date+'|'+p.number,number:p.number,train:p.category+' '+p.number,category:p.category,transportMode:'rail',countryCode:'FR',observedAt:s.name,stationCode:s.uic,eventMode:'departure',plannedTimestamp:p.plannedTimestamp,expectedTimestamp:expected,plannedTime:clock(p.plannedTimestamp),time:clock(p.plannedTimestamp),currentTime:clock(expected),plannedTrack:p.plannedTrack,currentTrack,track:cancelled?'—':currentTrack||p.plannedTrack||'—',delay,hasRealtime,cancelled,status:cancelled?'Geannuleerd':hasRealtime&&delay?(delay>0?'+':'')+delay+' min':'',from:s.name,to:p.to,route:p.futureRoute,futureRoute:p.futureRoute,routeComplete:true,messageTimestamp:fresh?at:null};
 });
}
async function download(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('SNCF HTTP '+r.status);return new Uint8Array(await r.arrayBuffer());}
export async function scanFrance(){
 if(busy)return;busy=true;
 try{
  const now=Date.now();
  if((!plan||planDay!==dayKey(now))&&now>=retryPlanAt){try{
   const bytes=await download(PLAN_URL);
   const next=await new Promise((resolve,reject)=>{const w=new Worker(new URL(import.meta.url),{workerData:{franceBytes:bytes,now},transferList:[bytes.buffer]});w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{if(code)reject(Error('SNCF-import mislukt'));});});
   plan=next;planDay=dayKey(now);await saveBoardCache('SNCF:plan',{plan,planDay});franceState.lastPlanAt=new Date(now).toISOString();
  }catch(e){retryPlanAt=now+900000;franceState.error=e.message;if(!plan)throw e;}}
  if(!plan)throw Error('SNCF-dienstregeling nog niet beschikbaar');
  try{tracks=parseFrenchTracks(new TextDecoder().decode(await download(TRACK_URL)));await saveBoardCache('SNCF:tracks',tracks);franceState.lastTracksAt=new Date(tracks.at).toISOString();franceState.trackCount=Object.values(tracks.rows).filter(Boolean).length;franceState.trackError=null;}catch(e){franceState.trackError=String(e.message).slice(0,200);}
  const next=decodeFrenchLive(await download(LIVE_URL));if(next.header?.incrementality===1)throw Error('SNCF-differentiële feed niet ondersteund');
  const keys=new Set(plan.rows.map(r=>r.tripId));live={header:next.header,entity:(next.entity||[]).filter(e=>keys.has(e.tripUpdate?.trip?.tripId))};
  await saveBoardCache('SNCF:live',live);const rows=frenchRows(plan,live,Date.now());await recordObservations(rows,'SNCF',Date.now());
  franceState.lastRealtimeAt=new Date(Number(live.header.timestamp)*1000).toISOString();franceState.status=Date.now()-Number(live.header.timestamp)*1000>300000?'stale':'ready';
  if(planDay===dayKey(now))franceState.error=null;
  franceState.stations=Object.fromEntries(Object.entries(frenchStations).map(([p,s])=>[p,{name:s.name,count:rows.filter(r=>r.page===p).length}]));
 }catch(e){franceState.status='error';franceState.error=String(e.message).slice(0,200);}finally{busy=false;}
}
export async function restoreFrance(){const saved=await loadBoardCache('SNCF:plan');if(saved?.plan?.rows){plan=saved.plan;planDay=Object.keys(frenchStations).every(page=>plan.rows.some(r=>r.page===page))?saved.planDay:"";franceState.lastPlanAt=new Date(plan.generatedAt).toISOString();}live=await loadBoardCache('SNCF:live');tracks=await loadBoardCache('SNCF:tracks');}
export function startFrance(){void scanFrance();setInterval(()=>void scanFrance(),120000).unref();}
export function frenchPayload(page,now=Date.now()){
 const rows=plan?frenchRows(plan,live,now).filter(r=>r.page===page&&r.expectedTimestamp>=now-60000).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp):[];
 const fern=r=>/^(TGV|IC|OUIGO|ICE|EC|EN|NJ|Eurostar)/i.test(r.category);
 return {title:'Vertrektijden '+frenchStations[page].name,country:'FR',source:'SNCF',lastScanAt:franceState.lastRealtimeAt,status:franceState.status,notice:'SNCF TGV, Intercités en TER. Andere vervoerders en RER/Transilien zijn niet volledig opgenomen. Actuele informatie en sporen zijn niet voor elke trein beschikbaar.',quick:[],departures:{all:rows,fernverkehr:rows.filter(fern),regional:rows.filter(r=>!fern(r))}};
}
if(!isMainThread&&workerData?.franceBytes)parentPort.postMessage(parseFrenchPlan(workerData.franceBytes,workerData.now));
