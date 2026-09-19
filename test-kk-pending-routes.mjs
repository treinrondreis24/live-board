import assert from 'node:assert/strict';
import {pendingRouteRows} from './kk-pending-routes.mjs';
const p={fullName:'A',station:'Zwolle',edition:24};
const row=(id,station,route=null)=>({id,owner:'a',participant:p,created:Number(id),proof:{station},route});
const results=pendingRouteRows([row('1','Meppel',{status:'participant-confirmed'}),row('2','Groningen'),row('3','Assen',{status:'proposed',from:'Groningen',to:'Assen',km:28,via:[]}),{...row('4','Rotterdam'),owner:'b',participant:{...p,fullName:'B',station:'Den Haag HS'}}]);
assert.equal(results.length,3);assert.equal(results[0].from,'Meppel');assert.equal(results[0].to,'Groningen');assert.equal(results[0].km,null);assert.equal(results[1].km,28);assert.equal(results[2].from,'Den Haag HS');
console.log('PASS missing/proposed routes, previous confirmed proof, participant boundary');
