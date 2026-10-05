import test from 'node:test';
import assert from 'node:assert/strict';
import {dfdsLegDocuments,dfdsLinks,safeDFDSURL,dfdsPDF,latestDFDS,dfdsCabinMismatch} from './flora-dfds.mjs';
import {parseDocument,matchEvidence,cancellation,cancellationApplies,bookingQuery} from './flora-mail-parser.mjs';
import {extractMessage} from './flora-mail-source.mjs';
import {evaluate} from './flora-engine.mjs';
import {createMailControl} from './flora-mail.mjs';
import {emptyState} from './flora-store.mjs';
const out='IJmuiden - Newcastle',back='Newcastle - IJmuiden';
const leg=(route,start,end)=>`${route}: Naam schip: King Seaways\nVertrek: wo ${start} 17:30, Aankomst: do ${end} 09:15\n2 Volwassenen,\n1 x 4-persoons, binnenhut, stapelbedden\nOntbijtbuffet\n2 Ontbijt - Volw.\n`;
const pages=['Boekingsnummer:23730209-2 Naam: Test Reiziger Tel.nr: 001234 Referentie reisagent: Agent\n'+leg(out,'9-12-2026','10-12-2026')+leg(back,'12-12-2026','13-12-2026')+'DFDS BOEKINGS BEVESTIGING','Gastenlijst: IJmuiden - Newcastle\nMr Test Reiziger & Ms Other Reiziger'];
const message={id:'m',from:'DFDS <email@dfds.info>',subject:'Bedankt voor je boeking! - 23730209',url:'https://mail.google.com/mail/#all/m',at:'2026-09-01',issues:[],docs:[]};
const evidence=()=>dfdsLegDocuments(pages).map(d=>parseDocument(d,message));
const b={_id:'test',index:6622,status:'verwerkt',notes:'DFDS: 23730209',passengers:[{firstName:'Test',lastName:'Reiziger'},{firstName:'Other',lastName:'Reiziger'}],todos:[{_key:'out',tag:'hotel',title:'DFDS Shortbreak IJmuiden -> Newcastle | Double Inside or 4-pers',startDate:'2026-12-09',endDate:'2026-12-10'},{_key:'back',tag:'hotel',title:'DFDS Newcastle -> IJmuiden | Double Inside or 4-pers',startDate:'2026-12-12',endDate:'2026-12-13'}]};
test('multi-page return confirmation yields two legs, not two duplicate reservations',()=>{
 const rows=evidence();assert.equal(rows.length,2);assert.equal(rows[0].name,'Test Reiziger');assert.equal(rows[0].capacity,4);assert.equal(rows[0].occupants,2);assert.equal(rows[1].start,'2026-12-12');
 const linked=rows.map(e=>matchEvidence(e,b));assert.deepEqual(linked.map(e=>e.todoKey),['out','back']);assert.ok(linked.every(e=>e.productMatch));
 const r=evaluate({bookings:[b],evidence:linked},'2026-10-05');assert.equal(r.findings.length,0);
 assert.ok(bookingQuery(b).includes('"23730209"'));
});
test('route contradiction, insufficient passengers, wrong dates and unrelated traveler are not approved',()=>{
 const [e]=evidence();assert.equal(matchEvidence(e,{...b,index:6666,notes:'',passengers:[{firstName:'Someone',lastName:'Else'}]}),null);
 assert.equal(matchEvidence(e,{...b,todos:[{...b.todos[0],title:'DFDS Newcastle -> IJmuiden'}]}).productMatch,false);
 const linked=matchEvidence({...e,occupants:1,capacity:1},b);const r=evaluate({bookings:[b],evidence:[linked]},'2026-10-05');assert.ok(r.findings.some(f=>f.code==='capacity'));assert.ok(r.findings.some(f=>f.code==='occupancy'));
 const wrong=matchEvidence({...e,start:'2026-12-08'},b);assert.ok(evaluate({bookings:[b],evidence:[wrong]},'2026-10-05').findings.some(f=>f.code.startsWith('dates-')));
});
test('confirmed base cancellation applies to both directions, never to other references',()=>{
 const c=cancellation({...message,subject:'Je boeking is geannuleerd - 23730209',docs:[{label:'E-mail',text:'Boekingsnummer: 23730209 De boeking van jouw klant is geannuleerd.'}]});assert.ok(c);assert.ok(evidence().every(e=>cancellationApplies(c,e)));assert.equal(cancellationApplies(c,{provider:'DFDS',reference:'12345678/outbound'}),false);
 assert.equal(cancellation({...message,subject:'Annulering aanvragen',docs:[{label:'E-mail',text:'Graag boeking 23730209 annuleren'}]}),null);
});
test('latest complete amendment retires a removed return leg, unreadable changes do not',()=>{
 const rows=evidence(),newMessage={...message,id:'new',subject:'Je boeking is gewijzigd - 23730209',at:'2026-09-02'};
 const next={...rows[0],messageId:'new',observedAt:newMessage.at,start:'2026-12-10',end:'2026-12-11'};
 assert.equal(latestDFDS([...rows,next],[message,newMessage])[1].status,'superseded');
 assert.equal(latestDFDS([...rows,next],[message,{...newMessage,issues:['unreadable']}])[1].status,'confirmed');
});
test('only booking confirmation links from DFDS are fetched, redirects stay within read-only endpoints',async()=>{
 const url='https://links.dfds.info/s/c/abc/123',html=`<a href="${url}">DOWNLOAD BOEKINGSBEVESTIGING AGENT</a><a href="https://www.dfds.com/cancel">DOWNLOAD BOEKINGSBEVESTIGING</a>`;
 assert.deepEqual(dfdsLinks(html,message.from),[url]);assert.deepEqual(dfdsLinks(html,'sender@dfds.info.evil.test'),[]);
 for(const u of ['http://dfds.com/api/booking-confirmation/12345678/ABCD','https://dfds.com/cancel','https://127.0.0.1/sbwapi/booking/reservation/itinerarypdf'])assert.equal(safeDFDSURL(u),null);
 await assert.rejects(dfdsPDF(url,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.test/ticket'}}),readPDF:async()=>[]}),/niet ondersteund/);
 let count=0;const m=await extractMessage({id:'m',internalDate:Date.now(),payload:{headers:[{name:'From',value:message.from},{name:'Subject',value:message.subject}],parts:[{mimeType:'text/html',body:{data:Buffer.from(html).toString('base64url')}}]}},()=>{}, {readDFDS:async()=>{count++;return pages;}});
 assert.equal(count,1);assert.equal(m.issues.length,0);assert.equal(m.docs.filter(d=>d.dfdsLeg).length,2);assert.equal(m.dfdsVersion,1);
});
test('DFDS-only control preserves hotel checks and never performs a broad mailbox scan',async()=>{
 const hotel={_key:'hotel',tag:'hotel',title:'Hotel Test',startDate:'2026-12-10',endDate:'2026-12-12'},booking={...b,todos:[...b.todos,hotel]};
 let state={...emptyState(),bookings:[booking],emailChecks:{6622:{stays:[{todoKey:'hotel',state:'found',explanation:'preserve'}]}},emailCheckpoint:{at:'unchanged'}};
 const kv=new Map(),queries=[];
 const c=createMailControl({read:async k=>structuredClone(kv.get(k)||{value:{},revision:0}),write:async(k,value,r)=>{kv.set(k,{value:structuredClone(value),revision:r+1});return r+1;},readState:async()=>({state:structuredClone(state),revision:0}),writeState:async s=>{state=s;return 1;},sync:async()=>[booking],google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{queries.push(args.q);return {messages:[]};}}});
 await c.start({mode:'dfds'});await c.tick();
 assert.equal((await c.status()).status,'completed');assert.ok(queries.length);assert.ok(queries.every(q=>q.includes('from:dfds.info')));
 assert.equal(state.emailChecks['6622'].stays.find(c=>c.todoKey==='hotel').explanation,'preserve');assert.equal(state.emailCheckpoint.at,'unchanged');assert.equal(kv.has('discovery'),false);
});
test('destination-only todo names still check the booked direction',()=>{
 const [e]=evidence();assert.equal(matchEvidence(e,{...b,todos:[{...b.todos[0],title:'DFDS IT NAAR -> Newcastle 2026'}]}).productMatch,true);
 assert.equal(matchEvidence(e,{...b,todos:[{...b.todos[0],title:'DFDS IT NAAR -> IJmuiden 2026'}]}).productMatch,false);
});
test('cabin downgrade is visible; extra capacity and a sea-view upgrade are not problems',()=>{
 assert.equal(dfdsCabinMismatch('Double OUTSIDE or 4-pers','1 x 4-persoons binnenhut'),true);
 assert.equal(dfdsCabinMismatch('Double Inside or 4-pers','1 x 4-persoons zeezichthut'),false);
 assert.equal(dfdsCabinMismatch('Double Inside or 4-pers','1 x 4-persoons binnenhut'),false);
});
