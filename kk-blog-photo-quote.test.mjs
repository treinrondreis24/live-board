import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initKKStore,kkPut} from './kk-store.mjs';
import {saveBlog,publishBlog,publicBlog} from './kk-blog.mjs';
test('photo-only citation survives save and publish; foreign photo remains rejected',async()=>{
 await initKKStore({sqlite:new DatabaseSync(':memory:')});
 await kkPut('submission','update','person',{kind:'update',displayName:'Reiziger',text:'Oorspronkelijke tekst',media:['photo']});
 await kkPut('media','photo','person',{kind:'image'});
 const data={id:'12345678-1234-1234-1234-123456789abc',title:'Nieuws',text:'Een eigen alinea',time:Date.now(),quoteId:'update',quoteText:'',quoteMedia:['photo']};
 await saveBlog(data);await publishBlog(data.id);const [post]=await publicBlog();assert.equal(post.quote.text,'');assert.deepEqual(post.quote.media,['photo']);assert.equal(post.text,'Een eigen alinea');
 await assert.rejects(saveBlog({...data,quoteMedia:['other']}),/hoort niet bij deze update/);
});
