import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {nightRule,runDay,observedDay} from './night-routes.mjs';
const records=new Map();
mock.module('./admin-security.mjs',{namedExports:{adminAuthenticated:async req=>req.auth}});
mock.module('./connections-store.mjs',{namedExports:{readConnectionSettings:async()=>({rules:[]})}});
mock.module('./board-cache.mjs',{namedExports:{readBoardSettings:async()=>[...records.values()],insertBoardSettings:async(page,settings)=>{if(records.has(page))return null;const row={page,settings:structuredClone(settings),revision:1};records.set(page,row);return {revision:1};},writeBoardSettings:async(page,settings,revision)=>{assert.equal(records.get(page)?.revision||0,revision);const row={page,settings:structuredClone(settings),revision:revision+1};records.set(page,row);return {revision:row.revision};}}});
const {initScreenSettings,screenSettings,screenTrainMatches,screenTrainKey,screenTrainNumbers,validateScreenSettings,handleScreenSettings}=await import('./screen-settings.mjs');
await initScreenSettings({stations:[{name:'Köln Hbf',trainNumbers:['225']}],collectors:[{name:'Mannheim Hbf'}]});
async function request(body,auth=true,origin='https://example.org'){let status,value;const req={method:body?'POST':'GET',auth,headers:{host:'example.org',origin,'x-forwarded-proto':'https'},socket:{},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};await handleScreenSettings(req,{setHeader(){},writeHead(n){status=n;},end(s){value=JSON.parse(s);}},new URL('https://example.org/stationschef/api/treinbord'));return {status,value};}
test('validates train source, station selection, duplicates and numeric bounds',()=>{const s=screenSettings();assert.equal(validateScreenSettings(s).maxPinned,4);for(const bad of [{maxPinned:-1},{minDelay:0},{trains:[{number:'225',source:'invalid',stations:[]}]},{trains:[{number:'225',source:'DB',stations:['missing']}]},{trains:[s.trains[0],s.trains[0]]}])assert.throws(()=>validateScreenSettings({...s,...bad}));assert.equal(validateScreenSettings({...s,maxPinned:0}).maxPinned,0);});
test('station and DB source restrictions apply',()=>{const s={trains:[{number:'225',source:'DB',stations:['Köln Hbf']}]};assert.equal(screenTrainMatches({number:'225',source:'DB',observedAt:'Köln Hbf'},s),true);assert.equal(screenTrainMatches({number:'225',source:'DB',observedAt:'Mannheim Hbf'},s),false);assert.equal(screenTrainMatches({number:'225',source:'NDOV',observedAt:'Köln Hbf'},s),false);});
test('authentication, origin, copy isolation, persistence and conflicting saves',async()=>{assert.equal((await request(null,false)).status,401);assert.equal((await request({action:'copy'},true,'https://other.org')).status,403);const original=structuredClone(screenSettings());const copy=await request({id:'0',action:'copy',settings:original});assert.equal(copy.value.url,'/1');const change={...original,italy:false,trains:[{number:'999',source:'DB',stations:[]}]};assert.equal((await request({id:'1',action:'save',revision:1,settings:change})).status,200);assert.deepEqual(screenSettings('0'),original);assert.equal(screenSettings('1').italy,false);assert.ok(screenTrainNumbers().includes('999'));assert.equal((await request({id:'1',action:'save',revision:1,settings:original})).status,409);await initScreenSettings({stations:[{name:'Köln Hbf',trainNumbers:['225']}]});assert.equal(screenSettings('1').italy,false);assert.equal(screenSettings('999'),null);});
test('configurable delay pinning includes zero and cancellation switch',()=>{const src=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),code=src.slice(src.indexOf('function dbPageItems'),src.indexOf('function dbPageCount'));const ctx=vm.createContext({dbTrains:[{delay:30},{delay:60},{delay:90},{delay:1,cancelled:true}],withinTrainWindow:()=>true,CONFIG:{dbRowsPerPage:8,maxPinned:1,minDelay:50,pinCancelled:false}});vm.runInContext(code,ctx);let group=vm.runInContext('dbPageItems()',ctx);assert.equal(group.pinned.length,1);assert.equal(group.pinned[0].delay,90);ctx.CONFIG.maxPinned=0;assert.equal(vm.runInContext('dbPageItems().pinned.length',ctx),0);ctx.CONFIG.pinCancelled=true;assert.equal(vm.runInContext('dbPageItems().pinned.length',ctx),1);});

