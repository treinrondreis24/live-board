import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,DEFAULT_RULES} from './flora-engine.mjs';
import {parseDocument,latestNSTickets} from './flora-mail-parser.mjs';
import {rebuildStoredEvidence} from './flora-reconcile.mjs';
import {extractMessage} from './flora-mail-source.mjs';
const now='2026-10-06T12:00:00Z';
const booking=()=>({_id:'b',index:42,status:'afgehandeld',firstName:'Eva',lastName:'Test',dateDeparture:'2026-10-20',passengers:[{firstName:'Eva',lastName:'Test'}],todos:[{_key:'a',tag:'hotel',title:'Hotel Victoria Basel',startDate:'2026-10-20',endDate:'2026-10-21',done:true}]});
const proof=(extra={})=>({id:'a',trip:'42',todoKey:'a',provider:'Hotel',reference:'12345',status:'confirmed',start:'2026-10-20',end:'2026-10-21',product:'Hotel Victoria Basel',name:'Eva Test',...extra});
test('all eight staff names are retained for inspection without attention; similar surnames remain open',()=>{
 for(const name of DEFAULT_RULES.exceptions){const s={bookings:[],evidence:[proof({trip:'',name:name+' SH123456'})]};const f=evaluate(s,now).findings;assert.equal(f.length,1);assert.equal(f[0].status,'accepted');assert.equal(f[0].evidence.length,1);}
 assert.equal(evaluate({bookings:[],evidence:[proof({trip:'',name:'Marc van der Leeuwen'})]},now).findings[0].status,'alarm');
});
test('missing evidence always remains visible; confirmed hotel with only an unanswered request raises alarm',()=>{
 const b=booking(),s={bookings:[b],evidence:[]};let f=evaluate(s,now).findings.find(f=>f.code==='missing');assert.equal(f.status,'attention');assert.equal(f.priority,'redelijk hoog');
 s.emailChecks={'42':{stays:[{todoKey:'a',state:'candidates',sources:[{subject:'New reservation request nr 42A Montpellier'}],explanation:'Only a request found'}]}};assert.equal(evaluate(s,now).findings.find(f=>f.code==='missing').status,'alarm');
 s.emailChecks['42'].stays[0].sources.push({subject:'Re: New reservation request nr 42A Montpellier'});assert.equal(evaluate(s,now).findings.find(f=>f.code==='missing').status,'attention');
 b.todos[0].done=false;b.dateDeparture='2027-04-01';assert.equal(evaluate(s,now).findings.find(f=>f.code==='missing').priority,'laag');
 b.dateDeparture='2026-10-08';assert.equal(evaluate(s,now).findings.find(f=>f.code==='missing').priority,'hoog');
});
test('two hotels on one night are an alarm across todos; cancellation or adjacent nights removes it',()=>{
 const b=booking();b.todos.push({...b.todos[0],_key:'b',title:'Hotel Bernina Tirano'});const other=proof({id:'b',todoKey:'b',reference:'67890',product:'Hotel Bernina Tirano'}),s={bookings:[b],evidence:[proof(),other]};
 assert.ok(evaluate(s,now).findings.some(f=>f.code.startsWith('hotel-overlap-')&&f.status==='alarm'));
 other.status='cancelled';assert.ok(!evaluate(s,now).findings.some(f=>f.code.startsWith('hotel-overlap-')));
 other.status='confirmed';other.start='2026-10-21';other.end='2026-10-22';assert.ok(!evaluate(s,now).findings.some(f=>f.code.startsWith('hotel-overlap-')));
});
test('two rooms overlapping another hotel produce one alarm including the wrong-date detail and all references',()=>{
 const b=booking();b.todos[0].startDate='2026-10-19';b.todos[0].endDate='2026-10-20';b.todos.push({...b.todos[0],_key:'b',title:'Hotel Bernina',startDate:'2026-10-20',endDate:'2026-10-21'});
 const s={bookings:[b],evidence:[proof(),proof({id:'b1',todoKey:'b',reference:'Bernina1',product:'Hotel Bernina',group:'rooms',occupants:1}),proof({id:'b2',todoKey:'b',reference:'Bernina2',product:'Hotel Bernina',group:'rooms',occupants:0})]};
 const f=evaluate(s,now).findings,overlap=f.filter(f=>f.code.startsWith('hotel-overlap-'));
 assert.equal(overlap.length,1);assert.equal(overlap[0].evidence.length,3);assert.match(overlap[0].detail,/Todo verwacht 2026-10-19/);assert.ok(!f.some(f=>f.code.startsWith('dates-')));
 s.evidence[1].status='cancelled';s.evidence[2].status='cancelled';assert.ok(evaluate(s,now).findings.some(f=>f.code.startsWith('dates-')&&f.status==='alarm'));
});
test('NS option does not become evidence or cancel a real ticket; cached options remain inspectable',()=>{
 const m={id:'option',subject:'Optieboeking, boekingscode: ABCDEFG',from:'no-reply@confirmation.nsinternational.nl',at:now,docs:[],hasLinks:true};assert.equal(parseDocument({label:'ticket',text:'irrelevant'},m),null);
 const e=proof({provider:'NS International',reference:'ABCDEFG/0',ticketLink:'ticket',observedAt:'2026-10-01'});assert.equal(latestNSTickets([e],[m])[0].status,'confirmed');
 const s={bookings:[],evidence:[{...e,automaticEmail:true,messageId:'option'}]};rebuildStoredEvidence(s,[m],now);assert.equal(s.evidence[0].status,'option');assert.equal(s.findings.length,0);assert.equal(s.evidenceRevisions[0].evidence[0].status,'confirmed');
});
test('HTML confirmation is read when the plain alternative is empty; exact Victoria source dates are preserved',async()=>{
 const html='We are pleased to confirm the following booking. RESERVATION DETAILS GUEST NAME Eva Test RESERVATION NUMBER 1079602327 ARRIVAL DATE Tuesday, October 20, 2026 DEPARTURE DATE Wednesday, October 21, 2026 ROOM TYPE Classic Queen NIGHTLY RATE 210.00 CHF';
 const raw={id:'victoria',internalDate:Date.parse(now),payload:{headers:[{name:'From',value:'hotel.victoria@balehotels.ch'},{name:'Subject',value:'Reservation confirmed for Eva Test at Hotel Victoria'}],parts:[{mimeType:'text/plain',body:{data:''}},{mimeType:'text/html',body:{data:Buffer.from(html).toString('base64url')}}]}};
 const m=await extractMessage(raw,()=>{throw Error('No attachment needed');}),e=parseDocument(m.docs[0],m);assert.equal(e.reference,'1079602327');assert.equal(e.start,'2026-10-20');assert.equal(e.end,'2026-10-21');assert.equal(e.name,'Eva Test');
});
test('four actual NS tickets cover two passengers per compartment on each direction despite obsolete note',()=>{
 const b=booking();b.passengers=Array.from({length:4},(_,i)=>({firstName:i<2?'Eva':'Anna',lastName:'Test'}));b.notes='Heenreis uitverkocht voor 2 pers';b.todos=[{_key:'out',tag:'hotel',title:'NJ Amsterdam - Wenen: 2x RITAD',startDate:'2026-12-17',endDate:'2026-12-18'},{_key:'back',tag:'hotel',title:'NJ Wenen - Amsterdam: 2x RITAD',startDate:'2026-12-20',endDate:'2026-12-21'}];
 const es=[['out',3,'17.12','18.12','AMSTERDAM CENTRAAL','WIEN HBF'],['out',4,'17.12','18.12','AMSTERDAM CENTRAAL','WIEN HBF'],['back',1,'20.12','21.12','WIEN HBF','AMSTERDAM CENTRAAL'],['back',2,'20.12','21.12','WIEN HBF','AMSTERDAM CENTRAAL']].map(([todoKey,id,start,end,from,to])=>{
  const d={label:'ticket',text:`DNR: ABCDEFG ID:${id} VERVOERBEWIJS + RESERVERING CIV 1184 NIGHTJET TEST, EVA02 VOLWASSENEN DIT TICKET ${start} 19:00 ${from} -> ${to} ${end} 09:00 TREIN40421 NJ BEDPLAATS 61 62 DO 02 RIT`,year:'2026'};
  return {...parseDocument(d,{id:'m',subject:'Bevestiging vertrekdatum: 17/09/2026',at:now,url:'ticket',docs:[d]}),trip:'42',todoKey,productMatch:true};
 });
 assert.ok(es.every(e=>e.capacity===2&&e.occupants===2));assert.ok(!evaluate({bookings:[b],evidence:es},now).findings.some(f=>['capacity','occupancy','duplicate'].includes(f.code)));
});
