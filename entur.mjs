import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
import {recordObservations} from './storage.mjs';
export const norwegianStations={narvik:{name:'Narvik',id:'NSR:StopPlace:62318'},oslo:{name:'Oslo S',id:'NSR:StopPlace:59872'},bergen:{name:'Bergen',id:'NSR:StopPlace:59983'},voss:{name:'Voss',id:'NSR:StopPlace:59958'},myrdal:{name:'Myrdal',id:'NSR:StopPlace:222'},trondheim:{name:'Trondheim S',id:'NSR:StopPlace:59977'},stavanger:{name:'Stavanger',id:'NSR:StopPlace:61291'}};
export const enturState={source:'Entur',stations:Object.fromEntries(Object.entries(norwegianStations).map(([key,s])=>[key,{...s,status:'starting',lastSuccessAt:null,error:null}]))};
const cache=new Map(),timeFormat=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Oslo',hour:'2-digit',minute:'2-digit'});
const clock=t=>timeFormat.format(t);
export const enturQuery=`query Departures($id:String!){stopPlace(id:$id){id name estimatedCalls(timeRange:86400,numberOfDepartures:1000,whiteListedModes:[rail]){date stopPositionInPattern realtime aimedDepartureTime expectedDepartureTime actualDepartureTime cancellation forBoarding destinationDisplay{frontText} quay{id publicCode} serviceJourney{id publicCode privateCode transportMode transportSubmode line{publicCode transportMode transportSubmode}}}}}`;
export function enturRows(page,calls,observedAt=Date.now()){
  const station=norwegianStations[page];
  return calls.flatMap(c=>{
    if(c.serviceJourney?.transportMode!=='rail'||(!c.forBoarding&&!c.cancellation)||c.actualDepartureTime)return [];
    const planned=Date.parse(c.aimedDepartureTime);if(!Number.isFinite(planned))return [];
    const predicted=Date.parse(c.expectedDepartureTime),hasRealtime=c.realtime===true&&Number.isFinite(predicted),expected=hasRealtime?predicted:planned;
    const journey=c.serviceJourney,line=journey.line||{},category=line.publicCode||'Trein',number=journey.publicCode||journey.privateCode||'';
    const serviceDate=c.date,id=[serviceDate,journey.id,station.id,c.stopPositionInPattern].join('|');
    const track=c.quay?.publicCode||'',delay=hasRealtime?Math.round((expected-planned)/60000):0;
    return [{id,source:'ENTUR',sourceTripId:journey.id,sourceEventId:id,serviceDate,trainKey:journey.id,number,train:[category,number].filter(Boolean).join(' '),category,transportSubmode:journey.transportSubmode||line.transportSubmode,observedAt:station.name,stationCode:station.id,countryCode:'NO',eventMode:'departure',plannedTimestamp:planned,expectedTimestamp:expected,plannedTime:clock(planned),time:clock(planned),currentTime:clock(expected),plannedTrack:hasRealtime?'':track,currentTrack:hasRealtime?track:'',track:c.cancellation?'—':track||'—',delay,cancelled:Boolean(c.cancellation),hasRealtime,status:c.cancellation?'Geannuleerd':hasRealtime?(delay?`${delay>0?'+':''}${delay} min`:'Op tijd'):'',from:station.name,to:c.destinationDisplay?.frontText||'—',route:[],messageTimestamp:observedAt,rawStop:c}];
  });
}
let busy=false;
async function scan(){
  if(busy)return;busy=true;
  try{
    const results=await Promise.allSettled(Object.entries(norwegianStations).map(async([key,s])=>{
      const r=await fetch('https://api.entur.io/journey-planner/v3/graphql',{method:'POST',headers:{'Content-Type':'application/json','ET-Client-Name':'treinrondreis-liveboard'},body:JSON.stringify({query:enturQuery,variables:{id:s.id}}),signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw new Error(`Entur HTTP ${r.status}`);
      const j=await r.json();if(j.errors?.length||!Array.isArray(j.data?.stopPlace?.estimatedCalls))throw new Error('Entur gaf geen volledige stationsgegevens terug');
      const at=Date.now(),rows=enturRows(key,j.data.stopPlace.estimatedCalls,at);return {key,at,rows};
    }));
    for(let i=0;i<results.length;i++){
      const key=Object.keys(norwegianStations)[i],state=enturState.stations[key],result=results[i];
      if(result.status==='rejected'){state.status='error';state.error=String(result.reason.message).slice(0,160);continue;}
      const {at,rows}=result.value;cache.set(key,{at,rows});state.lastSuccessAt=new Date(at).toISOString();state.count=rows.length;
      try{await saveBoardCache('ENTUR:'+key,{at,rows});await recordObservations(rows,'ENTUR',at);state.status='ready';state.error=null;}catch(e){state.status='storage-error';state.error='Opslag Entur mislukt';}
    }
  }finally{busy=false;}
}
export async function restoreEntur(){for(const page of Object.keys(norwegianStations)){const saved=await loadBoardCache('ENTUR:'+page);if(saved){cache.set(page,saved);enturState.stations[page].lastSuccessAt=new Date(saved.at).toISOString();}}}
export function startEntur(){void scan();setInterval(()=>void scan(),60000).unref();}
export function norwegianPayload(page,now=Date.now()){
  if(!norwegianStations[page])return null;
  const saved=cache.get(page),state=enturState.stations[page],stale=!saved||now-saved.at>180000;
  const rows=(saved?.rows||[]).map(r=>stale?{...r,hasRealtime:false,expectedTimestamp:r.plannedTimestamp,currentTime:r.plannedTime,delay:0,status:r.cancelled?'Geannuleerd':'',currentTrack:'',track:r.cancelled?'—':r.plannedTrack||'—'}:r).filter(r=>r.expectedTimestamp>=now-60000).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp).map(({rawStop,...r})=>r);
  const fern=r=>/^(F\d|SJ)/.test(r.category)||['longDistance','international','nightRail'].includes(r.transportSubmode);
  return {title:'Vertrektijden '+norwegianStations[page].name,country:'NO',source:'Entur',lastScanAt:state.lastSuccessAt,status:stale?'stale':state.status,quick:[],departures:{all:rows,fernverkehr:rows.filter(fern),regional:rows.filter(r=>!fern(r))}};
}
