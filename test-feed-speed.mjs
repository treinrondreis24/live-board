import assert from 'node:assert/strict';
import {getCmsFeed} from './app-cms.mjs';
const realFetch=globalThis.fetch,realNow=Date.now;let now=realNow(),calls=0,release;
Date.now=()=>now;
const response=()=>new Response('<rss><channel><item><title>Test</title><link>https://www.treinreiziger.nl/test/</link><description>Nieuws</description></item></channel></rss>');
try{
 globalThis.fetch=()=>{calls++;return new Promise(resolve=>{release=()=>resolve(response());});};
 const url='https://www.treinreiziger.nl/feed/?speed-test=1';
 const a=getCmsFeed(url),b=getCmsFeed(url);assert.equal(calls,1);release();assert.deepEqual(await a,await b);
 await getCmsFeed(url);assert.equal(calls,1);
 now+=300001;const stale=await getCmsFeed(url);assert.equal(stale.stale,true);assert.equal(calls,2);
 await getCmsFeed(url);assert.equal(calls,2);release();await new Promise(r=>setImmediate(r));
 assert.equal((await getCmsFeed(url)).stale,undefined);
 now+=300001;globalThis.fetch=async()=>{calls++;throw Error('offline');};assert.equal((await getCmsFeed(url)).stale,true);await new Promise(r=>setImmediate(r));await getCmsFeed(url);assert.equal(calls,3,'failure backoff avoids request storm');
 now+=86400001;await assert.rejects(getCmsFeed(url));
 console.log('PASS: shared requests, fresh cache, immediate stale response, background refresh, retry backoff and stale expiry');
}finally{globalThis.fetch=realFetch;Date.now=realNow;}
