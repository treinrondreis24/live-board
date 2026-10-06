import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,stays} from './flora-engine.mjs';
import {matchEvidence,referenceMatches} from './flora-mail-parser.mjs';
const now='2026-10-06T12:00:00Z';
const booking=()=>({_id:'b',index:42,status:'afgehandeld',dateDeparture:'2026-10-20',dateReturn:'2026-10-25',passengers:[{firstName:'Eva',lastName:'Test'}],todos:[{_key:'h',tag:'hotel',title:'Hotel Bernina | Double',startDate:'2026-10-20',endDate:'2026-10-21'}]});
const proof=()=>({id:'e',trip:'42',todoKey:'h',provider:'STC',reference:'TRR12345',status:'confirmed',start:'2026-10-20',end:'2026-10-21',name:'Eva Test',product:'Hotel Bernina Via Roma',productMatch:true});
test('independent voucher removes empty mail-search warning; unread cancellation source stays visible with proof',()=>{
 for(const state of ['not-found','candidates','incomplete']){
  const s={bookings:[booking()],evidence:[proof()],emailChecks:{42:{stays:[{todoKey:'h',state,explanation:'Zoekresultaat'}]}}};
  const f=evaluate(s,now).findings;
  assert.equal(f.length,state==='incomplete'?1:0);
  if(f.length){assert.equal(f[0].code,'email-incomplete');assert.equal(f[0].evidence[0].reference,'TRR12345');}
  s.evidence=[];assert.ok(evaluate(s,now).findings.some(f=>f.code==='missing'));
 }
});
test('partial wrong dates produce one actionable alarm covering the missing date too',()=>{
 for(const fields of [{start:'2026-10-22',end:''},{start:'',end:'2026-10-24'}]){
  const f=evaluate({bookings:[booking()],evidence:[{...proof(),...fields}]},now).findings;
  assert.equal(f.length,1);assert.equal(f[0].status,'alarm');assert.match(f[0].detail,/ontbreekt/);
 }
});
test('known hotel with copied non-hotel tag still requires dates and a reservation reference',()=>{
 const b=booking(),t=b.todos[0];t.tag='station';t.title='MOOONS Vienna';t.supplierBookingNumber='ABC12345';assert.equal(stays(b).length,1);
 assert.equal(matchEvidence({...proof(),reference:'ABC12345',product:'MOOONS Vienna'},b)?.todoKey,'h');
 t.supplierBookingNumber='';assert.equal(stays(b).length,0);
 t.supplierBookingNumber='ABC12345';t.title='Vertrekstation Wien';assert.equal(stays(b).length,0);
});
test('larger hotel room is not a mismatch; smaller room and known capacity shortage remain flagged',()=>{
 const b=booking(),e={...proof(),room:'Triple',capacity:3};assert.equal(matchEvidence(e,b).roomMismatch,false);
 e.room='Single';e.capacity=1;assert.equal(matchEvidence(e,b).roomMismatch,true);
 b.passengers.push({firstName:'Jan',lastName:'Test'});assert.ok(evaluate({bookings:[b],evidence:[e]},now).findings.some(f=>f.code==='capacity'&&f.status==='alarm'));
});
test('base NS reference links suffixed tickets while different room suffixes remain distinct',()=>{
 assert.ok(referenceMatches('VLBSTJL/0','VLBSTJL'));assert.ok(referenceMatches('VLBSTJL','VLBSTJL/0'));assert.equal(referenceMatches('VLBSTJL/1','VLBSTJL/0'),false);
});
