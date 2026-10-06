import {readFlora,writeFlora} from './flora-store.mjs';
import {evaluate,hash} from './flora-engine.mjs';
export function createExpediaCycle({read=readFlora,write=writeFlora,clock=()=>new Date().toISOString()}={}){
 let running=false;
 return async()=>{
  if(running)return;running=true;
  try{
   const {state,revision}=await read(),signature=hash(state.expediaEvents||[]);
   if(state.expediaCheckSignature===signature)return;
   Object.assign(state,evaluate(state,clock()));state.expediaCheckSignature=signature;state.expediaCheckedAt=clock();await write(state,revision);
  }catch(e){console.error('Expedia-controle:',e.status===409?'Gelijktijdige wijziging; volgende cyclus probeert opnieuw.':'Controle tijdelijk niet beschikbaar.');}
  finally{running=false;}
 };
}
export const runExpediaCycle=createExpediaCycle();
