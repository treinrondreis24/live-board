import test from 'node:test';
import assert from 'node:assert/strict';
import {hotelIdentity,cityFrom,trainRoom,trainStations} from './flora-identity.mjs';
import {roomCapacity,matchEvidence} from './flora-mail-parser.mjs';
const cases=[['Hotel Don Jaime Zaragoza','Hotel Don','Zaragoza'],['Hotel Continentale Arezzo','Hotel Continentale Piazza Guido Monaco','Arezzo'],['IC Hotel Budapest (email/Expedia/Teldar) | Twin','IntercityHotel Budapest Baross','Budapest'],['Leonardo Wien Hbf | Comfort Double','Leonardo Hotel Vienna Hauptbahnhof Gerhard-Bronner-Straße','Wenen'],['Art & Business Hotel Neurenberg','Art Business Hotel Nürnberg Gleiayba','Neurenberg']];
for(const [title,product,city] of cases)test('accept abbreviated hotel '+title,()=>assert.equal(hotelIdentity({title},{product,provider:'Expedia',sourceText:'Hoteloverzicht '+product+' '+city+' Hotel bekijken'},{}),true));
test('alternative needs supporting note or visible invoice in the same city',()=>{const t={title:'Agumar Hotel Madrid'},e={product:'Hotel PAX Atocha Calle',provider:'Expedia',sourceText:'Hoteloverzicht Hotel PAX Atocha Madrid Hotel bekijken'};assert.equal(hotelIdentity(t,e,{}),false);assert.equal(hotelIdentity(t,e,{lines:[{title:'Madrid: Hotel PAX Atocha',visible:true}]}),true);assert.equal(hotelIdentity(t,e,{lines:[{title:'Madrid: Hotel PAX Atocha',visible:false}]}),false);assert.equal(hotelIdentity({...t,title:'Agumar Hotel Barcelona'}, {...e,product:'PAX Atocha Madrid'},{}),false);});
test('Cadiz explicit exception is limited to the approved dates',()=>{const t={title:'Hotel de Francia y París Cádiz',start:'2026-10-03',end:'2026-10-04'},e={product:'Hotel Cádiz Bahía by Q Hotels'};assert.equal(cityFrom(t.title),'Cádiz');assert.equal(hotelIdentity(t,e,{}),true);assert.equal(hotelIdentity({...t,start:'2027-10-03'},e,{}),false);});
test('same chain in different known city stays unmatched',()=>assert.equal(hotelIdentity({title:'Leonardo Wien Hbf'},{product:'Leonardo Hotel Budapest'},{notes:'Leonardo Hotel Budapest'}),false));
test('train codes distinguish private compartment from minicabins',()=>{for(const code of ['PA1AD','PA1AM','RITAD'])assert.equal(roomCapacity(code),2);assert.equal(trainRoom('PA1AD'),'private');assert.equal(trainRoom('RITAD'),'private');assert.equal(trainRoom('PA1AM'),'mini');assert.equal(trainStations('CHAJD / ATALA / ATWIH'),'Zürich / Innsbruck / Wien');});

test('alternative invoice matches the correct todo without matching reference',()=>{const b={index:42,passengers:[{firstName:'Test',lastName:'Reiziger'}],dateDeparture:'2027-01-01',dateReturn:'2027-01-02',lines:[{title:'Madrid: Hotel PAX Atocha',visible:true}],todos:[{_key:'h',tag:'hotel',title:'Agumar Hotel Madrid',startDate:'2027-01-01',endDate:'2027-01-02'}]},e={provider:'Expedia',reference:'123456789',name:'Test Reiziger',product:'Hotel PAX Atocha Calle',sourceText:'Hoteloverzicht Hotel PAX Atocha Madrid Hotel bekijken',start:'2027-01-01',end:'2027-01-02',room:'Double',status:'confirmed'};const result=matchEvidence(e,b);assert.equal(result.todoKey,'h');assert.equal(result.productMatch,true);assert.equal(matchEvidence(e,{...b,lines:[]}),null);});

test('hotel word order and appended address do not hide matching name',()=>{
 const proof={product:'sander Hotel Casinostraße',provider:'Expedia',sourceText:'Hoteloverzicht sander Hotel Casinostraße Koblenz Hotel bekijken'};
 assert.equal(hotelIdentity({title:'Hotel Sander Koblenz | Tweepersoonskamer'},proof,{}),true);
 assert.equal(hotelIdentity({title:'Hotel Anders Koblenz'},proof,{}),false);
 assert.equal(hotelIdentity({title:'Hotel Sander Hamburg'},proof,{}),false);
});
test('explicit alternative accepts either named hotel, not unrelated or generic options',()=>{
 for(const name of ['Terminus','Opera'])assert.equal(hotelIdentity({title:'Terminus of Opera | Double'},{product:'Thon Hotel '+name},{}),true);
 assert.equal(hotelIdentity({title:'Terminus of Opera | Double'},{product:'Thon Hotel Spectrum'},{}),false);
 assert.equal(hotelIdentity({title:'Hotel of Kamer'},{product:'Hotel Kamer'},{}),false);
 assert.equal(hotelIdentity({title:'Terminus of Opera Oslo'},{product:'Thon Hotel Terminus Stockholm'},{}),false);
});

test('approved Warsaw Metropol address matches without accepting other cities or hotels',()=>{
 const todo={title:'Metropol Hotel, Warsaw (Teldar/Exp) | Double'};
 for(const street of ['Marszalkowska','Marszałkowska']){
  const proof={product:'Metropol Hotel '+street};
  assert.equal(cityFrom(proof.product),'Warschau');
  assert.equal(hotelIdentity(todo,proof,{}),true);
  assert.equal(hotelIdentity({title:'Metropol Hotel Oslo'},proof,{}),false);
 }
 assert.equal(hotelIdentity(todo,{product:'Other Hotel Warsaw'},{}),false);
 assert.equal(hotelIdentity(todo,{product:'Metropol Hotel Glasgow'},{}),false);
 assert.equal(cityFrom('Marszalkowska'),'');
});

