import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {initKKStore,kkPut} from './kk-store.mjs';
import {assignTeam,updatePage,updateMedia} from './kk-updates.mjs';
const sqlite=new DatabaseSync(':memory:');await initKKStore({sqlite});
try{
 for(const id of ['a','b'])await kkPut('participant',id,id,{displayName:id,email:'SECRET'});
 await assignTeam({participantId:'a',teamId:'samen',name:'Samen'});await assignTeam({participantId:'b',teamId:'samen',name:'Samen'});
 for(let i=0;i<35;i++)await kkPut('submission',randomUUID(),i%2?'a':'b',{kind:'update',text:'Hallo',media:[],displayName:'Naam',createdAt:Date.now(),location:'SECRET'});
 const proof=randomUUID();await kkPut('submission',proof,'a',{kind:'proof',text:'PRIVATE',media:['private']});
 const page=await updatePage({teams:['samen']});assert.equal(page.updates.length,30);assert.ok(page.next);assert.equal(page.teams.length,1);assert.ok(!JSON.stringify(page).includes('SECRET'));assert.ok(!JSON.stringify(page).includes('PRIVATE'));
 const next=await updatePage({teams:['samen'],before:page.next});assert.equal(next.updates.length,5);assert.ok(next.updates.every(x=>!page.updates.some(y=>y.id===x.id)));
 assert.equal((await updatePage({teams:['ander']})).updates.length,0);await assert.rejects(updateMedia(proof,'private'),/niet beschikbaar/);
 console.log('PASS: team grouping, filtered keyset pagination, proof exclusion and private field omission');
}finally{sqlite.close();}
