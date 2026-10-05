import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from './flora-engine.mjs';
import {matchEvidence,amendedHotelEvidence,parseDocument} from './flora-mail-parser.mjs';
const b={_id:'b',index:6000,status:'verwerkt',dateDeparture:'2026-10-19',dateReturn:'2026-10-25',passengers:[{firstName:'Test',lastName:'Reiziger'},{firstName:'Other',lastName:'Reiziger'}],todos:[{_key:'t',tag:'hotel',title:'40421 (EUN)(RIT) | 2x RITAM (minicabine)',startDate:'2026-10-19',endDate:'2026-10-20'}]};
const e={id:'e',trip:'6000',todoKey:'t',provider:'NS International',reference:'ABCDEF/0',start:'2026-10-19',end:'2026-10-20',name:'Test Reiziger',capacity:1,occupants:null,room:'Mini Cabin',status:'confirmed',observedAt:'2026-09-01'};
const findings=(booking,rows)=>evaluate({bookings:[booking],evidence:rows},'2026-10-05').findings;
test('direction cannot attach unrelated train evidence to another traveler',()=>{
 const unrelated={...e,provider:'ÖBB',reference:'1234567890123456',name:'Arnold Example',direction:'outbound',start:'2026-12-17',end:''};
 assert.equal(matchEvidence(unrelated,b),null);
 assert.equal(matchEvidence({...unrelated,name:'Test Reiziger'},b).todoKey,'t');
});
test('two requested single minicabins are not duplicate bookings, unknown occupants remain visible',()=>{
 const rows=[e,{...e,id:'e2',reference:'ABCDEF/1'}];
 assert.ok(!findings(b,rows).some(f=>f.code==='duplicate'));
 assert.ok(findings(b,rows).some(f=>f.code==='occupancy-unknown'));
 assert.ok(findings(b,[...rows,{...e,id:'e3',reference:'ABCDEF/2'}]).some(f=>f.code==='duplicate'));
 assert.ok(findings(b,[e,{...e,id:'e2',reference:'OTHER/1'}]).some(f=>f.code==='duplicate'));
});
test('single-room Teldar voucher and /1 reminder with the same guests are one reservation',()=>{
 const booking={...b,todos:[{...b.todos[0],title:'Hotel Test | Double'}]},base={...e,provider:'Teldar',reference:'ABCDEF',roomCount:1,name:'Test Reiziger Other Reiziger',guestNames:['Test Reiziger','Other Reiziger'],capacity:2,occupants:2},reminder={...base,id:'r',reference:'ABCDEF/1',name:'Test Reiziger',roomCount:null};
 assert.ok(!findings(booking,[base,reminder]).some(f=>f.code==='duplicate'));
 assert.ok(findings(booking,[{...base,roomCount:2},reminder]).some(f=>f.code==='duplicate'));
 assert.ok(findings(booking,[base,{...reminder,guestNames:['Someone Else'],name:'Someone Else'}]).some(f=>f.code==='duplicate'));
});
test('explicit same-thread hotel amendment supersedes only an unambiguous matching reservation',()=>{
 const old={...e,provider:'Premier Inn',reference:'OLD',messageId:'old',product:'Premier Inn Wien',capacity:2,occupants:2},fresh={...old,id:'new',reference:'NEW',messageId:'new',end:'2026-10-21',observedAt:'2026-09-02'};
 const messages=[{id:'old',threadId:'thread'},{id:'new',threadId:'thread',from:'hotel@whitbread.com',at:fresh.observedAt,docs:[{label:'E-mail',text:'We have updated the reservation as requested and attached the new reservation confirmation. Best regards'}]}];
 assert.equal(amendedHotelEvidence([old,fresh],messages)[0].status,'superseded');
 for(const change of [{threadId:'other'},{docs:[{label:'E-mail',text:'Please update the reservation'}]},{issues:['unreadable']}])assert.equal(amendedHotelEvidence([old,fresh],[messages[0],{...messages[1],...change}])[0].status,'confirmed');
 assert.equal(amendedHotelEvidence([old,{...old,reference:'OTHER'},fresh],messages)[0].status,'confirmed');
});
test('cached HTML in OBB route does not leak markup into identity',()=>{
 const m={id:'o',from:'ticket@oebb.at',subject:'nightjet.com Buchung',at:'2026-09-01',url:'https://example.com'},d={label:'E-mail',text:'Buchungscode: 1234 5678 9012 3456 Ihre Buchungen </td><tr><td>Amsterdam Centraal &rsaquo; Wien Hbf</td><div>gilt am 17.12.2026 um 19:00 <br /> Test Reiziger, Other Reiziger<br /> Wagennummer 432'};
 const result=parseDocument(d,m);assert.equal(result.name,'Test Reiziger');assert.equal(result.product,'Amsterdam Centraal → Wien Hbf');
});
