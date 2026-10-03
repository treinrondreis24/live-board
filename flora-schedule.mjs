import {floraMail,startFloraMail} from './flora-mail.mjs';
import {floraGoogle} from './flora-google.mjs';
import {readFlora,writeFlora} from './flora-store.mjs';
import {fetchBookings,sanityConfig} from './flora-sanity.mjs';
import {applyFollowup} from './flora-followup.mjs';

export const SCHEDULE_LABEL='Dagelijks 05:00 · Europe/Amsterdam';
const parts=now=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
const dateOf=p=>`${p.year}-${p.month}-${p.day}`;
function shift(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
function atFive(date){let ms=Date.parse(date+'T05:00:00Z');for(let i=0;i<2;i++)ms+=(5-Number(parts(ms).hour))*3600000;return new Date(ms).toISOString();}
export function latestDailySlot(now=new Date().toISOString()){
 const p=parts(now),date=dateOf(p);return atFive(Number(p.hour)<5?shift(date,-1):date);
}
export function nextDailySlot(now=new Date().toISOString()){return atFive(shift(dateOf(parts(latestDailySlot(now))),1));}
export function scheduleInfo(state,now=new Date().toISOString()){
 const due=latestDailySlot(now),pending=!!state.scheduleStartedAt&&due>=state.scheduleStartedAt&&state.lastDailySlot!==due;
 return {label:SCHEDULE_LABEL,next:pending?due:nextDailySlot(now),overdue:pending,lastRun:state.checkpoint?.at||null,lastDaily:state.lastDailySlot||null};
}
export function createFloraCycle({read=readFlora,write=writeFlora,sync=fetchBookings,configured=()=>!!sanityConfig().token,clock=()=>new Date().toISOString(),email=async()=>{if((await floraGoogle.status()).connected){await floraMail.start({mode:'daily'});void floraMail.tick();}}}={}){
 let running=false;
 return async function runFloraCycle(){
  if(running)return;running=true;
  try{
   const {state,revision}=await read(),now=clock();
   if(!state.scheduleStartedAt){state.scheduleStartedAt=now;await write(state,revision);return;}
   const due=latestDailySlot(now);
   if(!configured()||due<state.scheduleStartedAt||state.lastDailySlot===due)return;
   // A failure or conflicting write never moves the checkpoint.
   if(state.lastDailyAttempt&&Date.parse(now)-Date.parse(state.lastDailyAttempt)<3600000)return;
   state.lastDailyAttempt=now;
   try{state.bookings=await sync();state.lastSync=now;state.syncError=null;applyFollowup(state,{now,mode:'daily'});state.lastDailySlot=due;}
   catch{state.syncError='Dagelijkse controle niet voltooid: Sanity inlezen mislukt. Het vorige voortgangspunt blijft behouden; FloRA probeert het opnieuw.';}
   await write(state,revision);if(state.lastDailySlot===due)await email();
  }catch(e){console.error('FloRA hercontrole:',e.status===409?'Gelijktijdige wijziging; volgende cyclus probeert opnieuw.':'Kon hercontrole niet opslaan.');}
  finally{running=false;}
 };
}
export const runFloraCycle=createFloraCycle();
export function startFlora(){startFloraMail();setTimeout(()=>void runFloraCycle(),15000).unref();setInterval(()=>void runFloraCycle(),60000).unref();}
