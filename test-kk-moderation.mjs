import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initKKStore,kkPut,kkGet,kkOwned} from './kk-store.mjs';
import {editUpdate,deleteUpdate,deleteParticipant} from './kk-moderation.mjs';
import {validateProfile} from './kk-handler.mjs';
const sqlite=new DatabaseSync(':memory:');await initKKStore({sqlite});
const a='a'.repeat(64),b='b'.repeat(64),removed=[];const remove=async(owner,id)=>removed.push([owner,id]);
try{
 await kkPut('participant',a,a,{id:a,fullName:'A',displayName:'A'});await kkPut('participant',b,b,{id:b});
 await kkPut('submission','u',a,{kind:'update',text:'Old',media:['m']});await kkPut('submission','p',a,{kind:'proof',media:['m']});await kkPut('media','m',a,{previewId:'preview'});
 await kkPut('blog-public','blog','editor',{quote:{id:'u',text:'Old'},text:'Editorial'});
 await editUpdate({id:'u',text:'New',title:'Title'});assert.equal((await kkGet('submission','u')).value.text,'New');
 await assert.rejects(editUpdate({id:'p',text:'no'}));await assert.rejects(editUpdate({id:'u',text:''}));
 await deleteUpdate('u',remove);assert.equal(await kkGet('submission','u'),null);assert.equal((await kkGet('blog-public','blog')).value.quote,null);assert.equal(removed.length,0);
 await kkPut('session','session',a,{});await kkPut('password',a,a,{});
 await deleteParticipant(a,remove);assert.equal((await kkOwned(a)).length,0);assert.ok(await kkGet('participant',b));assert.deepEqual(removed,[[a,'m'],[a,'preview']]);
 const profile=validateProfile({fullName:'Updated',displayName:'Display',edition:'',startTime:'',distance:'',rotterdamTime:''},{},true);assert.equal(profile.fullName,'Updated');
 console.log('PASS: edits, proof protection, shared media, citation removal, account cascade and incomplete profile editing');
}finally{sqlite.close();}
