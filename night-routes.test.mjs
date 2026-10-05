import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNightRoute,nightBookingMatches,nightWarnings,departureDay} from './night-routes.mjs';
import {bookingNumbersForTrain} from './board-bookings.mjs';
const rule=validateNightRoute({stations:[{name:'Wien Hbf',day:0,aliases:['Vienna']},{name:'Hannover Hbf',day:1},{name:'Hamburg Hbf',day:1}]});
const settings={trains:[{number:'40490',source:'DB',nightRoute:rule}]};
const row=(station,stamp)=>({number:'40490',source:'DB',observedAt:station,plannedTimestamp:Date.parse(stamp)});
const bookings=[{number:'40490',trip:'123',status:'Te beoordelen',from:'Vienna',date:'2026-10-04'},{number:'40490',trip:'124',status:'Bevestigd',from:'Hannover Hbf',date:'2026-10-05'}];
test('morning run matches previous evening and after-midnight boardings, never next evening',()=>{
 assert.deepEqual(bookingNumbersForTrain(row('Hamburg Hbf','2026-10-05T08:00:00+02:00'),bookings,{settings}),['123A','124A']);
 assert.deepEqual(bookingNumbersForTrain(row('Wien Hbf','2026-10-05T20:00:00+02:00'),bookings,{settings}),[]);
 assert.deepEqual(bookingNumbersForTrain(row('Wien Hbf','2026-10-04T20:00:00+02:00'),bookings,{settings}),['123A','124A']);
});
test('optional observations are independent; unknown stations are not guessed and reported',()=>{
 const train=row('Hamburg Hbf','2026-10-05T08:00:00+02:00');assert.equal(nightBookingMatches(rule,train,bookings[0]),true);
 assert.equal(nightBookingMatches(rule,{...train,observedAt:'Unknown'},bookings[0]),false);
 assert.equal(nightBookingMatches(rule,train,{...bookings[0],from:'Unknown'}),false);
 assert.equal(nightWarnings(settings,[{...bookings[0],from:'Unknown'}],[{...train,observedAt:'Unknown'}]).length,2);
});
test('calendar arithmetic survives month, year and DST changes; effective dates apply to run origin',()=>{
 assert.equal(departureDay('2027-01-01',1),'2026-12-31');assert.equal(departureDay('2026-03-30',1),'2026-03-29');
 const train=row('Hamburg Hbf','2026-10-05T08:00:00+02:00');
 assert.equal(nightBookingMatches({...rule,fromDate:'2026-10-04',untilDate:'2026-10-04'},train,bookings[0]),true);
 assert.equal(nightBookingMatches({...rule,fromDate:'2026-10-05'},train,bookings[0]),false);
});
test('rejects ambiguous station names, invalid dates and day values',()=>{
 for(const value of [{stations:[]},{stations:[{name:'X',day:2}]},{stations:[{name:'Köln',day:0},{name:'Koln',day:1}]},{...rule,fromDate:'2026-02-30'}])assert.throws(()=>validateNightRoute(value));
});

test('source-specific rule does not alter other sources',()=>{
 const train={...row('Hamburg Hbf','2026-10-05T08:00:00+02:00'),source:'NDOV'};
 assert.deepEqual(bookingNumbersForTrain(train,bookings,{settings}),['124A']);
});
