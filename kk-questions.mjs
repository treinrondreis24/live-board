import {randomUUID} from 'node:crypto';
import {kkGet,kkPut,kkInsert,kkList,kkLimit} from './kk-store.mjs';
import {testEdition} from './kk-edition-context.mjs';
import {upload} from './kk-submissions.mjs';
import {authorizedMediaUrl} from './kk-media.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const txt=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('Vul alle tekstvelden in binnen de aangegeven lengte.');return v.trim();};
const key=v=>{if(!/^[a-f0-9-]{36}$/.test(v||''))fail('Ongeldige inzending. Vernieuw de pagina.');return v;};
export async function questionAccess(id,user,admin=false){const row=await kkGet('question',id);if(!row||!admin&&row.owner!==user?.id&&row.value.visibility!=='community')fail('Vraag niet beschikbaar.',404);return row;}
export async function questionDetail(id,user,admin=false){const row=await questionAccess(id,user,admin),answers=(await kkList('answer',id)).map(r=>r.value).sort((a,b)=>a.at-b.at),accepted=(await kkGet('answer-accepted',id))?.value;return {...row.value,answers,accepted:accepted?.answerId||null};}
export async function saveQuestion(user,data){const id=key(data.key),old=await kkGet('question',id);if(old){if(old.owner!==user.id)fail('Ongeldige inzending.',403);return old.value;}if(!['community','private'].includes(data.visibility))fail('Kies wie de vraag mag zien.');const files=Array.isArray(data.files)?[...new Set(data.files)]:[];if(files.length>4)fail('Maximaal vier bijlagen.');const attachments=[];for(const file of files){const r=await kkGet('question-upload',file);if(!r||r.owner!==user.id)fail('Bijlage niet beschikbaar.',403);attachments.push({id:file,name:r.value.name});}const q={id,title:txt(data.title,160),body:txt(data.body,6000),visibility:data.visibility,name:user.displayName||user.fullName||'Deelnemer',edition:Number(user.edition)||null,year:2026,at:Date.now(),files:attachments};await kkInsert('question',id,user.id,q);return q;}
export async function saveAnswer(id,user,data,admin=false){await questionAccess(id,user,admin);const answer={id:key(data.key),questionId:id,body:txt(data.body,6000),name:admin?'Organisatie':user.displayName||user.fullName||'Deelnemer',organizer:admin,at:Date.now()};const old=await kkGet('answer',answer.id);if(old&&old.owner!==id)fail('Ongeldige inzending.');await kkInsert('answer',answer.id,id,answer);return answer;}
export async function acceptAnswer(id,answerId,admin=false){if(!admin)fail('Alleen de organisatie kan een antwoord bevestigen.',403);await questionAccess(id,null,true);if(answerId){const answer=await kkGet('answer',answerId);if(!answer||answer.owner!==id)fail('Antwoord hoort niet bij deze vraag.');}await kkPut('answer-accepted',id,id,{answerId:answerId||null,at:Date.now()});}
export async function questionFile(id,file,user,admin=false){const row=await questionAccess(id,user,admin);if(!row.value.files.some(f=>f.id===file))fail('Bijlage niet beschikbaar.',404);const m=await kkGet('media',file);if(!m||m.owner!==row.owner)fail('Bijlage niet beschikbaar.',404);return authorizedMediaUrl(m.owner,m.id,m.value.filename||'bijlage');}
export async function saveArticle(data){const id=data.id?key(data.id):randomUUID();if(!['summary','detail','faq'].includes(data.category)||![0,12,24].includes(Number(data.edition)))fail('Kies een geldig onderdeel en editie.');const article={id,title:txt(data.title,160),body:txt(data.body,10000),category:data.category,edition:Number(data.edition),year:2026,published:data.published===true,at:Date.now()};await kkPut('help-content',id,'content',article);return article;}
export async function handleQuestions(req,res,url,{admin,user}){
 const action=url.pathname.split('/api/')[1];if(!['questions','question','question-save','answer-save','answer-accept','question-file','question-upload','help-content','help-save','help-from-answer'].includes(action))return false;
 if(!testEdition())return false;if(!admin&&!user)fail('Log eerst in.',401);
 const send=value=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));return true;};
 if(req.method==='GET'){
  if(action==='questions'){const records=await kkList('question'),rows=[];for(const r of records){if(!admin&&r.value.visibility!=='community'&&r.owner!==user.id)continue;const accepted=(await kkGet('answer-accepted',r.id))?.value,answers=await kkList('answer',r.id);rows.push({...r.value,body:undefined,files:undefined,own:r.owner===user?.id,accepted:!!accepted?.answerId,answerCount:answers.length});}return send({rows});}
  if(action==='question')return send({question:await questionDetail(url.searchParams.get('id'),user,admin)});
  if(action==='question-file')return send({url:await questionFile(url.searchParams.get('id'),url.searchParams.get('file'),user,admin)});
  if(action==='help-content')return send({articles:(await kkList('help-content')).map(r=>r.value).filter(a=>admin||a.published)});
  fail('Gebruik het formulier.',405);
 }
 if(req.method!=='POST')fail('Methode niet toegestaan.',405);
 if(req.headers.origin!=='https://'+req.headers.host)fail('Open dit formulier op de eigen website.',403);
 if(!await kkLimit('qa:'+(admin?'admin':user.id),80,3600000))fail('Te veel verzoeken. Probeer het later opnieuw.',429);
 if(action==='question-upload'){if(admin)fail('Upload bij een deelnemersvraag.');const file=await upload(req,user,true),m=await kkGet('media',file.id);await kkPut('question-upload',file.id,user.id,{name:m.value.filename});return send(file);}
 let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>24000)fail('Tekst is te groot.',413);chunks.push(c);}let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{fail('Ongeldig formulier.');}
 if(action==='question-save'){if(admin)fail('Stel de vraag via de deelnemersapp.');return send({question:await saveQuestion(user,data)});}
 if(action==='answer-save')return send({answer:await saveAnswer(data.id,user,data,admin)});
 if(action==='answer-accept'){await acceptAnswer(data.id,data.answerId,admin);return send({ok:true});}
 if(action==='help-save'){if(!admin)fail('Alleen voor beheer.',403);return send({article:await saveArticle(data)});}
 if(action==='help-from-answer'){if(!admin)fail('Alleen voor beheer.',403);const q=await questionDetail(data.id,null,true),answer=q.answers.find(a=>a.id===data.answerId);if(!answer)fail('Antwoord niet gevonden.');return send({article:await saveArticle({title:q.title,body:answer.body,edition:q.edition||0,category:'faq',published:false})});}
 fail('Onbekende actie.',404);
}
