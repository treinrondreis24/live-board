import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingNumbersForTrain,createBoardBookings} from './board-bookings.mjs';
const train={number:'225',plannedTimestamp:Date.parse('2026-10-05T09:20:00Z'),observedAt:'Köln Hbf',source:'DB'};
const row={trip:'80421',number:'225',date:'2026-10-05',from:'Arnhem',to:'Frankfurt',status:'Te beoordelen',reference:'PRIVATE-PNR',source:'https://mail.google.com/private'};
test('matches booked train and date regardless of boarding, alighting or data source',()=>{
 for(const source of ['DB','NDOV','OJP','NMBS'])assert.deepEqual(bookingNumbersForTrain({...train,source},[row]),['80421A']);
 assert.deepEqual(bookingNumbersForTrain(train,[row,{...row,status:'Bevestigd',trip:'80421A'},{...row,trip:'80422'},{...row,number:'224',trip:'80423'},{...row,date:'2026-10-06',trip:'80424'}]),['80421A','80422A']);
});
test('rejects cancelled, removed, unlinked and malformed rows; includes unreviewed rows',()=>{
 for(const change of [{trip:''},{trip:'PRIVATE-PNR'},{date:'2026-02-30'},{number:''},{cancelled:true},{deleted:true},{status:'Geannuleerd'}])assert.deepEqual(bookingNumbersForTrain(train,[{...row,...change}]),[]);
 assert.deepEqual(bookingNumbersForTrain(train,[row],{confirmedOnly:true}),[]);
});
test('uses Dutch calendar date, avoids adjacent day guesses, supports explicit overnight service date',()=>{
 const night={...train,plannedTimestamp:Date.parse('2026-10-04T22:30:00Z'),serviceDate:'2026-10-04'};
 assert.deepEqual(bookingNumbersForTrain(night,[row]),['80421A']);
 assert.deepEqual(bookingNumbersForTrain(night,[{...row,date:'2026-10-04'}]),[]);
 assert.deepEqual(bookingNumbersForTrain(night,[{...row,date:'2026-10-04',serviceDate:'2026-10-04'}]),['80421A']);
});
test('merged services retain all matching booking numbers without repeats',()=>{
 assert.deepEqual(bookingNumbersForTrain({mergedServices:[train,{...train,number:'226'}]},[row,{...row,number:'226',trip:'80422'}]),['80421A','80422A']);
});
test('only internal booking numbers exposed, cache expires and source failures do not break board',async()=>{
 let time=0,reads=0,rows=[row];const attach=createBoardBookings({now:()=>time,read:async()=>{reads++;return {value:{rows}};}});
 const first=await attach([train]);assert.deepEqual(first.trains[0].bookingNumbers,['80421A']);assert.doesNotMatch(JSON.stringify(first),/PRIVATE-PNR|mail.google/);
 rows=[];await attach([train]);assert.equal(reads,1);time=30001;assert.deepEqual((await attach([train])).trains[0].bookingNumbers,[]);
 const failed=await createBoardBookings({read:async()=>{throw Error('offline');}})([train]);assert.equal(failed.bookingsStatus,'unavailable');assert.equal(failed.trains[0].number,'225');
});
