import {floraMail,startFloraMail} from './flora-mail.mjs';
import {floraGoogle} from './flora-google.mjs';
import {readFlora,writeFlora} from './flora-store.mjs';
import {fetchBookings,sanityConfig} from './flora-sanity.mjs';
import {applyFollowup} from './flora-followup.mjs';

export const SCHEDULE_LABEL='Woensdag 06:00 · Europe/Amsterdam';
const parts=now=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
const dateOf=p=>`${p.year}-${p.month}-${p.day}`;
function shift(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
function atSix(date){let ms=Date.parse(date+'T06:00:00Z');for(let i=0;i<2;i++)ms+=(6-Number(parts(ms).hour))*3600000;return new Date(ms).toISOString();}
export function latestWeeklySlot(now=new Date().toISOString()){
 const p=parts(now),date=dateOf(p),weekday=new Date(date+'T12:00:00Z').getUTCDay();
 let due=shift(date,-((weekday+4)%7));if(due===date&&Number(p.hour)<6)due=shift(due,-7);return atSix(due);
}
export function nextWeeklySlot(now=new Date().toISOString()){return atSix(shift(dateOf(parts(latestWeeklySlot(now))),7));}
export function scheduleInfo(state,now=new Date().toISOString()){
 const due=latestWeeklySlot(now),pending=!!state.scheduleStartedAt&&due>=state.scheduleStartedAt&&state.lastWeeklySlot!==due;
 return {label:SCHEDULE_LABEL,next:pending?due:nextWeeklySlot(now),overdue:pending,lastRun:state.checkpoint?.at||null,lastWeekly:state.lastWeeklySlot||null};
}
export function createFloraCycle({read=readFlora,write=writeFlora,sync=fetchBookings,configured=()=>!!sanityConfig().token,clock=()=>new Date().toISOString(),email=async()=>{if((await floraGoogle.status()).connected){await floraMail.start({mode:'weekly'});void floraMail.tick();}}}={}){
 let running=false;
 return async function runFloraCycle(){
  if(running)return;running=true;
  try{
   const {state,revision}=await read(),now=clock();
   if(!state.scheduleStartedAt){state.scheduleStartedAt=now;await write(state,revision);return;}
   const due=latestWeeklySlot(now);
   if(!configured()||due<state.scheduleStartedAt||state.lastWeeklySlot===due)return;
   // A failure or conflicting write never moves the checkpoint.
   if(state.lastWeeklyAttempt&&Date.parse(now)-Date.parse(state.lastWeeklyAttempt)<3600000)return;
   state.lastWeeklyAttempt=now;
   try{state.bookings=await sync();state.lastSync=now;state.syncError=null;applyFollowup(state,{now,mode:'weekly'});state.lastWeeklySlot=due;}
   catch{state.syncError='Woensdagcontrole niet voltooid: Sanity inlezen mislukt. Het vorige voortgangspunt blijft behouden; FloRA probeert het opnieuw.';}
   await write(state,revision);if(state.lastWeeklySlot===due)await email();
  }catch(e){console.error('FloRA hercontrole:',e.status===409?'Gelijktijdige wijziging; volgende cyclus probeert opnieuw.':'Kon hercontrole niet opslaan.');}
  finally{running=false;}
 };
}
export const runFloraCycle=createFloraCycle();
export function startFlora(){startFloraMail();setTimeout(()=>void runFloraCycle(),15000).unref();setInterval(()=>void runFloraCycle(),60000).unref();}
