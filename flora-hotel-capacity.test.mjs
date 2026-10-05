import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from './flora-engine.mjs';
import {hotelIdentity,cityFrom} from './flora-identity.mjs';
import {parseDocument,matchEvidence} from './flora-mail-parser.mjs';
const todo={_key:'hotel',tag:'hotel',title:'El Tajo & SPA Ronda | Twin',startDate:'2027-04-09',endDate:'2027-04-11',start:'2027-04-09',end:'2027-04-11'};
const booking={_id:'test',index:6000,status:'verwerkt',passengers:[{firstName:'Test',lastName:'Reiziger'},{firstName:'Other',lastName:'Reiziger'}],todos:[todo],lines:[{title:'09 apr. - 11 apr.: Hotel Maestranza Ronda - 1x Tweepersoonskamer',visible:true}]};
const proof={id:'e',trip:'6000',todoKey:'hotel',provider:'Expedia',reference:'123456789',product:'Hotel Maestranza Calle Virgen de la Paz,',start:todo.start,end:todo.end,name:'Test Reiziger',status:'confirmed',capacity:null,occupants:2,productMatch:true};
test('visible customer line supports alternative with missing proof city and matching dates',()=>{
 assert.equal(hotelIdentity(todo,proof,booking),true);
 assert.equal(matchEvidence(proof,booking).productMatch,true);
 assert.equal(hotelIdentity(todo,proof,{...booking,lines:[]}),false);
 assert.equal(hotelIdentity(todo,proof,{...booking,lines:booking.lines.map(l=>({...l,visible:false}))}),false);
 assert.equal(hotelIdentity(todo,{...proof,end:'2027-04-12'},booking),false);
 assert.equal(hotelIdentity(todo,{...proof,product:'Hotel Maestranza Madrid'},booking),false);
});
test('unknown capacity alone disappears on reassessment while actual shortage stays an alarm',()=>{
 const state={bookings:[booking],evidence:[proof],findings:[{id:'6000:hotel:capacity-unknown',trip:'6000',code:'capacity-unknown'}]};
 assert.equal(evaluate(state,'2026-10-05').findings.some(f=>f.code.startsWith('capacity')),false);
 const known=evaluate({...state,evidence:[{...proof,capacity:1}]},'2026-10-05').findings;
 assert.equal(known.find(f=>f.code==='capacity').status,'alarm');
});
test('Expedia keeps Glasgow in the hotel name and never accepts Edinburgh from the customer line',()=>{
 const doc={label:'E-mail',text:'Je boeking is bevestigd. Hoteloverzicht Leonardo Royal Hotel Glasgow 80 Jamaica Street, Glasgow, Scotland Hotel bekijken Boekingsdatums 10 dec 2026 - 12 dec 2026 Reisplannummer 73542386374041 Geboekt voor Test Reiziger 2 volwassenen Kamer Executive Twin kamer Kamervoorkeuren'};
 const parsed=parseDocument(doc,{id:'mail',url:'https://mail.google.com/mail/u/0/#all/mail',from:'noreply@expediataap.nl',subject:'Bevestiging',at:'2026-09-11',docs:[doc]});
 assert.equal(parsed.product,'Leonardo Royal Hotel Glasgow');
 assert.equal(cityFrom(parsed.product),'Glasgow');
 const b={...booking,lines:[{title:'Leonardo Royal Hotel Edinburgh',visible:true}],todos:[{...todo,title:'Leonardo Edinburgh | Double/Twin',supplierBookingNumber:parsed.reference,startDate:parsed.start,endDate:parsed.end}]};
 assert.equal(matchEvidence(parsed,b).productMatch,false);
});

test('a confirmed different hotel city is one high-priority alarm, including address-only evidence',()=>{
 for(const [expected,actual] of [['Edinburgh','Glasgow'],['Glasgow','Edinburgh']]){
  const b={...booking,todos:[{...todo,title:'Leonardo '+expected}]};
  for(const e of [{...proof,product:'Leonardo Royal Hotel '+actual,productMatch:false},{...proof,product:'Leonardo Royal Hotel',sourceText:'Hoteloverzicht Leonardo Royal Hotel '+actual+' Hotel bekijken',productMatch:true}]){
   const findings=evaluate({bookings:[b],evidence:[e]},'2026-10-05').findings;
   const city=findings.find(f=>f.code==='city-e');
   assert.equal(city.status,'alarm');assert.equal(city.priority,'hoog');assert.match(city.detail,new RegExp(expected));assert.match(city.detail,new RegExp(actual));
   assert.equal(findings.some(f=>f.code==='product-e'),false);
  }
 }
 const b={...booking,todos:[{...todo,title:'Leonardo Edinburgh'}]};
 for(const product of ['Leonardo Royal Hotel','Leonardo Hotel Edinburgh'])assert.equal(evaluate({bookings:[b],evidence:[{...proof,product}]},'2026-10-05').findings.some(f=>f.code.startsWith('city-')),false);
});