test('partial hotel names are accepted without requiring a known city',()=>{
 for(const [title,product] of [
  ['Hotel Bernina (STC) | Standaard kamer','Hotel Bernina Via Roma'],
  ['Go Hotel Shnelli Tallinn | Tweepersoonskamer','Go Hotel Shnelli Toompuiestee'],
  ['Hotel Opera Bialystok','Hotel Opera Kijowska'],
  ['Hotel Piast Wrocław','Hotel Piast ul. Pilsudskiego'],
  ['Leonardo Edinburgh | Double/Twin','Leonardo Royal Hotel']
 ])assert.equal(hotelIdentity({title},{product},{}),true,title);
 assert.equal(cityFrom('Hotel Bernina Via Roma'),'');
 assert.equal(cityFrom('Wrocław'),'Wroclaw');
 assert.equal(hotelIdentity({title:'Grand Hotel Tallinn'},{product:'Grand Hotel Royal'},{}),false);
});
test('partial names never override Edinburgh Glasgow conflicts in names or hotel addresses',()=>{
 for(const [wanted,other] of [['Edinburgh','Glasgow'],['Glasgow','Edinburgh']]){
  const b={index:42,passengers:[{firstName:'Test',lastName:'Reiziger'}],todos:[{_key:'h',tag:'hotel',title:'Leonardo Royal Hotel '+wanted,startDate:'2026-12-10',endDate:'2026-12-12',supplierBookingNumber:'123456789'}]};
  const e={provider:'Expedia',reference:'123456789',name:'Test Reiziger',product:'Leonardo Royal Hotel',sourceText:'Hoteloverzicht Leonardo Royal Hotel '+other+' Hotel bekijken',start:'2026-12-10',end:'2026-12-12',status:'confirmed'};
  assert.equal(matchEvidence(e,b).productMatch,false);
  assert.equal(matchEvidence({...e,product:'Leonardo Royal Hotel '+other,sourceText:''},b).productMatch,false);
 }
});

test('combined ATALA CHAJD TODO accepts its booked Nightjet route and preserves date and berth checks',async()=>{
 const {nightTrainCodeMatch}=await import('./flora-identity.mjs');
 const {evaluate}=await import('./flora-engine.mjs');
 const title='420/421 ATALA /403/402 CHAJD | 2x PA1AM (minicabine)';
 const b={_id:'test5682',index:5682,status:'verwerkt',passengers:[{firstName:'Duncan',lastName:'van Sliedregt'}],todos:[{_key:'n',tag:'hotel',title,startDate:'2026-10-15',endDate:'2026-10-16'}]};
 const e={id:'n',trip:'5682',todoKey:'n',provider:'NS International',reference:'TEST',name:'Duncan van Sliedregt',product:'INNSBRUCK HBF → AMSTERDAM CENTRAAL',direction:'inbound',status:'confirmed',start:'2026-10-15',end:'2026-10-16',capacity:2,occupants:1,room:'Minicabine',productMatch:false};
 assert.equal(nightTrainCodeMatch({title},e),true);
 assert.equal(nightTrainCodeMatch({title},{product:'ZÜRICH HB → AMSTERDAM CENTRAAL'}),true);
 assert.equal(nightTrainCodeMatch({title},{product:'WIEN HBF → AMSTERDAM CENTRAAL'}),false);
 assert.equal(matchEvidence(e,b).productMatch,true);
 assert.equal(evaluate({bookings:[b],evidence:[e]},'2026-10-05').findings.some(f=>f.code.startsWith('product-')),false);
 const findings=evaluate({bookings:[b],evidence:[{...e,end:'2026-10-17',roomMismatch:true}]},'2026-10-05').findings;
 assert.ok(findings.some(f=>f.code.startsWith('dates-')&&f.status==='alarm'));
 assert.ok(findings.some(f=>f.code.startsWith('room-')));
});

test('night train can connect to the exact adjacent hotel city, including Salzburg',async()=>{
 const {adjacentNightStay}=await import('./flora-identity.mjs');
 const {evaluate}=await import('./flora-engine.mjs');
 const b={_id:'test6603',index:6603,status:'verwerkt',passengers:[{firstName:'Test',lastName:'Reiziger'}],todos:[{_key:'h',tag:'hotel',title:'Cocoon Salzburg | Double',startDate:'2026-10-12',endDate:'2026-10-15'},{_key:'n',tag:'hotel',title:'NJ (EUN)(RIT)(40490) | RITAD',startDate:'2026-10-15',endDate:'2026-10-16'}]};
 const e={id:'n',trip:'6603',todoKey:'n',provider:'NS International',name:'Test Reiziger',product:'SALZBURG HBF → AMSTERDAM CENTRAAL',direction:'inbound',start:'2026-10-15',end:'2026-10-16',status:'confirmed',productMatch:false};
 assert.equal(adjacentNightStay(e,b),true);
 assert.equal(adjacentNightStay({...e,start:'2026-10-14'},b),false);
 assert.equal(adjacentNightStay(e,{...b,todos:[{...b.todos[0],title:'Hotel Hamburg'}]}),false);
 assert.equal(evaluate({bookings:[b],evidence:[e]},'2026-10-05').findings.some(f=>f.code==='product-n'),false);
 assert.equal(adjacentNightStay({...e,product:'AMSTERDAM CENTRAAL → SALZBURG HBF',direction:'outbound',end:'2026-10-12'},b),true);
});
