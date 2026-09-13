import {previewMedia} from './kk-preview.mjs';
import {kkList,kkGet,kkPut} from './kk-store.mjs';
import {authorizedMediaUrl} from './kk-media.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export async function assignTeam(data){
 const user=await kkGet('participant',data.participantId),name=String(data.name||'').trim(),id=String(data.teamId||'').trim();
 if(!user||!name||name.length>80||!/^[a-z0-9-]{1,60}$/.test(id))fail('Kies een deelnemer, teamcode en teamnaam.');
 await kkPut('team',id,'',{name});await kkPut('team-member',user.id,user.id,{teamId:id});
}
export async function updatePage({before='',teams=[],q='',participantId='',after=''}={}){
 if(teams.length>20||teams.some(t=>typeof t!=='string'||t.length>100))fail('Kies maximaal twintig teams.');
 if(after)return {newCount:await kkUpdateRows('',teams,q,participantId,after)};
 // Filter before pagination, including historical updates after team assignment.
 const members=new Map((await kkList('team-member')).map(r=>[r.id,r.value.teamId]));
 const names=new Map((await kkList('team')).map(r=>[r.id,r.value.name]));
 const rows=await kkUpdateRows(before,teams,q,participantId);const available=new Map();for(const p of await kkList('participant')){const id=members.get(p.id)||'solo-'+p.id;available.set(id,names.get(id)||p.value.displayName||'Deelnemer');}
 const mapped=rows.map(r=>{const teamId=members.get(r.owner)||'solo-'+r.owner,teamName=names.get(teamId)||r.value.displayName||'Deelnemer';available.set(teamId,teamName);return {id:r.id,participantId:r.owner,title:r.value.title||'',text:r.value.text,displayName:r.value.displayName,createdAt:Number(r.created),media:r.value.media,teamId,teamName};});
 const filtered=mapped;
 const updates=filtered.slice(0,30),last=updates.at(-1);
 return {serverTime:Date.now(),updates,teams:[...available].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name)),next:filtered.length>30?`${String(last.createdAt).padStart(16,'0')}:${last.id}`:null};
}
import {kkUpdateRows} from './kk-store.mjs';
export async function updateMedia(updateId,mediaId,preview=false){
 const row=await kkGet('submission',updateId);if(!row||row.value.kind!=='update'||!row.value.media.includes(mediaId))fail('Bestand niet beschikbaar.',404);
 const media=await kkGet('media',mediaId);if(!media||media.owner!==row.owner)fail('Bestand niet beschikbaar.',404);
 return preview?await previewMedia(media):{url:await authorizedMediaUrl(media.owner,mediaId),type:media.value.type};
}
