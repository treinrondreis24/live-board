import test from 'node:test';
import assert from 'node:assert/strict';
import {startOctober,runOctober,octoberSubject} from './flora-trains-october.mjs';
test('October subject dates are exact and support numeric and month names',()=>{
 for(const s of ['vertrekdatum: 26/10/2026','1 oktober 2026','31 Oct 2026','2026-10-09'])assert.equal(octoberSubject(s),true);
 for(const s of ['10/11/2026','26/10/2027','boekingscode 102026','oktober aanbieding'])assert.equal(octoberSubject(s),false);
});
test('retry targets only issue dossiers, saves November and silently skips open or cancelled tickets',async()=>{
 const kv=new Map([['trains-data',{revision:0,value:{rows:[{id:'old',reference:'RETIRED'}],checks:{'NS ACTIVE':{issues:['old']},'NS OPEN':{issues:['old']},'NS RETIRED':{issues:['old']},'NS OK':{issues:[]}}}}]]);
 const read=async k=>structuredClone(kv.get(k)||{revision:0,value:{}}),write=async(k,value,r)=>{kv.set(k,{revision:r+1,value:structuredClone(value)});return r+1;};
 const queried=[];const google={status:async()=>({connected:true}),reader:async()=>async(path,args)=>{if(path==='messages'){const ref=args.q.match(/"(\w+)"/)[1];queried.push(ref);return {messages:[{id:ref}]};}const id=path.split('/')[1];return {id,internalDate:String(Date.parse('2026-09-01')),payload:{headers:[{name:'From',value:'no-reply@confirmation.nsinternational.nl'},{name:'Subject',value:`Bevestiging, naam: 6541A, boekingscode: ${id}, vertrekdatum: 01/11/2026`}]}};}};
 const extract=async m=>({id:m.id,from:'no-reply@confirmation.nsinternational.nl',subject:m.payload.headers[1].value,issues:[],retiredLinks:m.id==='RETIRED'?['retired']:[],docs:m.id==='RETIRED'?[{label:'E-mail',text:'Old journey'}]:[{label:'ticket',text:m.id==='ACTIVE'?'01.11 10:00 A -> B 01.11 12:00 TREIN 100':'VERVOERBEWIJS Geldig:01.11.2026 A -> B'}]});
 await startOctober({read,write,google},true);await runOctober({read,write,google,extract});const data=(await read('trains-data')).value;
 assert.deepEqual(queried,['ACTIVE','OPEN','RETIRED']);assert.equal(data.rows.length,1);assert.equal(data.rows[0].date,'2026-11-01');assert.deepEqual(data.checks['NS OPEN'].issues,[]);assert.match(data.checks['NS RETIRED'].notes[0],/geannuleerde/);assert.equal((await read('trains-job')).value.status,'completed');
});
test('October scan stores newest dossiers only, excludes old dates and defers connections',async()=>{
 const kv=new Map([['trains-data',{revision:1,value:{rows:[{id:'keep',reference:'UNRELATED',date:'2026-12-01'}],connections:[]}}]]),queries=[],extracted=[];
 const msg=(id,ref,date='26/10/2026',extra={})=>({id,internalDate:String(Date.parse('2026-09-01')+Number(id)*1000),payload:{headers:[{name:'From',value:'no-reply@confirmation.nsinternational.nl'},{name:'Subject',value:`Bevestiging, naam: 6541A, boekingscode: ${ref}, vertrekdatum: ${date}`}]},...extra});
 const messages={'1':msg('1','ACTIVE'),'2':msg('2','ACTIVE'),'3':msg('3','CANCEL'),'4':msg('4','CANCEL'),'5':msg('5','OTHER','26/11/2026'),'6':msg('6','EARLY','26/10/2026',{internalDate:String(Date.parse('2026-05-31'))})};
 messages['4'].payload.headers[1].value='Annulering, naam: 6541A, boekingscode: CANCEL, vertrekdatum: 26/10/2026';
 const read=async k=>structuredClone(kv.get(k)||{revision:0,value:{}}),write=async(k,value,r)=>{assert.equal(r,(kv.get(k)||{revision:0}).revision);kv.set(k,{revision:r+1,value:structuredClone(value)});return r+1;};
 const google={status:async()=>({connected:true}),reader:async()=>async(path,args)=>{if(path==='messages'){queries.push(args.q);return {messages:(args.q.includes('"ACTIVE"')?['1','2']:args.q.includes('"CANCEL"')?['3','4']:['1','3','5','6']).map(id=>({id}))};}return messages[path.split('/')[1]];}};
 const extract=async m=>{extracted.push(m.id);return {id:m.id,subject:m.payload.headers[1].value,from:m.payload.headers[0].value,at:'2026-09-01',url:'mail',issues:[],docs:[{label:'ticket',year:'2026',text:'26.10 10:00 AMSTERDAM -> BERLIN 26.10 16:00 TREIN 100'}]};};
 await startOctober({read,write,google});await runOctober({read,write,google,extract});
 assert.deepEqual(extracted,['2']);const d=(await read('trains-data')).value;
 assert.equal(d.rows.length,2);assert.ok(d.rows.some(r=>r.id==='keep'));assert.equal(d.rows.find(r=>r.reference==='ACTIVE').number,'100');assert.deepEqual(d.connections,[]);
 assert.equal((await read('trains-job')).value.status,'completed');assert.ok(queries.every(q=>q.includes('after:1780272000')));
});
