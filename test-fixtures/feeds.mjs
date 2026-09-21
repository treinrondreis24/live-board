// Small synthetic feeds. No downloads, credentials or files outside the checkout.
import {zipSync,strToU8} from 'fflate';
import GTFS from 'gtfs-realtime-bindings';
export const zip=files=>zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])));
export function belgianFixture(){return zip({
 'routes.txt':'route_id,route_short_name,route_long_name\nr,TRN,Bruxelles -- Frankfurt\n',
 'trips.txt':'route_id,service_id,trip_id,trip_short_name,trip_headsign\nr,s,ice13,13,Frankfurt\n',
 'calendar_dates.txt':'service_id,date,exception_type\ns,20260819,1\n',
 'stops.txt':'stop_id,stop_name,parent_station,platform_code\n'+['Bruxelles-Midi','Bruxelles-Nord','Liège','Aachen Hbf (DE)','Köln Hbf (DE)','Frankfurt Main (DE)'].map((n,i)=>`s${i},${n},${i===0?'gs:nmbssncb:S8814001':'station'+i},${i+1}`).join('\n'),
 'stop_times.txt':'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n'+Array.from({length:6},(_,i)=>`ice13,${10+i}:00:00,${10+i}:02:00,s${i},${i+1},0,0`).join('\n')
});}
export function frenchFixture(stations){
 const entries=Object.entries(stations),now=Date.parse('2026-09-10T08:00:00Z');
 const bytes=zip({
 'routes.txt':'route_id,route_type\nr,2\n',
 'calendar_dates.txt':'service_id,date,exception_type\ns,20260910,1\n',
 'trips.txt':'route_id,service_id,trip_id,trip_short_name\n'+entries.map(([p],i)=>`r,s,trip-${p},${100+i}`).join('\n'),
 'stops.txt':'stop_id,stop_name,parent_station\nend,Test terminus,\n'+entries.map(([p,s],i)=>`StopPoint:OCETGV-${i},${s.name},StopArea:OCE${s.uic}`).join('\n'),
 'stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type\n'+entries.flatMap(([p],i)=>[`trip-${p},StopPoint:OCETGV-${i},1,12:00:00,12:01:00,0`,`trip-${p},end,2,13:00:00,13:01:00,0`]).join('\n')
 });
 const live=GTFS.transit_realtime.FeedMessage.encode(GTFS.transit_realtime.FeedMessage.create({header:{gtfsRealtimeVersion:'2.0',timestamp:now/1000},entity:[{id:'live',tripUpdate:{trip:{tripId:'trip-paris-est',startDate:'20260910'},stopTimeUpdate:[{stopSequence:1,departure:{delay:120}}]}}]})).finish();
 return {bytes,live};
}
export function stationFixture(){return zip({'stations.dat':'@synthetic station catalog\n1,AC,0,0,NL,Abcoude\n1,UT,0,0,NL,Utrecht Centraal\n1,BRU,0,0,BE,Brussel\n2,OTHER,0,0,NL,Not a station\n'+Array.from({length:405},(_,i)=>`1,T${i},0,0,NL,Teststation ${i}`).join('\n')});}
