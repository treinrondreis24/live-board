import {connectionDate,connectionRules,stationAliases} from './connections-rules.mjs';
import {evaluateConnections} from './connections-engine.mjs';
import {connectionInputs,saveConnectionAssessment,readConnections,readConnectionRevisions,cleanConnectionWorkingData} from './connections-store.mjs';
export const connectionMonitorStatus={running:false,lastRun:null,lastError:null,ruleCount:connectionRules.length,dates:[],basis:'Treinmetingen; geen bevestiging dat reizigers daadwerkelijk zijn overgestapt.'};
export async function runConnectionMonitor(getLayout,now=Date.now()){
 if(connectionMonitorStatus.running)return;connectionMonitorStatus.running=true;
 try{connectionMonitorStatus.ruleCount=connectionRules.filter(r=>r.enabled!==false).length;const layouts={};for(const key of Object.keys(stationAliases))layouts[key]=await getLayout(key);
 const dates=[-1,0,1].map(offset=>connectionDate(now+offset*86400000));
 for(const date of new Set(dates)){
 const input=await connectionInputs(date);const results=evaluateConnections({date,...input,layouts,now});
 for(const result of results)await saveConnectionAssessment(result);
 // Retain the history of alternatives, but stop presenting one as active when
 // the primary connection no longer triggers it (including missing live data).
 for(const old of await readConnections(date))if(date>=connectionDate(now)&&!results.some(r=>r.ruleId===old.ruleId&&r.station===old.station&&r.alternativeFor===old.alternativeFor)){
 const {key,revision,updatedAt,...snapshot}=old;
 await saveConnectionAssessment({...snapshot,eligible:false,status:'not-applicable',reason:connectionRules.some(r=>r.id===old.ruleId&&r.enabled!==false)?'alternative-no-longer-triggered':'rule-disabled',evaluatedAt:now});
 }
 }
 await cleanConnectionWorkingData(now);connectionMonitorStatus.dates=dates;connectionMonitorStatus.lastRun=now;connectionMonitorStatus.lastError=null;
 }catch(e){connectionMonitorStatus.lastError=e.message;console.error('Aansluitmonitor:',e.message);}finally{connectionMonitorStatus.running=false;}
}
export function startConnectionMonitor(getLayout){const tick=()=>void runConnectionMonitor(getLayout);const start=setTimeout(tick,5000);start.unref();const timer=setInterval(tick,60000);timer.unref();return ()=>{clearTimeout(start);clearInterval(timer);};}
export async function handleConnections(req,res,url){
 if(!url.pathname.startsWith('/api/connections'))return false;
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.method!=='GET'){send(405,{error:'Alleen lezen toegestaan.'});return true;}
 if(url.pathname==='/api/connections/status'){send(200,connectionMonitorStatus);return true;}
 if(url.pathname==='/api/connections/revisions'){const key=url.searchParams.get('key')||'',before=Number(url.searchParams.get('before')||2147483647),limit=Number(url.searchParams.get('limit')||200);if(key.length>200||!Number.isInteger(before)||before<1||before>2147483647||!Number.isInteger(limit)||limit<1||limit>200){send(400,{error:'Ongeldige sleutel of paginering.'});return true;}send(200,{revisions:await readConnectionRevisions(key,{before,limit})});return true;}
 if(url.pathname!=='/api/connections'){send(404,{error:'Niet gevonden.'});return true;}
 const date=url.searchParams.get('date')||connectionDate(Date.now());if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date){send(400,{error:'Ongeldige datum.'});return true;}
 send(200,{date,monitor:connectionMonitorStatus,connections:await readConnections(date)});return true;
}
