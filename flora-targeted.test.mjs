import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailControl} from './flora-mail.mjs';
import {emptyState} from './flora-store.mjs';
import {fetchBookings} from './flora-sanity.mjs';
test('targeted extra check syncs and searches only selected trips without discovery or global checkpoint',async()=>{
 const b=index=>({_id:'b'+index,index,status:'te verwerken',dateDeparture:'2027-01-01',dateReturn:'2027-01-02',passengers:[],todos:[]});
 let state={...emptyState(),bookings:[b(4242),b(9999)],emailCheckpoint:{at:'unchanged'},findings:[{id:'other',trip:'9999',status:'attention',history:[]}]};const kv=new Map(),queries=[],synced=[];
 const c=createMailControl({read:async k=>structuredClone(kv.get(k)||{value:{},revision:0}),write:async(k,value,r)=>{kv.set(k,{value:structuredClone(value),revision:r+1});return r+1;},readState:async()=>({state:structuredClone(state),revision:0}),writeState:async s=>{state=s;return 1;},sync:async({trips})=>{synced.push(trips);return trips.map(Number).map(b);},google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{queries.push(args.q);return {messages:[]};}}});
 await c.start({mode:'targeted',trips:['4242A']});await c.tick();assert.deepEqual(synced,[['4242']]);assert.equal((await c.status()).total,1);assert.ok(queries.length);assert.ok(queries.every(q=>q.includes('4242A')&&!q.includes('9999A')));assert.equal(state.emailCheckpoint.at,'unchanged');assert.ok(state.findings.some(f=>f.id==='other'));assert.equal(kv.has('discovery'),false);assert.equal(state.emailChecks['9999'],undefined);
 await assert.rejects(c.start({mode:'targeted',trips:[]}),/Selecteer/);
});
test('filtered Sanity request remains GET and has explicit number constraint',async()=>{await fetchBookings({trips:['4242'],config:{project:'abc123',dataset:'production',token:'test'},fetcher:async(url,options)=>{assert.equal(options.method,'GET');assert.match(url.searchParams.get('query'),/index in \$trips/);assert.equal(url.searchParams.get('$trips'),'[4242]');return {ok:true,json:async()=>({result:[]})};}});});
