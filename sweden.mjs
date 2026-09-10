import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
import {recordObservations} from './storage.mjs';
export const swedishStations=Object.fromEntries([['stockholm','Stockholm Central'],['malmo','Malmö Central'],['goteborg','Göteborg Central'],['lulea','Luleå Central'],['abisko','Abisko Östra'],['abisko-turiststation','Abisko Turiststation'],['boden','Boden Central'],['kiruna','Kiruna'],['haparanda','Haparanda']].map(([id,name])=>[id,{name}]));
export const swedenState={source:'TRAFIKVERKET',status:'starting',error:null,lastSuccessAt:null,stations:{}};
const cache=new Map();let stations=[],busy=false;
const clock=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'}).format(t);
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/centralstation|central| c$/g,'').replace(/[^a-z0-9]/g,'');
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function resolveSwedishStations(list){return Object.fromEntries(Object.entries(swedishStations).map(([page,s])=>[page,list.find(r=>[r.AdvertisedLocationName,r.LocationInformationText].some(n=>norm(n)===norm(s.name)))?.LocationSignature||null]));}
export function swedishRows(page,items,list,at=Date.now()){
 const names=new Map(list.map(s=>[s.LocationSignature,s.AdvertisedLocationName]));
 const place=s=>names.get(s)||s;
 return items.flatMap(r=>{
  const planned=Date.parse(r.AdvertisedTimeAtLocation);if(r.ActivityType!=='Avgang'||r.Advertised===false||r.Deleted||!Number.isFinite(planned)||r.TimeAtLocation)return [];
  const predicted=Date.parse(r.EstimatedTimeAtLocation),hasRealtime=Number.isFinite(predicted),expected=hasRealtime?predicted:planned;
  const number=String(r.AdvertisedTrainIdent||''),category=(r.ProductInformation||[]).map(x=>x.Description).filter(Boolean).join(' ')||'Trein';
  const dest=(r.ToLocation||[]).map(x=>place(x.LocationName)),via=(r.ViaToLocation||[]).map(x=>place(x.LocationName));
  const date=r.DepartureDateOTN?.slice(0,10)||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(planned);
  const id=r.ActivityId||[date,number,r.LocationSignature,planned].join('|'),track=r.TrackAtLocation||'',cancelled=r.Canceled===true,delay=hasRealtime?Math.round((expected-planned)/60000):0;
  return [{id,source:'TRAFIKVERKET',sourceTripId:date+'|'+number,sourceEventId:id,serviceDate:date,trainKey:date+'|'+number,number,category,train:category+' '+number,transportMode:'rail',observedAt:swedishStations[page].name,stationCode:r.LocationSignature,countryCode:'SE',eventMode:'departure',plannedTimestamp:planned,expectedTimestamp:expected,plannedTime:clock(planned),time:clock(planned),currentTime:clock(expected),plannedTrack:'',currentTrack:track,track:cancelled?'—':track||'—',delay,cancelled,hasRealtime,status:cancelled?'Geannuleerd':delay?`${delay>0?'+':''}${delay} min`:'',from:swedishStations[page].name,to:dest.join(' / ')||'—',futureStops:[...via,...dest],route:[...via,...dest],messageTimestamp:at}];
 });
}
async function request(query){
 const key=process.env.TRAFIKVERKET_API_KEY;if(!key)throw Error('TRAFIKVERKET_API_KEY ontbreekt');
 const response=await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json',{method:'POST',headers:{'Content-Type':'text/xml'},body:`<REQUEST><LOGIN authenticationkey="${xml(key)}"/>${query}</REQUEST>`,signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('Trafikverket HTTP '+response.status);
 const data=await response.json(),result=data.RESPONSE?.RESULT;
 if(!Array.isArray(result)||result.some(r=>r.ERROR)||data.RESPONSE?.ERROR)throw Error('Trafikverket weigert de aanvraag; controleer sleutel en schema');
 return result;
}
export async function scanSweden(){
 if(busy)return;busy=true;
 try{
  if(!stations.length){const result=await request('<QUERY objecttype="TrainStation" schemaversion="1.4"><INCLUDE>LocationSignature</INCLUDE><INCLUDE>AdvertisedLocationName</INCLUDE><INCLUDE>LocationInformationText</INCLUDE></QUERY>');stations=result[0].TrainStation;if(!Array.isArray(stations))throw Error('Geen stations ontvangen');}
  const resolved=resolveSwedishStations(stations),codes=Object.values(resolved).filter(Boolean);if(!codes.length)throw Error('Stations niet gevonden');
  const result=await request(`<QUERY objecttype="TrainAnnouncement" schemaversion="1.9" orderby="AdvertisedTimeAtLocation" limit="10000"><FILTER><AND><EQ name="ActivityType" value="Avgang"/><EQ name="Advertised" value="true"/><IN name="LocationSignature" value="${xml(codes.join(','))}"/><GT name="AdvertisedTimeAtLocation" value="$dateadd(-06:00:00)"/><LT name="AdvertisedTimeAtLocation" value="$dateadd(1.00:00:00)"/></AND></FILTER></QUERY>`);
  const items=result[0].TrainAnnouncement;if(!Array.isArray(items)||items.length>=10000)throw Error('Onvolledige vertrekgegevens');
  const at=Date.now();
  for(const [page,code] of Object.entries(resolved)){
   if(!code){swedenState.stations[page]={status:'not-found'};continue;}
   const rows=swedishRows(page,items.filter(r=>r.LocationSignature===code),stations,at);cache.set(page,{at,rows});await saveBoardCache('TRAFIKVERKET:'+page,{at,rows});await recordObservations(rows,'TRAFIKVERKET',at);swedenState.stations[page]={status:'ready',code,count:rows.length};
  }
  swedenState.status='ready';swedenState.error=null;swedenState.lastSuccessAt=new Date(at).toISOString();
 }catch(e){swedenState.status='error';swedenState.error=e.message;}finally{busy=false;}
}
export async function restoreSweden(){for(const page of Object.keys(swedishStations)){const saved=await loadBoardCache('TRAFIKVERKET:'+page);if(saved)cache.set(page,saved);}}
export function startSweden(){void scanSweden();setInterval(()=>void scanSweden(),60000).unref();}
export function swedishPayload(page,now=Date.now()){
 if(!Object.hasOwn(swedishStations,page))return null;
 const saved=cache.get(page),stale=!saved||now-saved.at>180000;
 const rows=(saved?.rows||[]).map(r=>stale?{...r,hasRealtime:false,delay:0,status:r.cancelled?'Geannuleerd':'',expectedTimestamp:r.plannedTimestamp,currentTime:r.plannedTime,currentTrack:'',track:'—'}:r).filter(r=>r.expectedTimestamp>=now-60000).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
 const fern=r=>/snabbtåg|nattåg|intercity|eurocity|x2000|x 2000/i.test(r.category);
 return {title:'Vertrektijden '+swedishStations[page].name,country:'SE',source:'TRAFIKVERKET',lastScanAt:saved?new Date(saved.at).toISOString():null,status:stale?'stale':swedenState.status,quick:[],departures:{all:rows,fernverkehr:rows.filter(fern),regional:rows.filter(r=>!fern(r))}};
}
