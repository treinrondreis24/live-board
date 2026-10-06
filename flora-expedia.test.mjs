import test from 'node:test';

import assert from 'node:assert/strict';

import {DatabaseSync} from 'node:sqlite';

import {compareExpedia,latestExpedia,breakfastValue,expediaControls} from './flora-expedia.mjs';

import {initExpedia,storeEvent,listLatestEvents} from './expedia-store.mjs';

import {eventRecord,EVENT} from './expedia-core.mjs';

import {evaluate} from './flora-engine.mjs';

import {createExpediaCycle} from './flora-expedia-cycle.mjs';

const ref='73559294378081',email={id:'mail-1',provider:'Expedia',reference:ref,trip:'6635',todoKey:'hotel',status:'confirmed',start:'2026-10-13',end:'2026-10-16',occupants:2,roomCount:1,room:'Double room, ontbijt inbegrepen',product:'NH Bern The Bristol',name:'Melis Koudijs',source:'test',observedAt:'2026-10-06T00:00:00Z'};

const item={status:'Confirmed',checkin_date:email.start,checkout_date:email.end,adult_count:2,child_count:0,property:{name:email.product}};

const event=(data={},updatedAt='2026-10-06T00:00:00Z')=>({itineraryId:ref,updatedAt,receivedAt:updatedAt,payload:{data:{itinerary_id:ref,status:'Confirmed',property_booking_items:[item],...data}}});

test('missing room and breakfast do not cause alerts or overwrite email',()=>{const before=JSON.stringify(email),c=compareExpedia(event(),[email]);assert.equal(c.status,'matched');assert.deepEqual(c.differences,[]);assert.ok(c.checked.includes('arrival'));assert.deepEqual(c.missing,['room','breakfast']);assert.equal(JSON.stringify(email),before);});

test('explicit date, occupancy, room and breakfast contradictions are reported',()=>{const c=compareExpedia(event({property_booking_items:[{...item,checkout_date:'2026-10-17',adult_count:1,room_name:'Single room',rate:{rate_plan_name:'Room only'}}]}),[email]);assert.deepEqual(c.differences.map(d=>d.code),['departure','occupants','room','breakfast']);assert.equal(c.status,'attention');});

test('purchaser and nonstandard agency references never invent a travel match',()=>{const c=compareExpedia(event({agency_reference_code:'1982A HJ',purchaser:{first_name:'Someone',last_name:'Else'}}),[email]);assert.deepEqual(c.differences,[]);assert.equal(compareExpedia(event({agency_reference_code:'1982A'}),[email]).differences[0].code,'agency-reference');assert.equal(compareExpedia(event(),[{...email,reference:ref+'9'}]).status,'awaiting-email');});

test('full and partial cancellation block vouchers even without a linked email',()=>{for(const e of [event({status:'Cancelled'}),event({property_booking_items:[item,{...item,status:'Cancelled'}]})])for(const rows of [[],[email]]){const c=compareExpedia(e,rows);assert.equal(c.status,'cancelled');assert.equal(c.voucherBlocked,true);assert.deepEqual(c.differences.map(d=>d.code),['cancelled']);}});

test('multiple rooms compare total occupancy and do not infer missing breakfast',()=>{const e=event({property_booking_items:[{...item,adult_count:1,room_name:'Standard Double Room'},{...item,adult_count:1,room_name:'Standard Twin Room'}]});const c=compareExpedia(e,[{...email,roomCount:2,room:'Double; Twin'}]);assert.deepEqual(c.differences,[]);assert.equal(c.voucherBlocked,false);});

test('breakfast is explicit; absence, available buffet and contradictory text remain unknown',()=>{for(const s of ['', 'Ontbijt beschikbaar tegen betaling','breakfast buffet','inclusief ontbijt; zonder ontbijt'])assert.equal(breakfastValue(s),null);assert.equal(breakfastValue('Free breakfast'),true);assert.equal(breakfastValue('Room only'),false);});

test('older delivery cannot replace a later cancellation',()=>{const newer=event({status:'Cancelled'},'2026-10-06T01:00:00Z'),older={...event(),receivedAt:'2026-10-06T02:00:00Z'};assert.equal(latestExpedia([newer,older])[0],newer);assert.equal(expediaControls({evidence:[email],expediaEvents:[newer,older]})[0].voucherBlocked,true);});

test('all latest reservations survive the 100-event history limit',async()=>{const sqlite=new DatabaseSync(':memory:');await initExpedia({sqlite});for(let i=0;i<105;i++)await storeEvent(eventRecord(Buffer.from(JSON.stringify({specversion:'1.0',type:EVENT,id:'e'+i,time:'2026-10-06T01:00:00Z',data:{itinerary_id:String(i),status:'Cancelled'}}))));await storeEvent(eventRecord(Buffer.from(JSON.stringify({specversion:'1.0',type:EVENT,id:'old',time:'2026-10-05T01:00:00Z',data:{itinerary_id:'0',status:'Confirmed'}}))));const all=await listLatestEvents();assert.equal(all.length,105);assert.equal(all.find(e=>e.itineraryId==='0').payload.data.status,'Cancelled');sqlite.close();});

test('cycle reevaluates new snapshots, skips repeats and retries conflicting saves',async()=>{let state={bookings:[],evidence:[],findings:[],expediaEvents:[event()]},writes=0,fail=true;const run=createExpediaCycle({read:async()=>({state:structuredClone(state),revision:1}),write:async next=>{writes++;if(fail)throw Object.assign(Error('conflict'),{status:409});state=next;}});await run();assert.equal(state.expediaCheckSignature,undefined);fail=false;await run();await run();assert.equal(writes,2);assert.ok(state.expediaCheckedAt);});

test('FloRA cancellation alarms cannot be waived as staff bookings or marked checked',()=>{const state={bookings:[{_id:'b',index:6635,firstName:'Melis',lastName:'Koudijs',status:'te verwerken',dateDeparture:email.start,dateReturn:email.end,passengers:[{firstName:'Melis',lastName:'Koudijs'}],todos:[{_key:'hotel',tag:'hotel',title:email.product,startDate:email.start,endDate:email.end}]}],evidence:[email],findings:[],expediaEvents:[event({status:'Cancelled'})]};const first=evaluate(state,'2026-10-06T12:00:00Z');assert.ok(first.findings.some(f=>f.code.startsWith('expedia-')&&f.status==='alarm'));const alarm=first.findings.find(f=>f.code.startsWith('expedia-'));alarm.override={status:'checked'};state.findings=first.findings;assert.equal(evaluate(state,'2026-10-06T12:01:00Z').findings.find(f=>f.code.startsWith('expedia-')).status,'alarm');assert.equal(first.summary[0].checked,false);});



