import {kkGet,kkPut,kkList,kkDelete} from './kk-store.mjs';
import {authorizedMediaUrl} from './kk-media.mjs';
export const EDITOR_OWNER='e'.repeat(64);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export async function saveBlog(data){
 if(!/^[a-f0-9-]{36}$/.test(data.id||''))fail('Ongeldig bericht.');
 const title=String(data.title||'').trim(),text=String(data.text||'').trim(),time=Number(data.time);
 if(!title||title.length>200||text.length>10000||!Number.isFinite(time)||time<0||time>8640000000000000)fail('Vul een titel en geldig tijdstip in. Tekst maximaal 10.000 tekens.');
 const media=Array.isArray(data.media)?[...new Set(data.media)]:[];
 if(media.length>4)fail('Maximaal vier redactionele foto’s.');
 for(const id of media){const m=await kkGet('media',id);if(!m||m.owner!==EDITOR_OWNER||m.value.kind!=='image')fail('Deze redactionele foto is niet beschikbaar.',403);}
 let quote=null;
 if(data.quoteId){const source=await kkGet('submission',data.quoteId);if(!source||source.value.kind!=='update')fail('Alleen deelnemersupdates kunnen worden geciteerd.');quote={id:source.id,displayName:source.value.displayName,text:source.value.text,time:source.value.createdAt};}
 // Public payloads are explicit: no email, coordinates, owner or evidence.
 const draft={id:data.id,title,text,time,media,quote,updatedAt:Date.now()};
 await kkPut('blog-draft',data.id,EDITOR_OWNER,draft);return draft;
}
export async function publishBlog(id){const draft=await kkGet('blog-draft',id);if(!draft)fail('Bewaar eerst het concept.',404);await kkPut('blog-public',id,EDITOR_OWNER,{...draft.value,publishedAt:Date.now()});}
export async function unpublishBlog(id){await kkDelete('blog-public',id);}
export async function publicBlog(){return (await kkList('blog-public')).map(r=>r.value).sort((a,b)=>b.time-a.time);}
export async function blogMedia(postId,mediaId){const post=await kkGet('blog-public',postId);if(!post||!post.value.media.includes(mediaId))fail('Foto niet beschikbaar.',404);return authorizedMediaUrl(EDITOR_OWNER,mediaId);}
