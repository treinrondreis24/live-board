import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {initKKStore,kkPut} from './kk-store.mjs';
import {saveBlog,publishBlog,unpublishBlog,publicBlog,blogMedia,EDITOR_OWNER} from './kk-blog.mjs';
const sqlite=new DatabaseSync(':memory:');await initKKStore({sqlite});
try{
 const id=randomUUID(),proof=randomUUID(),update=randomUUID(),photo=randomUUID();
 await kkPut('submission',proof,'private-owner',{kind:'proof',text:'PRIVATE EVIDENCE'});
 await kkPut('submission',update,'private-owner',{kind:'update',text:'Op reis!',displayName:'Team A',createdAt:123,email:'private@example.org',location:{latitude:52},media:['private-photo']});
 const data={id,title:'Onderweg',text:'**Welkom**',time:Date.now(),media:[]};
 await assert.rejects(saveBlog({...data,quoteId:proof}),/Alleen deelnemersupdates/);
 await saveBlog({...data,quoteId:update});assert.equal((await publicBlog()).length,0);
 await publishBlog(id);let posts=await publicBlog();assert.equal(posts.length,1);assert.equal(posts[0].quote.text,'Op reis!');
 for(const forbidden of ['private-owner','private@example.org','latitude','private-photo','PRIVATE EVIDENCE'])assert.ok(!JSON.stringify(posts).includes(forbidden));
 await saveBlog({...data,title:'Nieuwe concepttitel'});assert.equal((await publicBlog())[0].title,'Onderweg');
 await assert.rejects(blogMedia(id,'private-photo'),/niet beschikbaar/);
 await kkPut('media',photo,'private-owner',{kind:'image'});await assert.rejects(saveBlog({...data,media:[photo]}),/niet beschikbaar/);
 await kkPut('media','editor-photo',EDITOR_OWNER,{kind:'image'});await saveBlog({...data,media:['editor-photo']});
 await unpublishBlog(id);assert.equal((await publicBlog()).length,0);await assert.rejects(blogMedia(id,'editor-photo'),/niet beschikbaar/);
 console.log('PASS: draft isolation, explicit publish/unpublish, proof exclusion, quote privacy, media authorization');
}finally{sqlite.close();}
