import {randomUUID} from 'node:crypto';
import {kkGet,kkPut,kkFeaturePosts,kkFeatureVote,kkFeatureCounts} from './kk-store.mjs';
const fail=m=>{throw Object.assign(Error(m),{status:400});};
export async function featureView(post,user){if(!post)return null;const votes=await kkFeatureCounts(post.id),own=user?await kkGet('feature-vote',post.id+':'+user.id):null;return {...post,total:votes.length,counts:post.options.map((_,i)=>votes.filter(v=>v===i).length),answered:!!own};}
export async function currentFeature(user){const active=await kkGet('feature-active','current');return featureView(active?.value.id?(await kkGet('feature',active.value.id))?.value:null,user);}
export async function featureArchive(){const active=(await kkGet('feature-active','current'))?.value.id;return Promise.all((await kkFeaturePosts()).map(async r=>({...await featureView(r),active:r.id===active})));}
export async function featureSave(data){const title=String(data.title||'').trim(),text=String(data.text||'').trim(),type=data.type,action=data.action,options=type==='poll'?(Array.isArray(data.options)?data.options.map(s=>String(s).trim()).filter(Boolean):[]):[];
 if(!title||title.length>200||text.length>3000||!['poll','button'].includes(type))fail('Vul een titel, tekst en berichttype in.');
 if(type==='poll'&&(options.length<2||options.length>6||new Set(options).size!==options.length||options.some(s=>s.length>150)))fail('Gebruik twee tot zes verschillende antwoorden, maximaal 150 tekens per antwoord.');
 if(type==='button'&&!['delen','bewijs','eindclaim'].includes(action))fail('Kies een actieknop.');
 const post={id:randomUUID(),title,text,type,action:type==='button'?action:null,options,createdAt:Date.now(),closed:'no'};await kkPut('feature',post.id,'editor',post);
 const old=(await kkGet('feature-active','current'))?.value.id;if(old){const r=await kkGet('feature',old);if(r)await kkPut('feature',old,'editor',{...r.value,closed:'yes'});}
 await kkPut('feature-active','current','editor',{id:post.id});return post;
}
export async function featureStop(data){const r=await kkGet('feature',data.id);if(!r)fail('Bericht niet gevonden.');await kkPut('feature',r.id,'editor',{...r.value,closed:'yes'});if(data.hide===true&&(await kkGet('feature-active','current'))?.value.id===r.id)await kkPut('feature-active','current','editor',{id:null});}
export async function featureVote(user,data){const p=(await kkGet('feature',data.id))?.value;if(!p||p.type!=='poll'||!Number.isInteger(data.choice)||data.choice<0||data.choice>=p.options.length)fail('Kies een geldig antwoord.');const existing=await kkGet('feature-vote',p.id+':'+user.id);if(!existing&&!await kkFeatureVote(p.id,user.id,data.choice))fail('Deze poll is gesloten. Vernieuw de pagina.');return currentFeature(user);}
