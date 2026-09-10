import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {unzipSync} from 'fflate';
import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
const dayKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
const clock=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}).format(t);
const wallFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function localTime(date,minutes){
 const wall=Date.parse(date)+(minutes*60000);let result=wall;
 for(let i=0;i<3;i++){const p=Object.fromEntries(wallFormat.formatToParts(result).map(x=>[x.type,x.value]));result+=wall-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);}
 return result;
}
export function parseDutchPlan(bytes,stations,now=Date.now()){
 const files=unzipSync(bytes,{filter:f=>['delivery.dat','footnote.dat','stations.dat','timetbls.dat'].includes(f.name)&&f.originalSize<100*1024*1024});
 const read=f=>{if(!files[f])throw Error('IFF ontbreekt: '+f);return new TextDecoder('windows-1252').decode(files[f]);};
 const fields=read('delivery.dat').trim().split(','),date=s=>s.slice(4,8)+'-'+s.slice(2,4)+'-'+s.slice(0,2),start=date(fields[1]),end=date(fields[2]);
 const notes=new Map(read('footnote.dat').split('#').slice(1).map(b=>{const l=b.split(/[\r\n]+/).filter(Boolean);return [l[0].trim(),l.slice(1).join('').trim()];}));
 const names=new Map(read('stations.dat').split(/[\r\n]+/).filter(l=>l&&!l.startsWith('@')).map(l=>{const f=l.split(',');return [f[1].trim().toUpperCase(),f.at(-1).trim()];}));
 const selected=new Map(stations.map(s=>[s.code.toUpperCase(),s.name])),rows=[];
 const firstDate=dayKey(now-86400000),lastDate=dayKey(now+2*86400000);
 for(const block of read('timetbls.dat').split('#').slice(1)){
  const lines=block.split(/[\r\n]+/).filter(Boolean),records=prefix=>lines.filter(l=>l[0]===prefix).map(l=>l.slice(1).split(',').map(s=>s.trim()));
  if(!lines.some(l=>['>','+','.'].includes(l[0])&&selected.has(l.slice(1).split(',')[0].trim().toUpperCase())))continue;
  const services=records('%'),running=records('-'),categories=records('&');
  for(let day=Date.parse(firstDate);day<=Date.parse(lastDate);day+=86400000){
   const serviceDate=new Date(day).toISOString().slice(0,10);if(serviceDate<start||serviceDate>end)continue;
   const index=Math.round((day-Date.parse(start))/86400000),active=n=>notes.get(n)?.[index]==='1';
   if(!running.some(r=>active(r[0])))continue;
   const stops=[];let current=null,last=-1,offset=0;
   const time=s=>{let m=Number(s.slice(0,2))*60+Number(s.slice(2));if(m<last)offset+=1440;last=m;return localTime(serviceDate,m+offset);};
   for(const line of lines){
    if(['>','+','.','<'].includes(line[0])){
     const [code,...times]=line.slice(1).split(',').map(s=>s.trim());
     const arrival=line[0]==='>'?null:time(times[0]),departure=line[0]==='<'?null:line[0]==='.'?arrival:time(times.at(-1));
     current={code:code.toUpperCase(),arrival,departure,track:''};stops.push(current);
    }else if(line[0]==='?'&&current){const [,track,note]=line.slice(1).split(',').map(s=>s.trim());if(active(note))current.track=track;}
   }
   for(let i=0;i<stops.length;i++){
    const stop=stops[i],ordinal=i+1;
    if(!selected.has(stop.code)||!stop.departure||!running.some(r=>active(r[0])&&ordinal>=+r[1]&&ordinal<=+r[2]))continue;
    const service=services.find(s=>ordinal>=+s[3]&&ordinal<+s[4]);if(!service)continue;
    const number=String(Number(service[1])),category=categories.find(c=>ordinal>=+c[1]&&ordinal<+c[2])?.[0]||'';
    if(/^(DZ|FLX|WB|WEST)$/.test(category))continue;
    const id=['IFF',serviceDate,lines[0],ordinal].join('|'),futureRoute=stops.slice(i+1).map(s=>names.get(s.code)||s.code),planned=stop.departure;
    rows.push({id,source:'NDOV_IFF',sourceTripId:lines[0],serviceDate,number,category,train:category+' '+number,trainKey:serviceDate+'|'+number,observedAt:selected.get(stop.code),stationCode:stop.code,countryCode:'NL',eventMode:'departure',plannedTimestamp:planned,expectedTimestamp:planned,plannedTime:clock(planned),time:clock(planned),currentTime:clock(planned),plannedTrack:stop.track,currentTrack:'',track:stop.track||'—',delay:0,hasRealtime:false,cancelled:false,status:'',from:names.get(stops[0].code)||stops[0].code,to:futureRoute.at(-1)||'',route:futureRoute,futureRoute,messageTimestamp:now});
   }
  }
 }
 return {rows,validThrough:lastDate,loadedAt:now};
}
let plan=null,busy=false;
export const nlPlanningState={status:'starting',count:0,lastSuccessAt:null,error:null};
export async function restoreDutchPlan(){plan=await loadBoardCache('NDOV:plan');if(plan)Object.assign(nlPlanningState,{status:'cached',count:plan.rows.length,lastSuccessAt:new Date(plan.loadedAt).toISOString()});}
export async function refreshDutchPlan(stations){
 if(busy)return;busy=true;
 try{const response=await fetch('https://data.ndovloket.nl/ns/ns-latest.zip',{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('IFF HTTP '+response.status);
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>30*1024*1024)throw Error('IFF te groot');
 const next=await new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:{bytes,stations,now:Date.now()},transferList:[bytes.buffer]});worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('IFF verwerking mislukt'));});});
 if(!next.rows.length)throw Error('IFF bevat geen vertrekken');await saveBoardCache('NDOV:plan',next);plan=next;Object.assign(nlPlanningState,{status:'ready',count:next.rows.length,lastSuccessAt:new Date(next.loadedAt).toISOString(),error:null});
 }catch(e){nlPlanningState.status='error';nlPlanningState.error=e.message;}finally{busy=false;}
}
export function startDutchPlan(stations){void refreshDutchPlan(stations);setInterval(()=>void refreshDutchPlan(stations),6*3600000).unref();}
export function dutchPlannedRows(station,now=Date.now()){return (plan?.rows||[]).filter(r=>r.observedAt===station&&r.plannedTimestamp>=now-600000&&r.plannedTimestamp<now+86400000);}
export function combineDutchRows(planned,realtime,now=Date.now()){
 const same=(a,b)=>String(a.number)===String(b.number)&&a.serviceDate===b.serviceDate&&Math.abs(a.plannedTimestamp-b.plannedTimestamp)<3*3600000;
 return [...planned.filter(p=>!realtime.some(r=>same(p,r))),...realtime.filter(r=>!r.departed&&!r.notBoardable&&(r.cancelled?r.plannedTimestamp:r.expectedTimestamp)>=now-600000).map(r=>{const base=planned.find(p=>same(p,r));return base?{...base,...r,futureRoute:r.futureRoute?.length?r.futureRoute:base.futureRoute}:r;})];
}
if(!isMainThread&&workerData?.stations)parentPort.postMessage(parseDutchPlan(workerData.bytes,workerData.stations,workerData.now));
