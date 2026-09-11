import {recordJourneySnapshot,selectedJourney} from './journeys.mjs';
import {swissQuick} from './swiss-directions.mjs';
import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {recordObservations} from './storage.mjs';

// StopPlace identifiers verified with OJP LocationInformation, September 2026.
export const swissStations=Object.fromEntries([
  ['visp','Visp','1605'],['chur','Chur','9000'],['basel-sbb','Basel SBB','10'],['zuerich','Zürich HB','3000'],
  ['luzern','Luzern','5000'],['interlaken-ost','Interlaken Ost','7492'],['interlaken-west','Interlaken West','7493'],
  ['bern','Bern','7000'],['spiez','Spiez','7483'],['thun','Thun','7100'],['kandersteg','Kandersteg','7475'],
  ['zermatt','Zermatt','1689'],['taesch','Täsch','1688'],['montreux','Montreux','1300'],['lausanne','Lausanne','1120'],
  ['brig','Brig','1609'],['andermatt','Andermatt','5165'],['goeschenen','Göschenen','5119'],
  ['disentis','Disentis/Mustér','9179'],['filisur','Filisur','9195'],['alp-gruem','Alp Grüm','9357'],
  ['tirano','Tirano','9369'],['lugano','Lugano','5300'],['bellinzona','Bellinzona','5213'],
  ['flueelen','Flüelen','5112'],['schaffhausen','Schaffhausen','3424'],['st-gallen','St. Gallen','6302'],
  ['sargans','Sargans','9411'],['landquart','Landquart','9002'],['st-moritz','St. Moritz','9253']
].map(([key,name,id])=>[key,{name,id:'ch:1:sloid:'+id,country:key==='tirano'?'IT':'CH'}]));
swissStations['interlaken-ost'].boatId='ch:1:sloid:8370';
swissStations['interlaken-west'].boatId='ch:1:sloid:7169';
swissStations.thun.boatId='ch:1:sloid:7150';
swissStations.brig.extraStopIds=['ch:1:sloid:15296'];
swissStations.tirano.notice='Dit bord toont de RhB-treinen in Tirano. Italiaanse treinen richting Milaan zijn niet opgenomen.';
export const swissState={source:'OJP',pollIntervalSeconds:180,stations:Object.fromEntries(Object.entries(swissStations).map(([key,s])=>[key,{...s,status:'starting',lastSuccessAt:null,error:null}]))};
const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false,ignoreAttributes:true});
const list=v=>v==null?[]:Array.isArray(v)?v:[v];
const text=v=>typeof v==='object'&&v!==null?text(v.Text??v['#text']??''):String(v??'');
const yes=v=>v===true||v==='true'||v==='1';
const clockFormat=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Zurich',hour:'2-digit',minute:'2-digit'});
const clock=t=>clockFormat.format(t);
const escapeXml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const cache=new Map(),MAX_AGE=7*60000;

export function swissRequest(page,now=Date.now(),stopId=swissStations[page]?.id){
  const s=swissStations[page],at=new Date(now).toISOString();
  if(!s)throw new Error('Onbekend station');
  return `<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0"><OJPRequest><siri:ServiceRequest><siri:ServiceRequestContext><siri:Language>de</siri:Language></siri:ServiceRequestContext><siri:RequestTimestamp>${at}</siri:RequestTimestamp><siri:RequestorRef>Treinrondreis_prod</siri:RequestorRef><OJPStopEventRequest><siri:RequestTimestamp>${at}</siri:RequestTimestamp><Location><PlaceRef><StopPlaceRef>${stopId}</StopPlaceRef><Name><Text>${escapeXml(s.name)}</Text></Name></PlaceRef><DepArrTime>${at}</DepArrTime></Location><Params><ModeFilter><Exclude>false</Exclude><PtMode>${stopId===s.boatId?'water':'rail'}</PtMode></ModeFilter><NumberOfResults>3000</NumberOfResults><StopEventType>both</StopEventType><IncludePreviousCalls>true</IncludePreviousCalls><IncludeOnwardCalls>true</IncludeOnwardCalls><UseRealtimeData>explanatory</UseRealtimeData><IncludePlacesContext>false</IncludePlacesContext><IncludeSituationsContext>false</IncludeSituationsContext></Params></OJPStopEventRequest></siri:ServiceRequest></OJPRequest></OJP>`;
}

