import {canUseProof} from './kk-password.mjs';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffprobe from 'ffprobe-static';
import {kkGet,kkPut,kkList,kkLimit,kkInsert} from './kk-store.mjs';
import {mediaReady,validateMediaDeclaration,putValidatedMedia,authorizedMediaUrl} from './kk-media.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const exec=promisify(execFile);
let active=0;
export async function upload(req,user){
 if(!mediaReady())fail('Mediaopslag wordt nog aangesloten. Je formulier blijft behouden.',503);
 const type=String(req.headers['content-type']||'').split(';')[0],size=Number(req.headers['content-length']);
 let declaration;try{declaration=validateMediaDeclaration({type,size});}catch(e){fail(e.message);}
 if(active>=2)fail('Er worden nu andere bestanden verwerkt. Probeer zo opnieuw.',503);
 if(!await kkLimit('upload:'+user.id,40,3600000))fail('Te veel uploads. Probeer over een uur opnieuw.',429);
 active++;let dir;
 try{
  dir=await mkdtemp(join(tmpdir(),'kk-upload-'));const path=join(dir,'media');let received=0;
  await pipeline(req,new Transform({transform(chunk,encoding,done){received+=chunk.length;done(received>size?Object.assign(Error('Bestand is te groot.'),{status:413}):null,chunk);}}),createWriteStream(path),{signal:AbortSignal.timeout(120000)});
  if((await stat(path)).size!==size)fail('Upload is niet volledig ontvangen. Probeer opnieuw.');
  const {stdout}=await exec(ffprobe.path,['-v','error','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm,jpeg_pipe,png_pipe,webp_pipe','-show_streams','-show_format','-of','json',path],{timeout:15000,maxBuffer:256000,windowsHide:true});
  const probe=JSON.parse(stdout),visual=probe.streams?.find(s=>s.codec_type==='video');
  if(!visual||visual.width>16000||visual.height>16000)fail('Dit foto- of videobestand kan niet worden verwerkt.');
  const codecs={'image/jpeg':['mjpeg'],'image/png':['png'],'image/webp':['webp'],'image/heic':['hevc'],'image/heif':['hevc']};
  if(declaration.kind==='image'&&!codecs[type]?.includes(visual.codec_name))fail('Het bestand komt niet overeen met het fototype.');
  if(declaration.kind==='video'){
   const duration=Number(probe.format?.duration),format=probe.format?.format_name||'';
   if(!Number.isFinite(duration)||duration<=0||duration>60)fail('Een video mag maximaal 60 seconden duren.');
   if(!(type==='video/webm'?format.includes('webm'):format.includes('mov')))fail('Het bestand komt niet overeen met het videotype.');
  }
  const id=randomUUID();await putValidatedMedia({owner:user.id,id,type,size,stream:createReadStream(path)});
  await kkPut('media',id,user.id,{id,type,size,kind:declaration.kind,createdAt:Date.now()});return {id,kind:declaration.kind};
 }finally{active--;if(dir)await rm(dir,{recursive:true,force:true});}
}
export function validateSubmission(data){
 if(!['proof','update'].includes(data.kind))fail('Kies bewijs of update.');
 const text=String(data.text||'').trim();if(text.length>10000)fail('Gebruik maximaal 10.000 tekens.');
 const media=Array.isArray(data.media)?[...new Set(data.media)]:[];if(media.length>5)fail('Maximaal vier foto’s en één video.');
 if(data.kind==='update'&&(!text||!media.length))fail('Voeg tekst en minimaal één foto of video toe.');
 let location=null;
 if(data.location){const {latitude,longitude,accuracy,timestamp}=data.location;if(![latitude,longitude,accuracy,timestamp].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0||timestamp>Date.now()+60000||timestamp<0)fail('Ongeldige locatie.');location={latitude,longitude,accuracy,timestamp};}
 if(data.kind==='proof'&&!text&&!media.length&&!location)fail('Voeg een locatie, toelichting of bestand toe.');
 return {kind:data.kind,text,media,location};
}
export async function saveSubmission(user,data){
 const value=validateSubmission(data);if(value.kind==='proof'&&!canUseProof(user))fail('Privébewijs is beschikbaar na goedkeuring door de organisatie.',403);
 if(!/^[a-f0-9-]{36}$/.test(data.id||''))fail('Ongeldige inzending.');
 const existing=await kkGet('submission',data.id);if(existing){if(existing.owner!==user.id)fail('Geen toegang.',403);return existing.value;}
 let images=0,videos=0;
 for(const id of value.media){const m=await kkGet('media',id);if(!m||m.owner!==user.id)fail('Een bestand is niet beschikbaar.',403);if(m.value.kind==='image')images++;else videos++;}
 if(images>4||videos>1)fail('Maximaal vier foto’s en één video per inzending.');
 if(!await kkLimit('submission:'+user.id,60,3600000))fail('Te veel inzendingen. Probeer later opnieuw.',429);
 const submission={...value,id:data.id,displayName:user.displayName||'Deelnemer',createdAt:Date.now()};
 if(!await kkInsert('submission',data.id,user.id,submission)){const saved=await kkGet('submission',data.id);if(saved.owner!==user.id)fail('Geen toegang.',403);return saved.value;}return submission;
}
export async function ownSubmissions(user){return (await kkList('submission',user.id)).filter(r=>r.value.kind==='update'||canUseProof(user)).map(r=>r.value);}
export async function mediaLink(user,id,admin=false){const m=await kkGet('media',id);if(!m||(!admin&&(m.owner!==user.id||!canUseProof(user))))fail('Geen toegang tot dit bestand.',403);return authorizedMediaUrl(m.owner,id);}
