import test from 'node:test';
import assert from 'node:assert/strict';
import {createNSImport,NS_SINCE} from './flora-trains-import.mjs';

function fixture({budgetMs=45000,fail=false}={}){
 let now=Date.parse('2026-10-04T22:30:00Z');const kv=new Map(),queries=[];
 const read=async k=>structuredClone(kv.get(k)||{value:{},revision:0});
 const write=async(k,value,r)=>{assert.equal(r,(kv.get(k)||{revision:0}).revision);kv.set(k,{value:structuredClone(value),revision:r+1});return r+1;};
 const msg=(id,ref,date,at='2026-06-01T00:00:00Z')=>({id,internalDate:String(Date.parse(at)),payload:{headers:[{name:'From',value:'no-reply@confirmation.nsinternational.nl'},{name:'Subject',value:`Bevestiging, naam: 6541A, boekingscode: ${ref}, vertrekdatum: ${date}`}]}});
 const messages={a:msg('a','NOV','01/11/2026'),b:msg('b','DEC','31/12/2026'),c:msg('c','YEAR','30/12/2027'),d:msg('d','OLD','01/11/2026','2026-05-31T21:59:59Z')};
 const google={status:async()=>({connected:true}),reader:async()=>async(path,args)=>{now+=10;if(path==='messages'){queries.push(args.q);const ref=args.q.match(/"([A-Z]+)"/)?.[1];return {messages:Object.values(messages).filter(m=>!ref||m.payload.headers[1].value.includes('code: '+ref+',')).map(m=>({id:m.id}))};}return messages[path.split('/')[1]];}};
 const extract=async m=>{if(fail&&m.id==='a')throw Error('NS-ticket HTTP 400');return {id:m.id,subject:m.payload.headers[1].value,from:m.payload.headers[0].value,at:'2026-09-01',url:'mail',issues:[],docs:[{label:'p1',text:m.id==='a'?'01.11 10:00 A -> B 01.11 12:00 TREIN 100':m.id==='b'?'31.12 20:00 A -> B 01.01 08:00 TREIN 200':'30.12 10:00 A -> B 30.12 12:00 TREIN 300'},{label:'p2',text:'02.01 10:00 B -> A 02.01 12:00 TREIN 201'},{label:'p3',text:'Dit is geen vervoerbewijs. Dit passageticket'}]};};
 return {kv,read,write,queries,messages,advance:n=>{now+=n},service:createNSImport({read,write,google,extract,clock:()=>now,budgetMs})};
}
const finish=async f=>{for(let i=0;i<40;i++){await f.service.run();if(!['queued','running'].includes((await f.read('trains-job')).value.status))return;}throw Error('Not finished');};

test('backfill reads every page, scopes dates, infers rollover and preserves unrelated rows',async()=>{
 const f=fixture();await f.write('trains-data',{rows:[{id:'keep',reference:'NOV',date:'2026-10-01'}]},0);
 await f.service.start();await finish(f);
 const {value:d}=await f.read('trains-data');assert.ok(d.rows.some(r=>r.id==='keep'));
 assert.deepEqual([...new Set(d.rows.filter(r=>r.id!=='keep').map(r=>r.date))].sort(),['2026-11-01','2026-12-31','2027-01-02','2027-12-30']);
 assert.ok(!d.rows.some(r=>r.reference==='OLD'));assert.ok(d.rows.every(r=>r.id==='keep'||r.number));
 assert.equal((await f.read('trains-job')).value.status,'completed');assert.equal((await f.service.schedule()).enabled,true);
 assert.ok(f.queries[0].includes(String(Date.parse(NS_SINCE)/1000)));
});
test('unreadable dossier does not block next dossiers or erase existing evidence',async()=>{
 const f=fixture({fail:true});await f.write('trains-data',{rows:[{id:'old',reference:'NOV',date:'2026-11-01',number:'100'}]},0);
 await f.service.start();await finish(f);const d=(await f.read('trains-data')).value;
 assert.ok(d.rows.some(r=>r.id==='old'));assert.ok(d.rows.some(r=>r.reference==='DEC'));assert.equal((await f.read('trains-job')).value.status,'partial');
 assert.match(d.checks['NS NOV'].issues[0],/400/);
});
test('durable discovery resumes mid-page without skipping references',async()=>{
 const f=fixture({budgetMs:1});await f.service.start();await f.service.run();assert.equal((await f.read('trains-job')).value.status,'running');
 await finish(f);assert.equal((await f.read('trains-job')).value.done,3);
 assert.equal((await f.read('trains-job')).value.scanned,4);
});
test('daily import is once per Amsterdam day, overlaps watermark and does not race an active job',async()=>{
 const f=fixture();await f.service.daily();assert.equal((await f.read('trains-job')).value.status,undefined);
 await f.service.start();await finish(f);const first=(await f.read('trains-job')).value;
 await f.service.daily();assert.equal((await f.read('trains-job')).value.id,first.id);
 f.advance(86400000);await f.service.daily();const next=(await f.read('trains-job')).value;
 assert.notEqual(next.id,first.id);assert.equal(next.daily,true);assert.equal(Date.parse(next.since),Date.parse(first.until)-86400000);
 await f.service.daily();assert.equal((await f.read('trains-job')).value.id,next.id);
});
test('newest cancellation removes its old trains but not another dossier',async()=>{
 const f=fixture();f.messages.a.payload.headers[1].value=f.messages.a.payload.headers[1].value.replace('Bevestiging','Annulering');
 await f.write('trains-data',{rows:[{id:'old',reference:'NOV',date:'2026-11-01'},{id:'other',reference:'OTHER',date:'2026-11-01'}]},0);
 await f.service.start();await finish(f);const rows=(await f.read('trains-data')).value.rows;assert.ok(!rows.some(r=>r.id==='old'));assert.ok(rows.some(r=>r.id==='other'));
});
test('daily newly booked trains also include dates outside the initial backfill period',async()=>{
 const f=fixture();f.messages.a.payload.headers[1].value=f.messages.a.payload.headers[1].value.replace('01/11/2026','01/11/2028');
 await f.service.start({daily:true});await finish(f);
 assert.ok((await f.read('trains-data')).value.rows.some(r=>r.date==='2028-11-01'));
});
