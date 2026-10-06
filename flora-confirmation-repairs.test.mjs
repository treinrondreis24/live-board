import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,cancellation,cancellationApplies,matchEvidence} from './flora-mail-parser.mjs';
import {createMailControl,latestReservationState,rememberCancellation} from './flora-mail.mjs';
import {emptyState} from './flora-store.mjs';
import {confirmSource} from './flora-source-review.mjs';
import {stays,stayGroups} from './flora-engine.mjs';
import {adjacentNightStay} from './flora-identity.mjs';

const request='Arrival date: 02 Oct 2026 Departure date: 05 Oct 2026 Customer name: Test Reiziger Rooms: 1 x Twin room Persons: Test Reiziger (adult) Other Reiziger (adult) Our reference: 6534A';
const reply={id:'reply',threadId:'thread',from:'Wien.CityHauptbahnhof@premierinn.com',subject:'AW: New reservation request nr 6534A Wien',at:'2026-09-01T12:00:00Z',url:'https://mail.google.com/mail/u/0/#all/reply',issues:[],version:7,docs:[{label:'E-mail',text:'Good afternoon, The reservation has been made. Thank you! From: reservations '+request}]};
const booking={_id:'b',index:6534,status:'afgehandeld',dateDeparture:'2026-10-01',dateReturn:'2026-10-06',passengers:[{firstName:'Test',lastName:'Reiziger'},{firstName:'Other',lastName:'Reiziger'}],todos:[{_key:'h',title:'Premier inn Wien | Twin',tag:'hotel',startDate:'2026-10-02',endDate:'2026-10-05'}]};

