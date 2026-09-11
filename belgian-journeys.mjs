import {recordJourneySnapshot} from './journeys.mjs';

// NMBS labels the Brussels–Frankfurt ICE service TRN in its GTFS feed.
export const isBelgianIceRoute=r=>/^ICE$/i.test(r?.route_short_name||'')||(/^TRN$/i.test(r?.route_short_name||'')&&/Frankfurt/i.test(r?.route_long_name||'')&&/Brux|Bruss/i.test(r?.route_long_name||''));
const stationName=name=>({'Frankfurt Main (DE)':'Frankfurt(Main)Hbf','Frankfurt Flugh (DE)':'Frankfurt(M) Flughafen Fernbf'}[name]||name.replace(/ \(DE\)$/,''));
export function belgianIcePlans(read,stops,routes,trips,toTime,at){
 const selected=new Map([...trips].filter(([,t])=>isBelgianIceRoute(routes.get(t.route_id))).map(([id,t])=>[id,{trip:t,calls:[]}]));
 for(const r of read('stop_times.txt')){const g=selected.get(r.trip_id),s=stops.get(r.stop_id);if(g&&s)g.calls.push({...r,name:stationName(s.name),stationCode:s.parent_station||s.stop_id,platform:s.platform_code||null});}
 return [...selected].flatMap(([tripId,{trip,calls}])=>trip.days.map(date=>({trainNumber:trip.trip_short_name,serviceDate:date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6),journeyRef:tripId,archiveSource:'NMBS',source:'NMBS_GTFS',sourceTimestamp:at,category:'ICE',completePlan:true,stops:calls.sort((a,b)=>+a.stop_sequence-+b.stop_sequence).map(r=>({id:r.stationCode+'|'+r.stop_sequence,stopId:r.stop_id,station:r.name,stationCode:r.stationCode,sequence:+r.stop_sequence,stopType:r.pickup_type==='1'&&r.drop_off_type==='1'?'D':'S',arrival:r.arrival_time?{plannedTime:toTime(date,r.arrival_time),plannedPlatform:r.platform}:null,departure:r.departure_time?{plannedTime:toTime(date,r.departure_time),plannedPlatform:r.platform}:null}))})));
}
export function belgianIceUpdates(plans,feed,now=Date.now()){
 const at=Number(feed?.header?.timestamp)*1000;if(!Number.isFinite(at)||now-at>180000||at>now+60000)return [];
 const updates=new Map((feed.entity||[]).filter(e=>e.tripUpdate?.trip?.startDate).map(e=>[e.tripUpdate.trip.tripId+'|'+e.tripUpdate.trip.startDate,e.tripUpdate]));
 return plans.flatMap(p=>{const u=updates.get(p.journeyRef+'|'+p.serviceDate.replaceAll('-',''));if(!u)return [];
 const stops=p.stops.flatMap(s=>{const v=u.stopTimeUpdate?.find(x=>Number(x.stopSequence)===s.sequence),cancelled=Number(u.trip.scheduleRelationship)===3||Number(v?.scheduleRelationship)===1;const result={...s,arrival:null,departure:null};
 for(const mode of ['arrival','departure']){const e=v?.[mode],planned=s[mode]?.plannedTime;if(planned==null||Number(v?.scheduleRelationship)===2&&!cancelled)continue;const expected=Number.isFinite(e?.time)?e.time*1000:Number.isFinite(e?.delay)?planned+e.delay*1000:null;if(expected!=null||cancelled)result[mode]={realtime:true,expectedTime:expected,cancelled};}
 return result.arrival||result.departure?[result]:[];});
 return stops.length?[{...p,source:'NMBS_RT',sourceTimestamp:at,completePlan:false,stops}]:[];
 });
}
export async function archiveBelgianIce(plans,feed,now=Date.now()){
 for(const p of plans||[])await recordJourneySnapshot(p);
 for(const p of belgianIceUpdates(plans||[],feed,now))await recordJourneySnapshot(p);
}
