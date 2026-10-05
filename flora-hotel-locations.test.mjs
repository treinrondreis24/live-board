import test from 'node:test';
import assert from 'node:assert/strict';
import {HOTEL_LOCATIONS,knownHotelCity} from './flora-hotel-locations.mjs';
import {adjacentNightStay} from './flora-identity.mjs';
test('hotel registry covers every requested city and recognizes its observed aliases',()=>{
 assert.equal(new Set(HOTEL_LOCATIONS.map(r=>r.city)).size,15);
 for(const row of HOTEL_LOCATIONS)for(const alias of row.aliases)assert.equal(knownHotelCity(alias+' | Double'),row.city);
 for(const name of ['Clarion (mail)','Premier Inn','Leonardo','Hotel Central','Sonne (mail)','Unknown Hotel'])assert.equal(knownHotelCity(name),'');
 assert.equal(knownHotelCity('Josefshof am Rathaus of Hotel Schöntal'),'');
});
test('registered hotel location supports only the approved adjacent dates and route',()=>{
 const b={todos:[{tag:'hotel',title:'Josefshof am Rathaus | Double',startDate:'2026-10-20',endDate:'2026-10-22'}]};
 const e={product:'WIEN HBF → AMSTERDAM CENTRAAL',direction:'inbound',start:'2026-10-22',end:'2026-10-23'};
 assert.equal(adjacentNightStay(e,b),true);
 assert.equal(adjacentNightStay({...e,start:'2026-10-21'},b),false);
 assert.equal(adjacentNightStay({...e,product:'ZURICH HB → AMSTERDAM CENTRAAL'},b),false);
 assert.equal(adjacentNightStay(e,{todos:[{...b.todos[0],title:'Josefshof am Rathaus Hamburg'}]}),false);
 for(const [title,product] of [['Hotel Schöntal','ZURICH HB → AMSTERDAM CENTRAAL'],['Panorama H (e-travel)','WIEN HBF → AMSTERDAM CENTRAAL']])assert.equal(adjacentNightStay({...e,product},{todos:[{...b.todos[0],title}]}),true);
});
