import {loadBoardCache,saveBoardCache} from './board-cache.mjs';
import {recordObservations} from './storage.mjs';

export const rfiStations={milano:{name:'Milano Centrale',id:1728},monza:{name:'Monza',id:1841},tirano:{name:'Tirano',id:2850}};
export const rfiState={source:'RFI',stations:Object.fromEntries(Object.entries(rfiStations).map(([k,s])=>[k,{...s,status:'starting',lastSuccessAt:null}]))};
const cache=new Map(),zone='Europe/Rome',maxAge=300000;
const fmt=new Intl.DateTimeFormat('nl-NL',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const decode=s=>String(s).replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[n]));
const clean=s=>decode(String(s).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function localTimestamp(y,m,d,h,minute,second=0){
 const target=Date.UTC(y,m-1,d,h,minute,second);let t=target;
 for(let i=0;i<3;i++){const p=Object.fromEntries(parts.formatToParts(t).map(v=>[v.type,v.value]));const diff=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-target;if(!diff)break;t-=diff;}return t;
}
export function parseRfi(page,html){
 const station=rfiStations[page];if(!station)throw Error('Onbekend RFI-station');
 const title=clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
 if(title.toUpperCase()!==station.name.toUpperCase())throw Error('RFI-station komt niet overeen');
 const date=clean(html).match(/aggiornato il (\d{2})\/(\d{2})\/(\d{4}) alle ore (\d{2}):(\d{2}):(\d{2})/i);
 if(!date||!html.includes('RTreno')&&!html.includes('HTreno'))throw Error('RFI-monitor niet herkend');
 const [,dd,mm,yy,hh,mi,ss]=date.map(Number),at=localTimestamp(yy,mm,dd,hh,mi,ss),rows=[];
 for(const match of html.matchAll(/<tr\b[^>]*name="treno"[^>]*>([\s\S]*?)<\/tr>/gi)){
  const block=match[1],cell=id=>block.match(new RegExp('<td\\b[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)<\\/td>','i'))?.[1]||'';
  const number=clean(cell('RTreno')),time=clean(cell('ROrario')),to=clean(cell('RStazione'));if(!number&&!time&&!to)continue;if(!/^\d+$/.test(number)||!/^\d{2}:\d{2}$/.test(time)||!to)throw Error('Onvolledige RFI-trein');
  const [hour,minute]=time.split(':').map(Number);let planned=localTimestamp(yy,mm,dd,hour,minute);
  // A monitor spans midnight; large positive gaps are yesterday's delayed trains.
  if(planned-at>18*3600000)planned=localTimestamp(yy,mm,dd-1,hour,minute);
  if(at-planned>18*3600000)planned=localTimestamp(yy,mm,dd+1,hour,minute);
  const categoryName=decode(cell('RCategoria').match(/alt="([^"]*)"/i)?.[1]||clean(cell('RCategoria'))).replace(/^Categoria\s*/i,'').trim()||'Trein';
  const operatorName=decode(cell('RVettore').match(/alt="([^"]*)"/i)?.[1]||'');
  const category=({FRECCIAROSSA:'FR',FRECCIARGENTO:'FA',FRECCIABIANCA:'FB',ITALO:'ITALO'}[operatorName]||{INTERCITY:'IC','INTERCITY NOTTE':'ICN',"ALTA VELOCITA'":'AV'}[categoryName]||categoryName);
  const delayText=clean(cell('RRitardo')),details=[...block.matchAll(/<div class="testoinfoaggiuntive"[^>]*>([\s\S]*?)<\/div>/g)].map(m=>clean(m[1]));
  const cancelled=/soppresso|cancellato/i.test(delayText+' '+details.join(' ')),delay=/^\d+$/.test(delayText)?Number(delayText):0;
  const stops=[...details.filter(t=>/^FERMA A:/i.test(t)).join(' ').replace(/^FERMA A:/i,'').matchAll(/(?:^| - )\s*(.*?)\s*\((\d{1,2}:\d{2})\)/g)].map(m=>({name:m[1].trim(),time:m[2]}));
  const futureRoute=stops.map(s=>s.name);if(!futureRoute.includes(to))futureRoute.push(to);
  const track=clean(cell('RBinario')),p=Object.fromEntries(parts.formatToParts(planned).map(v=>[v.type,v.value])),serviceDate=p.year+'-'+p.month+'-'+p.day;
  const id=['RFI',station.id,serviceDate,number,time].join('|'),expected=planned+delay*60000;
  rows.push({id,source:'RFI',sourceTripId:serviceDate+'|'+number,sourceEventId:id,serviceDate,trainKey:serviceDate+'|'+number,number,train:category+' '+number,category,operatorName,transportMode:'rail',countryCode:'IT',observedAt:station.name,stationCode:String(station.id),eventMode:'departure',plannedTimestamp:planned,expectedTimestamp:expected,plannedTime:time,time,currentTime:fmt.format(expected),plannedTrack:'',currentTrack:track,track:cancelled?'—':track||'—',delay,cancelled,hasRealtime:true,status:cancelled?'Geannuleerd':delay?'+'+delay+' min':delayText,from:station.name,to,route:futureRoute,futureRoute,routeComplete:false,stops,messageTimestamp:at});
 }
 return {at,rows};
}
let busy=false;
export async function scanRfi(){
 if(busy)return;busy=true;
 try{for(const [page,s] of Object.entries(rfiStations)){const state=rfiState.stations[page];try{
  const r=await fetch('https://iechub.rfi.it/ArriviPartenze/ArrivalsDepartures/Monitor?arrivals=False&placeId='+s.id,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('RFI HTTP '+r.status);
  const data=parseRfi(page,await r.text());if(Date.now()-data.at>maxAge||data.at>Date.now()+60000)throw Error('RFI-monitor is niet actueel');
  cache.set(page,data);state.lastSuccessAt=new Date(data.at).toISOString();state.count=data.rows.length;
  await saveBoardCache('RFI:'+page,data);await recordObservations(data.rows,'RFI',data.at);state.status='ready';state.error=null;
 }catch(e){state.status='error';state.error=String(e.message).slice(0,160);}}}finally{busy=false;}
}
export async function restoreRfi(){for(const page of Object.keys(rfiStations)){const data=await loadBoardCache('RFI:'+page);if(data?.rows){cache.set(page,data);rfiState.stations[page].lastSuccessAt=new Date(data.at).toISOString();}}}
export function startRfi(){void scanRfi();setInterval(()=>void scanRfi(),60000).unref();}
export function rfiPayload(page,swiss=null,now=Date.now()){
 const saved=cache.get(page),state=rfiState.stations[page],stale=!saved||now-saved.at>maxAge;
 const rows=(saved?.rows||[]).map(r=>stale?{...r,hasRealtime:false,delay:0,status:'',cancelled:false,currentTrack:'',track:'—',expectedTimestamp:r.plannedTimestamp,currentTime:r.plannedTime}:r).filter(r=>r.expectedTimestamp>=now-60000);
 const all=[...rows,...(swiss?.departures?.all||[])].sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
 const fern=r=>/^(FR|FA|FB|AV|IC|ICN|EC|ECE|EN|NJ|ITALO|GEX|BEX|PE)$/i.test(r.category)||/freccia|italo|intercity/i.test(r.category+' '+r.operatorName);
 return {title:'Vertrektijden '+rfiStations[page].name,country:'IT',source:swiss?'RFI + OJP':'RFI',lastScanAt:state.lastSuccessAt,status:stale?'stale':swiss&&swiss.status!=='ready'?'partial':'ready',notice:(swiss?'Italiaanse treinen: RFI. RhB-treinen: OJP. ':'')+'RFI toont de komende vertrekken; de informatie kan tot drie minuten achterlopen.'+(stale?' RFI-actualisatie tijdelijk niet beschikbaar.':''),quick:swiss?.quick||[],departures:{all,fernverkehr:all.filter(fern),regional:all.filter(r=>!fern(r))}};
}
