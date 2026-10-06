import test from 'node:test';
import assert from 'node:assert/strict';
import {matchTravelerName} from './flora-names.mjs';
import {evaluate,findingPriority} from './flora-engine.mjs';
import {parseDocument,resolveEvidence} from './flora-mail-parser.mjs';
import {emptyState} from './flora-store.mjs';
import {createMailControl,mailPlan} from './flora-mail.mjs';
import {rebuildStoredEvidence,INTERPRETATION_VERSION} from './flora-reconcile.mjs';
const person={firstName:'Maria Johanna Elisabeth',lastName:'Visser e/v De Jong'};
test('later names may be absent or initials; any passenger and e/v omission are accepted',()=>{
 for(const name of ['Maria Visser','Maria J E Visser','Maria Johanna Visser'])assert.equal(matchTravelerName(name,[{firstName:'Other',lastName:'Person'},person]),'exact',name);
 assert.equal(matchTravelerName('Ria Visser',[person]),'partial');
 assert.equal(matchTravelerName('Maria Other',[person]),'different');
 assert.equal(matchTravelerName('DUNC VAN SLIEDREGT',[{firstName:'Duncan',lastName:'van Sliedregt'}],{truncated:true}),'exact');
 assert.equal(matchTravelerName('Ben Bilderbeek',[{firstName:'Bernard',lastName:'Bilderbeek'}]),'partial');
});
test('priority scale keeps unknown capacity and wrong reference low, actual undersizing alarm',()=>{
 for(const code of ['capacity-unknown','trip-reference','room-x','name-x','cancelled-todo'])assert.equal(findingPriority(code,'attention'),'laag');
 assert.equal(findingPriority('missing','attention'),'gemiddeld');assert.equal(findingPriority('unlinked-x','attention'),'redelijk hoog');assert.equal(findingPriority('capacity','alarm'),'hoog');
});
const message=(from,text,subject='Re: New reservation request 6685A',label='E-mail')=>({id:'test',from,subject,at:'2026-10-04T02:00:00Z',url:'https://mail.google.com/mail/u/0/#all/test',issues:[],docs:[{label,text}]});
const parse=m=>parseDocument(m.docs[0],m);
const booking=()=>({_id:'b',index:6685,status:'te verwerken',dateDeparture:'2027-01-13',dateReturn:'2027-01-15',passengers:[{firstName:'Maria Johanna',lastName:'Visser'}],todos:[{_key:'hotel',tag:'hotel',title:'Hotel ABC Chur | Double',startDate:'2027-01-13',endDate:'2027-01-15',supplierBookingNumber:'123456789',done:true}]});
test('ABC welcome proves existence but never invents checkout from todo',()=>{
 const e=parse(message('abc@hotelabc.ch','Hello Maria Visser! Welcome to Hotel ABC and thank you for your reservation! Your arrival day: 13.01.2027 Please use the reservation number 123456789'));
 assert.equal(e.start,'2027-01-13');assert.equal(e.end,'');
 const b=booking(),s={...emptyState(),bookings:[b],evidence:[resolveEvidence(e,[b])]};const r=evaluate(s);
 assert.ok(r.findings.some(f=>f.code.startsWith('dates-incomplete')));assert.equal(r.summary[0].checked,false);assert.equal(r.findings.some(f=>f.code==='missing'),false);
});
test('Post Chur reads confirmed dates, guest and single-use room from PDF',()=>{
 const e=parse(message('hotel@postchur.ch','BUCHUNGSBESTÄTIGUNG Reservierungsnummer: 89556 Gastname: Visser, Maria Anreise: 12.10.2026 Abreise: 13.10.2026 Zimmerkategorie: 109 Superior Doppel s.use Personen: 1','Confirmation','booking.pdf'));
 assert.equal(e.name,'Maria Visser');assert.equal(e.capacity,1);assert.equal(e.end,'2026-10-13');
});
test('Montpellier confirmation uses its own US dates verified against nights, not quoted request',()=>{
 const e=parse(message('contact@lhotel-montpellier.com','Old request Arrival date: 04 Apr 2026 Booking confirmation 144775 Guest name: VISSER , MARIA Arrival date: 04-04-2027 from 15:00 Departure date: 04-05-2027 before 12:00 Number of night(s): 1 Room type: Chambre Classic Double Number of person(s): 2 Adult(s)'));
 assert.equal(e.start,'2027-04-04');assert.equal(e.end,'2027-04-05');assert.equal(e.occupants,2);
});
test('Nightjet confirmation is evidence, but arrival and berths stay unknown until ticket is read',()=>{
 const e=parse(message('nightjet@oebb.at','Buchungscode: 0941 4521 6560 0847 Buchungsdatum: 01.10.2026 Ihre Buchungen Amsterdam Centraal &rsaquo; Wien Hbf gilt am 17.12.2026 um 19:00 Visser Maria, Visser Jan Wagennummer 432, Platznummer(n) 51, 52','nightjet.com Buchung'));
 assert.equal(e.provider,'ÖBB');assert.equal(e.start,'2026-12-17');assert.equal(e.capacity,null);assert.equal(e.direction,'outbound');
});
test('Finnlines accepts supplier booking reply with explicit request dates, never an outgoing request',()=>{
 const text='Hello, The crossing has been booked. Herzliche Grüße Inna From Travemünde to Helsinki Departure date: 17 Nov 2026 Arrival date: 18 Nov 2026 Customer name: Maria Visser Rooms: 1 x Outside cabin Persons: Maria Visser (01 Jan 1980) Our reference: 6685A';
 const e=parse(message('passagierdienst@finnlines.com',text,'New reservation request (6685A) // F260186942'));
 assert.equal(e.start,'2026-11-17');assert.equal(e.end,'2026-11-18');assert.equal(e.reference,'F260186942');assert.equal(parse(message('reservations@treinrondreis.nl',text)),null);
});
test('Teldar deadline reminder proves an existing reservation, not a cancellation',()=>{
 const e=parse(message('klantenservice@teldartravel.com','You may cancel reservation Z7WJEM/1 without charge. HOTEL NAME: Hotel Continentale CITY: Arezzo CHECKIN: 13/10/2026 CHECKOUT: 15/10/2026 NET PRICE: 200 PASSANGER NAMES: Maria Visser, Jan Visser Note that the cost begins in 72 hours.','Days to cancel the reservation Z7WJEM/1 without charge'));
 assert.equal(e.status,'confirmed');assert.equal(e.name,'Maria Visser');assert.equal(e.end,'2026-10-15');
});
test('Premier Inn UK confirmation is read directly from email',()=>{
 const e=parse(message('donotreply@picomms.premierinn.com','Booking reference: BGH1587500 You have booked 1 room for 2 adults Your stay with us Aberystwyth 36-37 Marine Terrace Sat 2 Jan 2027 Check-in from 3pm Mon 4 Jan 2027 Check out by 12pm Booking summary Maria Visser 2 adults in a Double room £125.00','Your booking is confirmed. Ref no. BGH1587500'));
 assert.equal(e.end,'2027-01-04');assert.equal(e.capacity,2);assert.equal(e.product,'Premier Inn Aberystwyth');
});
test('wrong trip number only links with unique identity, hotel and exact dates',()=>{
 const b=booking(),e={provider:'Hotel',reference:'unused',name:'Maria Visser',product:'Hotel ABC Chur',start:'2027-01-13',end:'2027-01-15',tripHint:'9999',status:'confirmed',room:'Double'};
 assert.equal(resolveEvidence(e,[b]).tripReferenceMismatch,'9999');assert.equal(resolveEvidence({...e,start:'2027-01-12'},[b]).todoKey,'');
 assert.equal(resolveEvidence(e,[b,{...b,_id:'other',index:6686}]).todoKey,'');
});
test('rules-only rechecks attention without Gmail or touching unrelated evidence',async()=>{
 let state={...emptyState(),bookings:[booking()],findings:[{id:'6685:hotel:missing',trip:'6685',status:'attention',priority:'normaal',history:[]}],evidence:[]};
 const kv=new Map(),control=createMailControl({read:async k=>structuredClone(kv.get(k)||{value:{},revision:0}),write:async(k,value,r)=>{kv.set(k,{value:structuredClone(value),revision:r+1});return r+1;},readState:async()=>({state:structuredClone(state),revision:1}),writeState:async s=>{state=s;return 2;},google:{status:async()=>{throw Error('Gmail must not be used');},reader:async()=>{throw Error('Gmail must not be used');}}});
 await control.start({mode:'rules-only'});await control.tick();const status=await control.status();assert.equal(status.status,'completed');assert.equal(status.done,1);assert.equal(status.outcome.reviewed,1);assert.equal(status.messages,0);assert.equal(state.findings.find(f=>f.code==='missing').priority,'laag');
});
test('attention mail plan skips unrelated alarms and no-Gmail recheck includes orphan attention',()=>{
 const state={...emptyState(),bookings:[booking(),{...booking(),_id:'other',index:6686}],findings:[{trip:'6685',status:'attention'},{trip:'6686',status:'alarm'},{trip:'onbekend',status:'attention'}]};
 assert.deepEqual(mailPlan(state,false,'2026-10-04T00:00:00Z','attention'),['6685']);assert.deepEqual(mailPlan(state,false,'2026-10-04T00:00:00Z','rules-only'),['6685','onbekend']);
});
test('a later partial message never discards full saved confirmation',()=>{
 const b=booking(),full={id:'full',provider:'Hotel ABC Chur',reference:'123456789',trip:'6685',todoKey:'hotel',start:'2027-01-13',end:'2027-01-15',automaticEmail:true,status:'confirmed',name:'Maria Visser',capacity:2,occupants:2,productMatch:true,observedAt:'2026-10-01T00:00:00Z'};
 const state={...emptyState(),bookings:[b],evidence:[full]};rebuildStoredEvidence(state,[message('abc@hotelabc.ch','Hello Maria Visser! thank you for your reservation! Your arrival day: 13.01.2027 reservation number 123456789')]);assert.equal(state.evidence[0].end,'2027-01-15');assert.equal(state.interpretationVersion,INTERPRETATION_VERSION);
});
