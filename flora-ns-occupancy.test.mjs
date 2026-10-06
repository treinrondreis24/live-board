import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,matchEvidence,resolveEvidence} from './flora-mail-parser.mjs';
import {evaluate} from './flora-engine.mjs';
import {referenceBackedNSName} from './flora-names.mjs';
const b={_id:'b',index:6471,status:'afgehandeld',dateDeparture:'2026-10-05',dateReturn:'2026-10-14',notes:'ATL: XMXRJNM',passengers:[{firstName:'Ingrid',lastName:'Nachbahr-Meffert'},{firstName:'Miny',lastName:'Helmich-Wenker'}],todos:[{_key:'t',tag:'hotel',title:'40421 (EUN)(RIT) | RITAD',startDate:'2026-10-05',endDate:'2026-10-06'}]};
const e={id:'e',provider:'NS International',reference:'XMXRJNM/0',tripHint:'6471',name:'IN NACHBAHRMEFFERT',start:'2026-10-05',end:'2026-10-06',direction:'outbound',originCountry:'NL',product:'AMSTERDAM CENTRAAL → WIEN HBF',status:'confirmed',capacity:2,occupants:2};
test('NS singular and plural adult labels both supply names and passenger counts',()=>{
 for(const [label,count] of [['01 VOLWASSENE',1],['02 VOLWASSENEN',2]]){
  const doc={label:'ticket.pdf',text:`DNR: LTPCGKN ID:0 VERVOERBEWIJS + RESERVERING CIV 1184 NIGHTJET KOMMEREN, PAUL ${label} DIT TICKET IS EEN AFZONDERLIJKE VERVOEROVEREENKOMST 12.10 18:32 UTRECHT CENTRAAL -> WIEN HBF 13.10 09:48 TREIN 40421 NJ RIJTUIG 433 LIGPLAATS 21 NIET ROKEN MINI CABIN Ref:6394A`};
  const parsed=parseDocument(doc,{subject:'6394A vertrekdatum: 12/10/2026',id:'m',at:'2026-07-07',url:'test',docs:[doc]});
  assert.equal(parsed.occupants,count);assert.equal(parsed.name,'PAUL KOMMEREN');assert.equal(parsed.capacity,1);
 }
});
test('joined surname and abbreviated first name require explicit matching DNR',()=>{
 assert.equal(referenceBackedNSName(e.name,b.passengers,e.reference,b.notes),true);
 assert.equal(referenceBackedNSName('JO NACHBAHRMEFFERT',b.passengers,e.reference,b.notes),false);
 assert.equal(referenceBackedNSName('IN OTHER',b.passengers,e.reference,b.notes),false);
 assert.equal(matchEvidence(e,b).trip,'6471');
 assert.equal(matchEvidence({...e,tripHint:''},b).trip,'6471');
 assert.equal(matchEvidence(e,{...b,notes:''}),null);
 assert.equal(matchEvidence(e,{...b,notes:'XMXRJNMOTHER'}),null);
 const linked=resolveEvidence(e,[b,{...b,_id:'other',index:9999,notes:''}]);assert.equal(linked.trip,'6471');
 assert.equal(evaluate({bookings:[b],evidence:[linked]},'2026-10-05').findings.some(f=>f.code.startsWith('name-')),false);
});
test('unknown capacity and occupancy are not warnings, while proven shortages remain',()=>{
 const linked={...e,trip:'6471',todoKey:'t',productMatch:true,capacity:null,occupants:null};
 const run=rows=>evaluate({bookings:[b],evidence:rows},'2026-10-05').findings;
 assert.equal(run([linked]).some(f=>/^(capacity|occupancy)/.test(f.code)),false);
 assert.equal(run([{...linked,capacity:1}]).find(f=>f.code==='capacity').status,'alarm');
 assert.ok(run([{...linked,occupants:1}]).some(f=>f.code==='occupancy'));
 assert.equal(run([{...linked,occupants:1},{...linked,id:'other',reference:'OTHER',occupants:null}]).some(f=>f.code==='occupancy'),false);
});
