import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(tag='span'){this.tag=tag;this.children=[];this.textContent='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 get text(){return this.textContent+this.children.map(c=>typeof c==='string'?c:c.text).join('');}
}
const document={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element(),{textContent:text})};
const context=vm.createContext({window:{},File,Blob,document});
vm.runInContext(readFileSync(new URL('./kk-reliable.js',import.meta.url),'utf8'),context);
const reliable=context.window.kkReliable;
test('prepared photo survives original file permission being revoked',async()=>{
 let revoked=false;const source={name:'photo.jpg',type:'image/jpeg',lastModified:123,arrayBuffer:async()=>{if(revoked)throw new DOMException('Cannot read','NotReadableError');return new Uint8Array([1,2,3]).buffer;}};
 const copy=await reliable.snapshotPhoto(source);revoked=true;
 await assert.rejects(source.arrayBuffer());assert.deepEqual([...new Uint8Array(await copy.arrayBuffer())],[1,2,3]);assert.equal(copy.name,source.name);assert.equal(copy.lastModified,123);
});
test('unreadable photo names the file and provides actionable Dutch help and email fallback',async()=>{
 const error=new DOMException('The requested file could not be read','NotReadableError');
 await assert.rejects(reliable.snapshotPhoto({name:'50860.jpg',type:'image/jpeg',arrayBuffer:async()=>{throw error;}}));
 const target=new Element();let clicked=false;reliable.showError(target,error,'Bewijs',false,{click(){clicked=true;}});
 assert.match(target.text,/50860.jpg/);assert.match(target.text,/Downloads/);assert.match(target.text,/#KMtrein/);assert.doesNotMatch(target.text,/requested file/);
 target.children.find(c=>c.tag==='button').onclick();assert.equal(clicked,true);
 const links=target.children.flatMap(c=>c.children||[]).filter(c=>c.tag==='a');assert.equal(links.length,2);for(const link of links){assert.match(decodeURIComponent(link.href),/#KMtrein – Bewijs/);assert.match(decodeURIComponent(link.href),/Naam:/);}
});
test('claim connection error asks for retry and identifies end claim in mail subject',()=>{
 const target=new Element();reliable.showError(target,{status:0},'Eindclaim',true);
 assert.match(target.text,/Controleer je internetverbinding/);assert.match(target.text,/Vorige verzending controleren en afronden/);
 const links=target.children.flatMap(c=>c.children||[]).filter(c=>c.tag==='a');assert.match(decodeURIComponent(links[0].href),/#KMtrein – Eindclaim/);
});
test('large videos are not copied into mobile memory',async()=>{
 const video={name:'video.mp4',type:'',arrayBuffer(){throw Error('Should not allocate video');}};
 assert.equal(await reliable.snapshotPhoto(video),video);
});
