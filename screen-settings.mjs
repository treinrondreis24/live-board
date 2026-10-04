import {readFile} from 'node:fs/promises';
import {adminAuthenticated} from './admin-security.mjs';
import {readBoardSettings,writeBoardSettings,insertBoardSettings} from './board-cache.mjs';
import {readConnectionSettings} from './connections-store.mjs';
const prefix='screen:', saved=new Map();
export const screenSources={DB:'DB Timetables',NDOV:'Nederland · NDOV',OJP:'Zwitserland · OJP',NMBS:'België · NMBS'};
let defaults,stations=[],stationsBySource={};
export const screenSource=row=>row.source==='DB_PLAN'?'DB':row.source||'DB';
export const screenTrainKey=row=>screenSource(row)+'|'+String(row.number);
export async function initScreenSettings(config,sourceStations={}){
 stations=[...new Set([...(config.stations||[]),...(config.collectors||[])].map(s=>s.name))].sort();
 stationsBySource={DB:stations,NDOV:(config.ndov?.stations||[]).map(s=>s.name),OJP:[],NMBS:[],...sourceStations};
 defaults={name:'Hoofdscherm',italy:true,connections:true,connectionIds:null,pinCancelled:true,maxPinned:4,minDelay:20,rows:8,seconds:10,trains:[...new Set((config.stations||[]).flatMap(s=>s.trainNumbers||[]).map(String))].map(number=>({number,source:'DB',stations:[]}))};
 for(const row of await readBoardSettings())if(row.page.startsWith(prefix))saved.set(row.page.slice(prefix.length),row);
}
export function screenSettings(id='0'){return saved.get(id)?.settings||(id==='0'?defaults:null);}
export function screenTrainNumbers(){return [...new Set([defaults,...[...saved.values()].map(r=>r.settings)].filter(Boolean).flatMap(s=>s.trains.filter(t=>t.source==='DB').map(t=>t.number)))];}
export function screenTrainMatches(row,settings){return settings.trains.some(t=>t.number===String(row.number)&&t.source===screenSource(row)&&(!t.stations.length||t.stations.includes(row.observedAt||row.station)));}
export function validateScreenSettings(input){
 const fail=m=>{throw Object.assign(Error(m),{status:400});};
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Ongeldige instellingen.');
 const result={name:String(input.name||'Treinbord').trim().slice(0,80)};
 for(const k of ['italy','connections','pinCancelled']){if(typeof input[k]!=='boolean')fail('Ongeldige schermkeuze.');result[k]=input[k];}
 for(const [k,min,max] of [['maxPinned',0,20],['minDelay',1,240],['rows',1,30],['seconds',5,120]]){if(!Number.isInteger(input[k])||input[k]<min||input[k]>max)fail('Ongeldige waarde voor '+k+'.');result[k]=input[k];}
 if(!Array.isArray(input.trains)||input.trains.length>200)fail('Gebruik maximaal 200 treinen.');
 result.trains=input.trains.map(t=>{if(!t||!/^\d{1,6}$/.test(t.number)||!Object.hasOwn(screenSources,t.source)||!Array.isArray(t.stations)||t.stations.some(s=>!stationsBySource[t.source].includes(s)))fail('Controleer het treinnummer, de bron en de stations die bij deze bron horen.');return {number:String(t.number),source:t.source,stations:[...new Set(t.stations)]};});
 if(new Set(result.trains.map(screenTrainKey)).size!==result.trains.length)fail('Voeg ieder treinnummer per bron één keer toe.');
 if(input.connectionIds!==null&&(!Array.isArray(input.connectionIds)||input.connectionIds.length>100||input.connectionIds.some(id=>typeof id!=='string'||!/^[a-z0-9-]{1,90}$/.test(id))))fail('Ongeldige aansluitingen.');
 result.connectionIds=input.connectionIds===null?null:[...new Set(input.connectionIds)];return result;
}
const info=id=>({id,revision:saved.get(id)?.revision||0,settings:screenSettings(id),url:id==='0'?'/':'/'+id});
export async function handleScreenSettings(req,res,url){
 const base='/stationschef/treinbord',api='/stationschef/api/treinbord';
 if(![base,base+'/',base+'.js',api].includes(url.pathname))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 if(!await adminAuthenticated(req)){if(url.pathname===api)json(401,{error:'Log eerst in bij Stationschef.'});else{res.writeHead(303,{Location:'/stationschef'});res.end();}return true;}
 try{
 if(url.pathname!==api){if(req.method!=='GET'){json(405,{error:'Niet toegestaan.'});return true;}const js=url.pathname.endsWith('.js');res.writeHead(200,{'Content-Type':js?'text/javascript':'text/html; charset=utf-8'});res.end(await readFile(new URL(js?'./screen-settings.js':'./screen-settings.html',import.meta.url)));return true;}
 if(req.method==='GET'){json(200,{screens:[...new Set(['0',...saved.keys()])].map(info),stations,stationsBySource,sources:screenSources,connections:(await readConnectionSettings()).rules});return true;}
 if(req.method!=='POST'){json(405,{error:'Niet toegestaan.'});return true;}
 const origin=(req.headers['x-forwarded-proto']==='https'||req.socket.encrypted?'https':'http')+'://'+req.headers.host;
 if(req.headers.origin!==origin){json(403,{error:'Open het beheer op de eigen website.'});return true;}
 let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>100000)throw Object.assign(Error('Te veel instellingen.'),{status:413});body+=chunk;}
 const input=JSON.parse(body),id=String(input.id),settings=validateScreenSettings(input.settings);
 if(!screenSettings(id)){json(404,{error:'Onbekend scherm.'});return true;}
 if(input.action==='copy'){
 for(let n=1;n<=999;n++){if(saved.has(String(n)))continue;const state=await insertBoardSettings(prefix+n,settings);if(!state)continue;saved.set(String(n),{...state,settings});json(200,info(String(n)));return true;}throw Error('Geen vrij schermnummer.');
 }
 if(input.action!=='save'||!Number.isInteger(input.revision)||input.revision!==(saved.get(id)?.revision||0)){json(409,{error:'Dit scherm is intussen gewijzigd. Herlaad voordat je opslaat.'});return true;}
 const state=await writeBoardSettings(prefix+id,settings,input.revision);saved.set(id,{...state,settings});json(200,info(id));
 }catch(e){json(e.status||400,{error:e.message||'Opslaan mislukt.'});}return true;
}