export function swissRows(page,xml,now=Date.now()){
  if(XMLValidator.validate(xml)!==true)throw new Error('OJP gaf ongeldige XML terug');
  const delivery=parser.parse(xml)?.OJP?.OJPResponse?.ServiceDelivery;
  const data=delivery?.OJPStopEventDelivery;
  if(!data||delivery.Status==='false'||data.Status==='false'||data.ErrorCondition||delivery.ErrorCondition)throw new Error('OJP kon de vertrekgegevens niet leveren');
  const sourceAt=Date.parse(data.ResponseTimestamp||delivery.ResponseTimestamp);
  if(!Number.isFinite(sourceAt)||sourceAt>now+60000||now-sourceAt>MAX_AGE)throw new Error('OJP-antwoord is niet actueel');
  const s=swissStations[page],seen=new Set();
  const rows=list(data.StopEventResult).flatMap(result=>{
    const e=result.StopEvent,c=e?.ThisCall?.CallAtStop,service=e?.Service;
    if(!c||!['rail','water'].includes(service?.Mode?.PtMode))return [];
    // A platform may change, so identity uses the station and call order, not the quay.
    const stopRef=String(c.StopPointRef||'');
    const stopId=[s.id,...s.extraStopIds||[],s.boatId].filter(Boolean).find(id=>stopRef===id||stopRef.startsWith(id+':')||stopRef.startsWith(id+'_gen:'+id+':'));
    if(!stopId)return [];
    const category=text(service.ProductCategory?.ShortName)||text(service.Mode?.ShortName)||'Trein';
    const label=text(service.PublicCode)||text(service.PublishedServiceName)||category;
    if(/^(DZ|FLX|WB)(?:\d|\s|$)/i.test(label)||/^(DZ|FLX|WB)$/i.test(category)||/flixtrain|westbahn/i.test(text(service.PublishedServiceName)))return [];
    const planned=Date.parse(c.ServiceDeparture?.TimetabledTime);
    if(!Number.isFinite(planned))return [];
    const estimate=Date.parse(c.ServiceDeparture?.EstimatedTime),hasRealtime=Number.isFinite(estimate);
    const expected=hasRealtime?estimate:planned;
    if(expected<now-60000||planned>now+86400000)return [];
    const cancelled=yes(service.Cancelled)||yes(c.Cancelled)||yes(c.NotServicedStop);
    if(yes(c.NoBoardingAtStop)&&!cancelled)return [];
    const number=text(service.TrainNumber),journey=text(service.JourneyRef),serviceDate=text(service.OperatingDayRef);
    if(!journey||!serviceDate)throw new Error('OJP-ritidentificatie ontbreekt');
    const id=[serviceDate,journey,stopId,c.Order||planned].join('|');
    if(seen.has(id))return [];seen.add(id);
    const plannedTrack=text(c.PlannedQuay),currentTrack=text(c.EstimatedQuay),delay=hasRealtime?Math.round((expected-planned)/60000):0;
    return [{id,source:'OJP',sourceTripId:journey,sourceEventId:id,serviceDate,trainKey:serviceDate+'|'+journey,number,train:service.Mode.PtMode==='water'?'Boot '+(number||label):[label,number].filter(Boolean).join(' '),category,line:label,transportMode:service.Mode.PtMode,serviceName:text(service.PublishedServiceName),transportSubmode:service.Mode.RailSubmode,
      observedAt:s.name,stationCode:s.id,countryCode:s.country,eventMode:'departure',plannedTimestamp:planned,expectedTimestamp:expected,plannedTime:clock(planned),time:clock(planned),currentTime:clock(expected),
      plannedTrack,currentTrack,track:cancelled?'—':currentTrack||plannedTrack||'—',delay,cancelled,hasRealtime,status:cancelled?'Geannuleerd':hasRealtime?(delay?`${delay>0?'+':''}${delay} min`:'Op tijd'):'',
      from:text(service.OriginText)||s.name,to:text(service.DestinationText)||'—',route:list(e.OnwardCall).map(v=>text(v.CallAtStop?.StopPointName)).filter(Boolean),futureRoute:list(e.OnwardCall).map(v=>text(v.CallAtStop?.StopPointName)).filter(Boolean),routeComplete:true,messageTimestamp:sourceAt,rawStop:{call:c,service}}];
  });
  return {rows,sourceAt};
}