test('short Premier reply links its quoted request; sent request and quoted confirmations do not',()=>{
 const e=parseDocument(reply.docs[0],reply);assert.equal(e.capacity,2);assert.equal(e.start,'2026-10-02');assert.equal(matchEvidence(e,booking).todoKey,'h');
 for(const text of [request,'Can the reservation be made? From: '+request,'We cannot confirm. From: The reservation has been made. '+request])assert.equal(parseDocument({label:'E-mail',text},reply),null);
 assert.equal(parseDocument(reply.docs[0],{...reply,from:'reservations@treinrondreis.nl'}),null);
});
test('targeted run saves reply proof and replaces previous incomplete status without scanning other trips',async()=>{
 let state={...emptyState(),bookings:[booking],emailChecks:{6534:{stays:[{todoKey:'h',state:'incomplete',errors:[{detail:'old error'}]}]}}};const kv=new Map([['message:reply',{value:reply,revision:1}]]),queries=[];
 const control=createMailControl({read:async k=>structuredClone(kv.get(k)||{value:{},revision:0}),write:async(k,value,r)=>{kv.set(k,{value:structuredClone(value),revision:r+1});return r+1;},readState:async()=>({state:structuredClone(state),revision:0}),writeState:async s=>{state=s;return 1;},sync:async()=>[booking],google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{queries.push({path,...args});return {messages:[{id:'reply'}]};}}});
 await control.start({mode:'targeted',trips:['6534']});await control.tick();assert.equal((await control.status()).status,'completed');assert.equal(state.emailChecks['6534'].stays[0].state,'found');assert.equal(state.evidence[0].todoKey,'h');assert.ok(queries.some(q=>q.path==='threads/thread'));assert.ok(!queries.some(q=>q.q?.includes('after:')));
});
test('Teldar joins pages within the same voucher and keeps supplier reference alias',()=>{
 const m={...reply,from:'klantenservice@teldartravel.com',subject:'Hotel booked',docs:[{label:'voucher.pdf Â· pagina 1',text:'YOUR VOUCHER paid directly at hotel check-out Ibis Napoli Phone number: 123 Arrival 29/09/2026 Departure 05/10/2026 Reference MPT64G Supplier Booking Number QNTDBXTG Pax names Adult(s) Children Type of room(s) Test Reiziger 2 0 Double Room'},{label:'voucher.pdf Â· pagina 2',text:'FOR HOTEL USE ONLY This booking has been made, paid for and confirmed by Teldar Travel.'}]};
 const e=parseDocument(m.docs[0],m);assert.equal(e.reference,'MPT64G');assert.deepEqual(e.alternateReferences,['QNTDBXTG']);assert.equal(parseDocument(m.docs[1],m),null);
 const b={...booking,todos:[{...booking.todos[0],title:'ibis Napoli',supplierBookingNumber:'QNTDBXTG',startDate:'2026-09-29',endDate:'2026-10-05'}]};assert.equal(matchEvidence(e,b).todoKey,'h');
 assert.equal(parseDocument(m.docs[0],{...m,docs:[m.docs[0],{...m.docs[1],label:'other.pdf Â· pagina 2'}]}),null);
});
test('Teldar room cancellation cancels only matching single-room base voucher',()=>{
 const c=cancellation({...reply,from:'klantenservice@teldartravel.com',subject:'HOTEL BOOKING CANCELLATION: KYULGM/1 - Test Reiziger',docs:[{label:'E-mail',text:'Booking KYULGM/1 for Hotel Agumar Atocha located in Madrid was cancelled. Checkin: 2026-11-04 Checkout: 2026-11-05'}]});
 const e={provider:'Teldar',reference:'KYULGM',name:'Test Reiziger',start:'2026-11-04',end:'2026-11-05',roomCount:1,observedAt:'2026-08-01',status:'confirmed'};assert.ok(cancellationApplies(c,e));for(const change of [{reference:'KYULGM/2'},{roomCount:2},{name:'Other Reiziger'},{start:'2026-11-06'}])assert.equal(cancellationApplies(c,{...e,...change}),false);
 const state={};rememberCancellation(state,c);assert.equal(latestReservationState(state,e).status,'cancelled');
});
test('Premier UK HTML accepts all rooms under one reference, not partial room parsing',()=>{
 const text="It's all booked! Booking reference: ACU2212343 You have booked 2 rooms Your stay with us Fort William Loch Iall Wed 7 Oct 2026 Check-in from 3pm Fri 9 Oct 2026 Check out by 12pm Booking summary Test Reiziger 1 adult in a Double room Â£259.00 Other Reiziger 2 adults in a Double room Â£259.00";
 const m={...reply,subject:'Your booking is confirmed. Ref no. ACU2212343',from:'donotreply@picomms.premierinn.com'};const e=parseDocument({label:'E-mail',text},m);assert.equal(e.roomCount,2);assert.equal(e.capacity,4);assert.equal(e.occupants,3);assert.equal(e.reference,'ACU2212343');assert.equal(parseDocument({label:'E-mail',text:text.replace('2 rooms','3 rooms')},m),null);
});
test('dated hotel with explicit supplier reference survives wrong copied label',()=>{const b={...booking,todos:[{...booking.todos[0],tag:'station',title:'Intercityhotel Duisburg',supplierBookingNumber:'123456789'}]};assert.equal(stays(b).length,1);b.todos[0].title='Vertrekstation Duisburg';assert.equal(stays(b).length,0);});
test('same night train rooms resolve by room type and aggregate capacity for the journey',()=>{
 const b={...booking,todos:[{_key:'four',tag:'hotel',title:'40421 (EUN)(RIT) | privÃ© RICA4',startDate:'2026-10-01',endDate:'2026-10-02'},{_key:'two',tag:'hotel',title:'40421 (EUN)(RIT) | RITAD',startDate:'2026-10-01',endDate:'2026-10-02'},booking.todos[0]]};
 const e={provider:'NS International',reference:'DNRTEST/0',tripHint:'6534',name:'Test Reiziger',product:'Amsterdam â†’ Wien',direction:'outbound',start:'2026-10-01',end:'2026-10-02',room:'Couchette 4'};assert.equal(matchEvidence(e,b).todoKey,'four');assert.equal(matchEvidence({...e,room:'Private compartment'},b).todoKey,'two');assert.equal(stayGroups(b)[0].todoKeys.length,2);
});
test('night train geography respects direction and adjacent dates',()=>{const e={direction:'outbound',product:'Amsterdam â†’ ZÃ¼rich',start:'2026-12-11',end:'2026-12-12'},b={todos:[{tag:'hotel',title:'Hotel Milano',startDate:'2026-12-12',endDate:'2026-12-15'}]};assert.ok(adjacentNightStay(e,b));assert.equal(adjacentNightStay({...e,direction:'inbound',start:'2026-12-15'},b),false);assert.equal(adjacentNightStay({...e,end:'2026-12-13'},b),false);});
test('manual source decision requires actual candidate, explicit fields and confirmation and keeps other errors',()=>{
 const state={...emptyState(),bookings:[booking],findings:[{id:'f',trip:'6534',todoKey:'h',fingerprint:'v'}],emailChecks:{6534:{stays:[{todoKey:'h',state:'incomplete',sources:[{id:'reply',url:reply.url,at:reply.at}],errors:[{message:'other',detail:'unreadable'}]}]}}};
 const input={findingId:'f',fingerprint:'v',messageId:'reply',confirmed:true,fields:{provider:'Premier Inn',reference:'MANUAL1',product:'Premier Inn Wien',name:'Test Reiziger',start:'02-10-2026',end:'05-10-2026',capacity:'2',occupants:'2'}};
 assert.throws(()=>confirmSource(state,{...input,confirmed:false},'staff','2026-10-04'));assert.throws(()=>confirmSource(state,{...input,messageId:'invented'},'staff','2026-10-04'));confirmSource(state,input,'staff','2026-10-04');assert.equal(state.evidence[0].source,reply.url);assert.equal(state.emailChecks['6534'].stays[0].state,'incomplete');assert.equal(state.audit.length,1);
});
test('hotel mail label does not associate an unrelated forwarded train read error',async()=>{
 const b={...booking,todos:[{...booking.todos[0],title:'Premier inn Wien (mail) | Twin'}]},train={...reply,id:'oldtrain',from:'reservations@treinrondreis.nl',subject:'Old rail ticket',docs:[{label:'E-mail',text:'Old mail about a train to Paris'}],issues:['Ticketlink HTTP 400']};
 const c=createMailControl({read:async key=>({value:key.endsWith('reply')?reply:train,revision:1}),write:async()=>2,extract:async()=>train});
 const result=await c.processBooking(b,async path=>({messages:path.startsWith('threads/')?[]:[{id:'reply'},{id:'oldtrain'}]}),{});assert.equal(result.checks[0].state,'found');assert.deepEqual(result.checks[0].errors,[]);
});
test('NS truncated first name with wrong trip hint links only when dates and journey agree',()=>{
 const b={...booking,index:6621,dateDeparture:'2026-12-27',dateReturn:'2027-01-03',passengers:[{firstName:'Willibrordus Johannes',lastName:'Buursen'}],todos:[{_key:'train',tag:'hotel',title:'40421 RIT 2x RITAM',startDate:'2026-12-27',endDate:'2026-12-28'},{_key:'hotel',tag:'hotel',title:'Premier Inn Wien',startDate:'2026-12-28',endDate:'2027-01-02'}]};
 const e={provider:'NS International',reference:'VLBSTJL/0',tripHint:'6612',name:'Willibrord Buursen',product:'Arnhem â†’ Wien',direction:'outbound',start:'2026-12-27',end:'2026-12-28',capacity:2,room:'Mini Cabin'};assert.equal(matchEvidence(e,b).trip,'6621');assert.equal(matchEvidence(e,b).tripReferenceMismatch,'6612');assert.equal(matchEvidence({...e,start:'2026-12-26'},b),null);
});
