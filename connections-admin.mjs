import {readFile} from 'node:fs/promises';
import {adminAuthenticated} from './admin-security.mjs';
import {stationAliases,normalized} from './connections-rules.mjs';
import {readConnectionSettings,writeConnectionSettings} from './connections-store.mjs';
export function validateConnectionRules(input){
 const bad=message=>{const e=Error(message);e.status=400;throw e;};
 if(!Array.isArray(input)||input.length>100)bad('Gebruik maximaal 100 aansluitingen.');
 const number=v=>{if(!/^\d{1,6}$/.test(v||''))bad('Vul een geldig treinnummer in.');return String(v);};
 const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)bad('Ongeldige datum.');return v;};
 const clock=v=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))bad('Gebruik een tijd zoals 13:30.');return v;};
 const rules=input.map(r=>{
 if(!r||!Object.hasOwn(stationAliases,r.station)||! /^[a-z0-9-]{1,90}$/.test(r.id||''))bad('Ongeldig station of identificatie.');
 const out={id:r.id,station:r.station,incoming:number(r.incoming),outgoing:number(r.outgoing),enabled:r.enabled!==false};
 for(const k of ['fromDate','untilDate'])if(r[k])out[k]=date(r[k]);
 if(out.fromDate&&out.untilDate&&out.fromDate>=out.untilDate)bad('De einddatum moet na de begindatum liggen.');
 for(const k of ['departureBefore','departureAfter'])if(r[k])out[k]=clock(r[k]);
 if(r.fallbackStation){if(!Object.hasOwn(stationAliases,r.fallbackStation))bad('Onbekend terugvalstation.');out.fallbackStation=r.fallbackStation;}
 if(r.alternativeTrain)out.alternativeTrain=number(r.alternativeTrain);
 for(const k of ['origin','incomingCategory'])if(r[k]){if(typeof r[k]!=='string'||r[k].length>100)bad('Herkomst of treinsoort is te lang.');out[k]=k==='origin'?normalized(r[k]):r[k].toUpperCase();}
 for(const k of ['alternativeArrival','alternativeDeparture'])if(r[k]){const w=r[k],list=k==='alternativeArrival'?'categories':'destinations';if(!Array.isArray(w[list])||!w[list].length||w[list].length>10||w[list].some(v=>typeof v!=='string'||!v.trim()||v.length>80))bad('Vul de treinsoorten of bestemmingen van het alternatief in.');out[k]={from:clock(w.from),to:clock(w.to),[list]:w[list].map(v=>list==='categories'?v.toUpperCase():normalized(v))};if(out[k].from>out[k].to)bad('Het tijdvenster moet binnen één dag liggen.');}
 // Milano collection currently covers these configured ViaggiaTreno services.
 if(r.station==='milano'&&(r.incoming!=='151'||!['679','2832'].includes(r.outgoing)))bad('Milano ondersteunt momenteel 151 naar 679 of 2832; andere treinen moeten eerst aan ViaggiaTreno worden toegevoegd.');
 return out;
 });
 if(new Set(rules.map(r=>r.id)).size!==rules.length)bad('Elke aansluiting moet een unieke identificatie hebben.');return rules;
}
export async function handleConnectionAdmin(req,res,url){
 if(!['/stationschef/aansluitingen','/stationschef/aansluitingen/','/stationschef/aansluitingen.js','/stationschef/api/aansluitingen'].includes(url.pathname))return false;
 res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Content-Type-Options','nosniff');
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(!await adminAuthenticated(req)){if(url.pathname.includes('/api/'))json(401,{error:'Log eerst in bij Stationschef.'});else{res.writeHead(303,{Location:'/stationschef'});res.end();}return true;}
 try{
 if(url.pathname==='/stationschef/api/aansluitingen'){
 if(req.method==='GET'){json(200,{...await readConnectionSettings(),stations:stationAliases});return true;}
 if(req.method!=='POST'){json(405,{error:'Niet toegestaan.'});return true;}
 if(req.headers.origin!=='https://'+req.headers.host){json(403,{error:'Open het beheer op de eigen website.'});return true;}
 const parts=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>100000){json(413,{error:'Te veel instellingen.'});return true;}parts.push(chunk);}
 let data;try{data=JSON.parse(Buffer.concat(parts).toString());}catch{json(400,{error:'Ongeldig verzoek.'});return true;}
 if(!Number.isInteger(data.revision)||data.revision<0){json(400,{error:'Ongeldige versie.'});return true;}
 json(200,await writeConnectionSettings(validateConnectionRules(data.rules),data.revision));return true;
 }
 if(req.method!=='GET'){json(405,{error:'Niet toegestaan.'});return true;}
 const js=url.pathname.endsWith('.js');res.writeHead(200,{'Content-Type':js?'text/javascript':'text/html; charset=utf-8'});res.end(await readFile(new URL(js?'./connections-admin.js':'./connections-admin.html',import.meta.url)));return true;
 }catch(e){json(e.status||500,{error:e.status?e.message:'Opslaan is mislukt. Probeer opnieuw.'});return true;}
}
