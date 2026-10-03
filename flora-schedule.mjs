import {readFlora,writeFlora} from './flora-store.mjs';
import {fetchBookings,sanityConfig} from './flora-sanity.mjs';
import {evaluate} from './flora-engine.mjs';
let running=false;
export async function runFloraCycle(){
 if(running||!sanityConfig().token)return;running=true;
 try{
  const {state,revision}=await readFlora();
  if(state.lastSync&&Date.now()-Date.parse(state.lastSync)<6*3600000)return;
  try{state.bookings=await fetchBookings();state.lastSync=new Date().toISOString();state.syncError=null;Object.assign(state,evaluate(state));state.audit.push({at:state.lastSync,user:'FloRA',action:'Automatische hercontrole',detail:'Sanity opnieuw gelezen; controles bijgewerkt.'});}
  catch{state.syncError='Automatisch inlezen mislukt. De laatste resultaten kunnen verouderd zijn. Probeer Sanity inlezen.';}
  await writeFlora(state,revision);
 }catch(e){console.error('FloRA hercontrole:',e.status===409?'Gelijktijdige wijziging; volgende cyclus probeert opnieuw.':'Kon hercontrole niet opslaan.');}
 finally{running=false;}
}
export function startFlora(){setTimeout(()=>void runFloraCycle(),15000).unref();setInterval(()=>void runFloraCycle(),3600000).unref();}