export function swissJourneySnapshots(xml,now=Date.now()){
 if(XMLValidator.validate(xml)!==true)throw Error('OJP gaf ongeldige XML terug');
 const delivery=parser.parse(xml)?.OJP?.OJPResponse?.ServiceDelivery,data=delivery?.OJPStopEventDelivery;
 const sourceTimestamp=Date.parse(data?.ResponseTimestamp||delivery?.ResponseTimestamp);
 if(!data||data.ErrorCondition||data.Status==='false'||!Number.isFinite(sourceTimestamp)||sourceTimestamp>now+60000||now-sourceTimestamp>MAX_AGE)throw Error('OJP ritgegevens niet actueel');
 const results=new Map();
 for(const r of list(data.StopEventResult)){
  const e=r.StopEvent,service=e?.Service,number=text(service?.TrainNumber),category=text(service?.ProductCategory?.ShortName)||text(service?.Mode?.ShortName);
  if(!service||!selectedJourney(number,category)||!/^\d+$/.test(number))continue;
  const journeyRef=text(service.JourneyRef),serviceDate=text(service.OperatingDayRef);if(!journeyRef||!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate))continue;
  const calls=[...list(e.PreviousCall),...list(e.ThisCall),...list(e.OnwardCall)].map(x=>x.CallAtStop).filter(Boolean);
  const seen=new Set(),counts=new Map(),stops=[];
  for(const c of calls){
   const station=text(c.StopPointName),identity=station.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const callKey=JSON.stringify([identity,c.Order,c.ServiceArrival?.TimetabledTime,c.ServiceDeparture?.TimetabledTime]);if(seen.has(callKey))continue;seen.add(callKey);
   const occurrence=(counts.get(identity)||0)+1;counts.set(identity,occurrence);
   const event=v=>{if(!v)return null;const plannedTime=Date.parse(v.TimetabledTime),expectedTime=Date.parse(v.EstimatedTime);if(!Number.isFinite(plannedTime))return null;return {plannedTime,plannedPlatform:text(c.PlannedQuay)||null,realtime:Number.isFinite(expectedTime)||yes(c.Cancelled)||yes(service.Cancelled),expectedTime:Number.isFinite(expectedTime)?expectedTime:null,currentPlatform:text(c.EstimatedQuay)||null,cancelled:yes(c.Cancelled)||yes(c.NotServicedStop)||yes(service.Cancelled)};};
   stops.push({id:identity+'#'+occurrence,stationCode:text(c.StopPointRef),station,sequence:stops.length+1,stopType:yes(c.NoBoardingAtStop)&&yes(c.NoAlightingAtStop)?'N':undefined,arrival:event(c.ServiceArrival),departure:event(c.ServiceDeparture)});
  }
  if(!stops.length)continue;
  const completePlan=stops[0].station===text(service.OriginText)&&stops.at(-1).station===text(service.DestinationText);
  const snapshot={trainNumber:number,serviceDate,journeyRef,category,source:'OJP',sourceTimestamp,completePlan,stops};
  const id=serviceDate+'|'+journeyRef,old=results.get(id);if(!old||stops.length>old.stops.length)results.set(id,snapshot);
 }
 return [...results.values()];
}

export function mergeSwissRows(rows){
  const groups=new Map();
  for(const r of rows){
    const key=r.track&&r.track!=='—'&&r.to!=='—'?JSON.stringify([r.plannedTimestamp,r.track,r.to,r.cancelled,r.delay,r.hasRealtime]):r.id;
    const previous=groups.get(key);
    if(!previous)groups.set(key,{...r,trainLabels:[r.train]});
    else if(!previous.trainLabels.includes(r.train)){previous.trainLabels.push(r.train);previous.train=previous.trainLabels.join(' / ');}
  }
  return [...groups.values()].map(({trainLabels,...r})=>r);
}

