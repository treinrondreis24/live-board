import {unzipSync,strFromU8} from 'fflate';
import GTFS from 'gtfs-realtime-bindings';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {csv,dayKey,gtfsTime} from './belgium.mjs';
import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
import {frenchCurrentTrack} from './france.mjs';
import {recordObservations} from './storage.mjs';
export const spanishStations=Object.fromEntries([
 ['barcelona','Barcelona Sants','71801'],['madrid-atocha','Madrid Puerta de Atocha-Almudena Grandes','60000'],['sevilla','Sevilla Santa Justa','51003'],['cordoba','Córdoba-Julio Anguita','50500'],['cadiz','Cádiz','51405'],['malaga','Málaga María Zambrano','54413'],['ronda','Ronda','55007'],['granada','Granada','05000'],['jaen','Jaén','03100'],['irun','Irun','11600']
].map(([id,name,stop])=>[id,{name,stop,country:'ES'}]));
const definitions={
 RENFE:{plan:'https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip',live:'https://gtfsrt.renfe.com/trip_updates_LD.json',stops:{...Object.fromEntries(Object.entries(spanishStations).map(([p,s])=>[s.stop,p])),'87089':'marseille','87814':'avignon-tgv','87302':'nimes','87173':'montpellier','87088':'narbonne','87374':'perpignan','87303':'lyon'}},
 EUROSTAR:{plan:'https://integration-storage.dm.eurostar.com/gtfs-prod/gtfs_static_commercial_v2.zip',live:'https://integration-storage.dm.eurostar.com/gtfs-prod/gtfs_rt_v2.bin',stops:{paris_nord_station_area:'paris-nord',lille_europe_station_area:'lille-europe'}}
};
export const internationalState=Object.fromEntries(Object.keys(definitions).map(s=>[s,{status:'starting',lastPlanAt:null,lastRealtimeAt:null,error:null}]));
const cache=new Map(),clockFormat=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}),clock=t=>clockFormat.format(t);
export function parseInternational(source,bytes,now=Date.now()){
 const def=definitions[source],z=unzipSync(bytes,{filter:f=>['stops.txt','routes.txt','trips.txt','stop_times.txt','calendar.txt','calendar_dates.txt'].includes(f.name)});
 const read=n=>[...csv(z[n]?strFromU8(z[n]):'')].map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k.trim(),v.trim()])));
 const dates=[-1,0,1,2].map(d=>dayKey(now+d*86400000)),services=new Map(dates.map(d=>[d,new Set()])),weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
 for(const r of read('calendar.txt'))for(const d of dates){const wd=new Date(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6)+'T12:00:00Z').getUTCDay();if(d>=r.start_date&&d<=r.end_date&&r[weekdays[wd]]==='1')services.get(d).add(r.service_id);}
 for(const r of read('calendar_dates.txt'))if(services.has(r.date)){if(r.exception_type==='1')services.get(r.date).add(r.service_id);if(r.exception_type==='2')services.get(r.date).delete(r.service_id);}
 const stops=new Map(read('stops.txt').map(s=>[s.stop_id,{name:s.stop_name,page:def.stops[s.parent_station]||def.stops[s.stop_id],platform:s.platform_code||''}]));
 const routes=new Map(read('routes.txt').filter(r=>+r.route_type===2||(+r.route_type>=100&&+r.route_type<200)).map(r=>[r.route_id,r]));
 const trips=new Map();for(const r of read('trips.txt')){const days=dates.filter(d=>services.get(d).has(r.service_id));if(days.length&&routes.has(r.route_id))trips.set(r.trip_id,{...r,days,category:source==='EUROSTAR'?'EST':routes.get(r.route_id).route_short_name||'RENFE',stops:[]});}
 for(const r of read('stop_times.txt')){const t=trips.get(r.trip_id),s=stops.get(r.stop_id);if(t&&s)t.stops.push({...s,stopId:r.stop_id,seq:+r.stop_sequence,time:r.departure_time,pickup:r.pickup_type!=='1'});}
 const rows=[];for(const [tripId,t] of trips){t.stops.sort((a,b)=>a.seq-b.seq);for(let i=0;i<t.stops.length-1;i++){const s=t.stops[i];if(!s.page||!s.pickup)continue;for(const date of t.days){const plannedTimestamp=gtfsTime(date,s.time);if(!Number.isFinite(plannedTimestamp))continue;rows.push({source,page:s.page,tripId,date,sequence:s.seq,stopId:s.stopId,station:s.name,number:t.trip_short_name,category:t.category,plannedTimestamp,plannedTrack:s.platform,to:t.stops.at(-1).name,futureRoute:t.stops.slice(i+1).map(s=>s.name),tripStops:t.stops.map(s=>s.stopId)});}}}
 if(!rows.length)throw Error(source+' dienstregeling leeg');
 return {rows,platformPages:Object.fromEntries([...stops].map(([id,s])=>[id,s.page])),platforms:Object.fromEntries([...stops].filter(([,s])=>s.page).map(([id,s])=>[id,s.platform])),generatedAt:now};
}
export function decodeInternational(source,bytes){const message=source==='RENFE'?GTFS.transit_realtime.FeedMessage.fromObject(JSON.parse(new TextDecoder().decode(bytes))):GTFS.transit_realtime.FeedMessage.decode(bytes);return GTFS.transit_realtime.FeedMessage.toObject(message,{longs:Number,enums:Number});}
function updateKey(source,trip){if(source==='RENFE'){const m=trip.tripId?.match(/^(.*?)(\d{4})-(\d{2})-(\d{2})$/);return m?m[1]+'|'+m[2]+m[3]+m[4]:null;}return trip.tripId+'|'+trip.startDate;}
function planKey(p){return p.source==='RENFE'?p.tripId.replace(/\d{4}-\d{2}-\d{2}$/,'')+'|'+p.date:p.tripId+'|'+p.date;}
export function internationalRows(plan,feed,now=Date.now()){
 const stamp=Number(feed?.header?.timestamp)*1000,fresh=Number.isFinite(stamp)&&now-stamp<=300000&&stamp<=now+60000,updates=new Map();
 if(fresh)for(const e of feed.entity||[])if(e.tripUpdate&&!e.isDeleted)updates.set(updateKey(plan.rows[0]?.source,e.tripUpdate.trip),e.tripUpdate);
 return plan.rows.filter(p=>p.plannedTimestamp>=now-6*3600000&&p.plannedTimestamp<now+86400000).map(p=>{
  const u=updates.get(planKey(p)),su=u?.stopTimeUpdate||[];
  const exact=su.find(s=>s.stopSequence!==undefined?+s.stopSequence===p.sequence:s.stopId===p.stopId||s.stopId?.startsWith(p.stopId+'_'));
  const cancelled=u?.trip?.scheduleRelationship===3||exact?.scheduleRelationship===1;
  let event=exact?.scheduleRelationship===2?null:exact?.departure,propagated=false;
  // Renfe reports the last visited stop. Propagate its delay only to later stops of the same dated run.
  if(!event&&p.source==='RENFE'&&exact?.scheduleRelationship!==2&&Number.isFinite(u?.delay)){
   const known=su.find(s=>p.tripStops.includes(s.stopId)&&Number.isFinite(s.arrival?.time));
   if(known&&p.tripStops.indexOf(known.stopId)<p.tripStops.indexOf(p.stopId)&&known.arrival.time*1000<=now+60000&&now-known.arrival.time*1000<3*3600000){event={delay:u.delay};propagated=true;}
  }
  const hasRealtime=Boolean(event&&(Number.isFinite(event.time)||Number.isFinite(event.delay))),expected=hasRealtime?(Number.isFinite(event.time)?event.time*1000:p.plannedTimestamp+event.delay*1000):p.plannedTimestamp;
  const assigned=exact?.stopTimeProperties?.assignedStopId;
  const trackStop=assigned||exact?.stopId;
  const matchingPlatform=trackStop&&(plan.platformPages?.[trackStop]===p.page||(!plan.platformPages&&trackStop.startsWith(p.stopId+'_')));
  const currentTrack=!cancelled&&fresh&&exact&&matchingPlatform?(plan.platforms[trackStop]||''):'',id=[p.source,p.date,p.tripId,p.sequence].join('|'),delay=hasRealtime?Math.round((expected-p.plannedTimestamp)/60000):0;
  return {id,page:p.page,source:p.source,sourceTripId:p.tripId,sourceEventId:id,serviceDate:p.date.slice(0,4)+'-'+p.date.slice(4,6)+'-'+p.date.slice(6),trainKey:p.date+'|'+p.number,number:p.number,train:p.category+' '+p.number,category:p.category,transportMode:'rail',countryCode:spanishStations[p.page]?'ES':'FR',observedAt:spanishStations[p.page]?.name||p.station,stationCode:p.stopId,eventMode:'departure',plannedTimestamp:p.plannedTimestamp,expectedTimestamp:expected,plannedTime:clock(p.plannedTimestamp),time:clock(p.plannedTimestamp),currentTime:clock(expected),plannedTrack:p.plannedTrack,currentTrack,track:cancelled?'—':currentTrack||p.plannedTrack||'—',delay,cancelled,hasRealtime,delayPropagated:propagated,status:cancelled?'Geannuleerd':hasRealtime&&delay?(delay>0?'+':'')+delay+' min':'',from:p.station,to:p.to,route:p.futureRoute,futureRoute:p.futureRoute,routeComplete:true,messageTimestamp:fresh?stamp:null};
 });
}
async function download(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);return new Uint8Array(await r.arrayBuffer());}
const running=new Set();
export async function scanInternational(source){
 if(running.has(source))return;running.add(source);const state=internationalState[source],def=definitions[source];
 let saved=cache.get(source)||{};
 try{const now=Date.now();if(!saved.plan||!saved.plan.platformPages||saved.day!==dayKey(now)){
  const bytes=await download(def.plan),next=await new Promise((resolve,reject)=>{const w=new Worker(new URL(import.meta.url),{workerData:{internationalBytes:bytes,source,now},transferList:[bytes.buffer]});w.once('message',resolve);w.once('error',reject);w.once('exit',c=>{if(c)reject(Error('Import mislukt'));});});
  saved={...saved,plan:next,day:dayKey(now)};cache.set(source,saved);await saveBoardCache(source+':plan',{plan:next,day:saved.day});state.lastPlanAt=new Date(now).toISOString();
 }
 const feed=decodeInternational(source,await download(def.live));if(feed.header?.incrementality===1)throw Error('Differentiële feed niet ondersteund');
 const keys=new Set(saved.plan.rows.map(planKey));saved.live={header:feed.header,entity:feed.entity.filter(e=>e.tripUpdate&&keys.has(updateKey(source,e.tripUpdate.trip)))};cache.set(source,saved);await saveBoardCache(source+':live',saved.live);
 await recordObservations(internationalRows(saved.plan,saved.live),source,Date.now());state.lastRealtimeAt=new Date(Number(feed.header.timestamp)*1000).toISOString();state.status=Date.now()-Number(feed.header.timestamp)*1000>300000?'stale':'ready';state.error=null;state.count=saved.plan.rows.length;
 }catch(e){state.status='error';state.error=String(e.message).slice(0,200);}finally{running.delete(source);}
}
export async function restoreInternational(){for(const source of Object.keys(definitions)){const saved=await loadBoardCache(source+':plan');if(saved?.plan?.rows){cache.set(source,{...saved,live:await loadBoardCache(source+':live')});internationalState[source].lastPlanAt=new Date(saved.plan.generatedAt).toISOString();}}}
export function startInternational(){for(const s of Object.keys(definitions)){void scanInternational(s);setInterval(()=>void scanInternational(s),60000).unref();}}
export function internationalPayload(page,base=null,now=Date.now()){
 const sources=Object.keys(definitions).filter(s=>Object.values(definitions[s].stops).includes(page));if(!sources.length)return base;
 const extra=sources.flatMap(s=>{const c=cache.get(s);return c?.plan?internationalRows(c.plan,c.live,now).filter(r=>r.page===page&&r.expectedTimestamp>=now-60000):[];});
 // Merge identical services independently of which source already has a platform.
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''),key=r=>[String(r.number).replace(/^0+/,''),r.plannedTimestamp,norm(r.to)].join('|');
 const merged=new Map((base?.departures?.all||[]).map(r=>[key(r),r]));for(const r of extra){const old=merged.get(key(r));if(!old||r.hasRealtime||!old.hasRealtime)merged.set(key(r),{...r,currentTrack:r.currentTrack||old?.currentTrack||'',track:r.cancelled?'—':r.currentTrack||old?.currentTrack||r.track});}
 const all=[...merged.values()].map(r=>{const track=!r.cancelled&&(r.currentTrack||frenchCurrentTrack(page,r.number,r.plannedTimestamp,now));return track?{...r,currentTrack:track,track}:r;}).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp),fern=r=>/^(EST|EUROSTAR|AVE|AVLO|ALVIA|EUROMED|INTERCITY|IC|TGV|ICE|OUIGO)/i.test(r.category);
 const ready=sources.every(s=>internationalState[s].status==='ready'),notice=spanishStations[page]?'Renfe-langeafstand en Media Distancia; Cercanías en andere Spaanse vervoerders zijn niet opgenomen.':'Aanvullende '+sources.join(' en ')+'-treinen. RER/Transilien en andere vervoerders zijn niet volledig gedekt.';
 return {...base,title:base?.title||'Vertrektijden '+spanishStations[page].name,country:spanishStations[page]?'ES':base?.country||'FR',source:[base?.source,...sources].filter(Boolean).join(' + '),lastScanAt:[base?.lastScanAt,...sources.map(s=>internationalState[s].lastRealtimeAt)].filter(Boolean).sort().at(-1)||null,status:ready&&(!base||base.status==='ready')?'ready':'partial',notice,quick:base?.quick||[],departures:{all,fernverkehr:all.filter(fern),regional:all.filter(r=>!fern(r))}};
}
if(!isMainThread&&workerData?.internationalBytes)parentPort.postMessage(parseInternational(workerData.source,workerData.internationalBytes,workerData.now));
