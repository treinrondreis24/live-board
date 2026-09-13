import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {initKKStore,kkGet,kkPut} from './kk-store.mjs';
import {registerPassword,loginPassword,setApproval,canUseProof} from './kk-password.mjs';
import {saveSubmission,ownSubmissions,mediaLink} from './kk-submissions.mjs';
const sqlite=new DatabaseSync(':memory:');await initKKStore({sqlite});
try{
 const data={password:'test-passphrase-long',fullName:'Tester',displayName:'Testteam'};
 const user=await registerPassword('test@example.org',data);assert.equal(canUseProof(user),false);assert.ok(!JSON.stringify(user).includes(data.password));
 assert.equal((await loginPassword(user.email,data.password)).id,user.id);
 await assert.rejects(loginPassword(user.email,'another-long-password'),/klopt niet/);
 await assert.rejects(registerPassword(user.email,{...data,password:'different-password'}),/Aanmelden niet mogelijk/);
 const media=randomUUID();await kkPut('media',media,user.id,{kind:'image'});
 await saveSubmission(user,{id:randomUUID(),kind:'update',text:'Hallo',media:[media]});
 await assert.rejects(saveSubmission(user,{id:randomUUID(),kind:'proof',text:'Bewijs',media:[]}),/goedkeuring/);
 await assert.rejects(mediaLink(user,media),/Geen toegang/);
 await setApproval(user.id,true);const approved=(await kkGet('participant',user.id)).value;assert.equal(canUseProof(approved),true);
 await saveSubmission(approved,{id:randomUUID(),kind:'proof',text:'Bewijs',media:[]});assert.equal((await ownSubmissions(approved)).length,2);
 await setApproval(user.id,false);const revoked=await loginPassword(user.email,data.password);assert.equal((await ownSubmissions(revoked)).length,1);
 console.log('PASS: password login, duplicate rejection, pending updates, approval/revocation and private evidence denial');
}finally{sqlite.close();}