export async function scanSwissStation(page,{fetcher=fetch,store=recordObservations,now=()=>Date.now(),key=process.env.OJP_API_KEY,archive=recordJourneySnapshot}={}){
  const state=swissState.stations[page];
  if(!state)throw new Error('Onbekend station');
  if(!key?.trim()){state.status='missing-key';state.error='OJP_API_KEY ontbreekt';return;}
  try{
    const results=[];
    for(const stopId of [swissStations[page].id,...swissStations[page].extraStopIds||[],swissStations[page].boatId].filter(Boolean)){
      const response=await fetcher('https://api.opentransportdata.swiss/ojp20',{method:'POST',headers:{'Content-Type':'application/xml',Authorization:'Bearer '+key.trim().replace(/^Bearer\s+/i,''),'User-Agent':'Treinrondreis/1.0'},body:swissRequest(page,now(),stopId),signal:AbortSignal.timeout(25000)});
      if(!response.ok)throw new Error('OJP HTTP '+response.status);
      const xml=await response.text();
      results.push(swissRows(page,xml,now()));
      for(const snapshot of swissJourneySnapshots(xml,now()))await archive(snapshot);
    }
    const at=now(),rows=results.flatMap(r=>r.rows),sourceAt=Math.min(...results.map(r=>r.sourceAt));
    cache.set(page,{at:sourceAt,rows});state.lastSuccessAt=new Date(sourceAt).toISOString();state.count=rows.length;state.realtimeCount=rows.filter(r=>r.hasRealtime).length;state.status='ready';state.error=null;
    try{await saveBoardCache('OJP:'+page,{at:sourceAt,rows});await store(rows,'OJP',at);state.lastStoredAt=new Date(at).toISOString();}catch{state.status='storage-error';state.error='Opslag OJP mislukt';}
  }catch(e){state.status='error';state.error=/^OJP/.test(e.message)?e.message:'OJP tijdelijk niet bereikbaar';}
}

let started=false;
export async function restoreSwiss(){for(const page of Object.keys(swissStations)){const saved=await loadBoardCache('OJP:'+page);if(saved){cache.set(page,saved);swissState.stations[page].lastSuccessAt=new Date(saved.at).toISOString();}}}
export function startSwiss(){
  if(started)return;started=true;
  const pages=Object.keys(swissStations);let index=0,requests=0;
  async function tick(){
    const start=Date.now(),page=pages[index];
    await scanSwissStation(page);index=(index+1)%pages.length;requests++;
    // Warm up once; thereafter ~14,400 calls/day, below the 20,000/day quota.
    const interval=requests<pages.length?1600:180000/pages.length;
    const backoff=swissState.stations[page].error==='OJP HTTP 429'?60000:0;
    setTimeout(()=>void tick(),Math.max(0,interval-(Date.now()-start),backoff)).unref();
  }
  void tick();
}

export function swissPayload(page,now=Date.now()){
  if(!Object.hasOwn(swissStations,page))return null;
  const saved=cache.get(page),state=swissState.stations[page],stale=!saved||now-saved.at>MAX_AGE;
  const rows=(saved?.rows||[]).map(r=>stale?{...r,hasRealtime:false,expectedTimestamp:r.plannedTimestamp,currentTime:r.plannedTime,delay:0,status:r.cancelled?'Geannuleerd':'',currentTrack:'',track:r.cancelled?'—':r.plannedTrack||'—'}:r)
    .filter(r=>r.expectedTimestamp>=now-60000).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp).map(({rawStop,...r})=>r);
  const fern=r=>r.transportMode!=='water'&&/^(IC|ICE|EC|ECE|IR|TGV|RJ|RJX|NJ|EN|PE|BEX|GEX)$/.test(r.category);
  return {title:'Vertrektijden '+swissStations[page].name,country:swissStations[page].country,source:'OJP',notice:swissStations[page].notice||'',lastScanAt:state.lastSuccessAt,status:!saved?state.status:stale?'stale':state.status,quick:swissQuick(page,mergeSwissRows(rows)),departures:{all:mergeSwissRows(rows),fernverkehr:mergeSwissRows(rows.filter(fern)),regional:mergeSwissRows(rows.filter(r=>!fern(r)))}};
}
