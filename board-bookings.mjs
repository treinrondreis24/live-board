import {nightRule,nightBookingMatches} from './night-routes.mjs';
import {readMail} from './flora-store.mjs';

const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const localDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'});
const number=value=>/^\d{1,6}$/.test(String(value||''))?String(Number(value)):null;
const date=value=>datePattern.test(String(value||''))&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const reference=value=>/^\d{1,8}A?$/i.test(String(value||''))?String(value).replace(/A$/i,'')+'A':null;

// FloRA's date is the booked boarding date. Prefer the observed stop's calendar
// date rather than assuming the passenger boarded at the train's origin.
export function bookingNumbersForTrain(train,rows,{confirmedOnly=false,settings=null}={}){
 const members=train.mergedServices?.length?train.mergedServices:[train];
 const matches=new Set();
 for(const member of members){
  const numbers=new Set((member.trainNumbers||[member.number]).map(number).filter(Boolean));
  const timestamp=Number(member.plannedTimestamp),day=timestamp>0?localDate.format(timestamp):date(member.serviceDate);
  if(!day||!numbers.size)continue;
  for(const row of rows){
   const ref=reference(row.trip);
   if(!ref||!numbers.has(number(row.number))||!date(row.date)||row.cancelled||row.deleted||!['Bevestigd','Te beoordelen'].includes(row.status)||confirmedOnly&&row.status!=='Bevestigd')continue;
   // An explicit service date can establish an overnight run. Without it,
   // never guess between consecutive daily trains using a +/- one-day window.
   const rule=nightRule(settings,member,row.number);
   const sameDay=rule?nightBookingMatches(rule,member,row):row.serviceDate?date(row.serviceDate)===date(member.serviceDate):row.date===day;
   if(sameDay)matches.add(ref);
  }
 }
 return [...matches].sort((a,b)=>a.localeCompare(b,'nl',{numeric:true}));
}

export function createBoardBookings({read=readMail,now=Date.now,confirmedOnly=false}={}){
 let cached=null,until=0,pending=null;
 async function rows(){
  if(cached&&now()<until)return cached;
  if(!pending)pending=read('trains-data').then(({value})=>{cached=value.rows||[];until=now()+30000;return cached;}).finally(()=>pending=null);
  return pending;
 }
 return async (trains,settings=null)=>{
  try{const data=await rows();return {trains:trains.map(t=>({...t,bookingNumbers:bookingNumbersForTrain(t,data,{confirmedOnly,settings})})),bookingsStatus:'ready'};}
  catch{return {trains:trains.map(t=>({...t,bookingNumbers:[]})),bookingsStatus:'unavailable'};}
 };
}
export const attachBoardBookings=createBoardBookings();