test('same train can use four sources with separate station scopes and collector identities',async()=>{
 await initScreenSettings({stations:[{name:'Köln Hbf',trainNumbers:['225']}]},{NDOV:['Arnhem Centraal'],OJP:['Zürich HB'],NMBS:['Bruxelles-Midi']});
 const trains=[['DB','Köln Hbf'],['NDOV','Arnhem Centraal'],['OJP','Zürich HB'],['NMBS','Bruxelles-Midi']].map(([source,station])=>({number:'225',source,stations:[station]}));
 const settings=validateScreenSettings({...screenSettings(),trains});assert.equal(settings.trains.length,4);
 assert.equal(new Set(trains.map(screenTrainKey)).size,4);
 for(const t of trains){assert.equal(screenTrainMatches({source:t.source,number:'225',observedAt:t.stations[0]},settings),true);assert.equal(screenTrainMatches({source:t.source,number:'225',observedAt:'Wrong station'},settings),false);}
 assert.throws(()=>validateScreenSettings({...settings,trains:[...trains,trains[1]]}));
 assert.throws(()=>validateScreenSettings({...settings,trains:[{...trains[1],stations:['Köln Hbf']}]}));
 const saved=await request({id:'0',action:'save',revision:0,settings:{...settings,trains:[...trains,{number:'123456',source:'NMBS',stations:[]}]}});assert.equal(saved.status,200);assert.equal(screenTrainNumbers().includes('123456'),false);
});
test('display keeps identical numbers and event IDs from different sources separate',()=>{
 const src=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
 const rows=['DB','NDOV','OJP','NMBS'].map((source,i)=>({source,id:'same',number:'225',observedAt:'Station',plannedTimestamp:Date.now(),delay:i,hasRealtime:true}));
 const ctx=vm.createContext({config:{stations:[]},ndovStatus:()=>({fresh:true}),ndovRows:new Map([['x',rows[1]]]),dbState:{trains:[rows[0]]},collectorState:{byStation:{}},swissStations:{z:{}},swissPayload:()=>[rows[2]],belgianScreenRows:()=>[rows[3]],nightRule,runDay,observedDay,screenTrainMatches,screenTrainKey,visibleOnBoard:()=>true,chooseBest:r=>r[0],mergeEquivalentBoardTrains:r=>r});
 vm.runInContext(src.slice(src.indexOf('function dedupeRows('),src.indexOf('// Passenger displays')),ctx);
 vm.runInContext(src.slice(src.indexOf('function screenBoardTrains('),src.indexOf('async function performScan()')),ctx);
 ctx.settings={trains:rows.map(r=>({number:r.number,source:r.source,stations:[]}))};assert.equal(vm.runInContext('screenBoardTrains(Date.now(),settings).length',ctx),4);
 ctx.settings.trains=ctx.settings.trains.slice(0,1);assert.equal(vm.runInContext('screenBoardTrains(Date.now(),settings)[0].source',ctx),'DB');
});

test('night rules persist independently on copied screens',async()=>{
 const original=structuredClone(screenSettings());original.trains[0].nightRoute={stations:[{name:'Wien Hbf',day:0,aliases:[]},{name:'Hamburg Hbf',day:1,aliases:[]}]};
 const copy=await request({id:'0',action:'copy',settings:original});assert.equal(copy.status,200);
 const id=copy.value.id;await initScreenSettings({stations:[{name:'Köln Hbf',trainNumbers:['225']}]});
 assert.equal(screenSettings(id).trains[0].nightRoute.stations[1].day,1);assert.equal(screenSettings('0').trains[0].nightRoute,undefined);
});
