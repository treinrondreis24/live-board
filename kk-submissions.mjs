import {canUseProof} from './kk-password.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,stat,open} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffprobe from 'ffprobe-static';
import sharp from 'sharp';
sharp.cache(false);sharp.concurrency(1);
import {kkGet,kkPut,kkList,kkLimit,kkInsert,kkAcquireUploadLease,kkReleaseUploadLease} from './kk-store.mjs';
import {mediaReady,validateMediaDeclaration,putValidatedMedia,authorizedMediaUrl} from './kk-media.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const exec=promisify(execFile);
let active=0;const stats={started:0,succeeded:0,failed:0,busy:0,reused:0,bytes:0};
export function uploadStatus(){return {...stats,active,limit:2};}
function busy(){stats.busy++;throw Object.assign(Error('Het is druk. Je upload probeert het automatisch opnieuw.'),{status:503,retryAfter:4});}
export function uploadIdentity(owner,claimOnly,key){const hex=createHash('sha256').update(owner+':'+claimOnly+':'+key).digest('hex').slice(0,32);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);}
async function existingUpload(id,user,claimOnly,size,declaredType,filename){const row=await kkGet('media',id);if(!row)return null;if(row.owner!==user.id||row.value.claimOnly!==claimOnly||row.value.size!==size||row.value.declaredType!==declaredType||row.value.filename!==filename)fail('Deze uploadcode hoort bij een ander bestand.',409);stats.reused++;return {id,kind:row.value.kind};}
export async function inspectPhoto(path){
   const meta=await sharp(path,{limitInputPixels:60000000}).metadata();
   const actual={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heif:meta.compression==='av1'?'image/avif':'image/heic'}[meta.format];
   if(!actual)fail('Dit fotoformaat wordt niet ondersteund. Gebruik JPEG, PNG, WebP of AVIF.');
   await sharp(path,{limitInputPixels:60000000}).timeout({seconds:15}).resize(1,1).png().toBuffer();
   return actual;
}
export async function upload(req,user,claimOnly=false){
 if(!mediaReady())fail('Mediaopslag wordt nog aangesloten. Je formulier blijft behouden.',503);
 let type=String(req.headers['content-type']||'').split(';')[0],size=Number(req.headers['content-length']);
 if(type==='image/jpg')type='image/jpeg';
 let declaration;try{declaration=validateMediaDeclaration({type,size});}catch(e){fail(e.message);}
 if(declaration.kind==='document'&&!claimOnly)fail('Documenten kunnen alleen bij een eindclaim worden toegevoegd.');
 const filename=claimOnly?decodeURIComponent(String(req.headers['x-file-name']||'bestand')).replace(/[\\/\x00-\x1f]/g,'_').slice(0,180):'';
 const key=String(req.headers['x-upload-id']||'');if(key&&!/^[a-f0-9-]{36}$/.test(key))fail('Ongeldige uploadcode.');
 const id=key?uploadIdentity(user.id,claimOnly,key):randomUUID(),declaredType=type,nonce=randomUUID();
 const cached=key?await existingUpload(id,user,claimOnly,size,declaredType,filename):null;if(cached)return cached;
 if(active>=2)busy();
 active++;let dir,leased=false,started=false;let stage='receive';
 try{
  if(!await kkAcquireUploadLease(id,user.id,nonce))busy();leased=true;
  const done=key?await existingUpload(id,user,claimOnly,size,declaredType,filename):null;if(done)return done;
  if(!await kkLimit('upload:'+user.id,40,3600000))fail('Te veel uploads. Probeer over een uur opnieuw.',429);
  stats.started++;started=true;
  dir=await mkdtemp(join(tmpdir(),'kk-upload-'));const path=join(dir,'media');let received=0;
  await pipeline(req,new Transform({transform(chunk,encoding,done){received+=chunk.length;done(received>size?Object.assign(Error('Bestand is te groot.'),{status:413}):null,chunk);}}),createWriteStream(path),{signal:AbortSignal.timeout(120000)});
  if((await stat(path)).size!==size)fail('Upload is niet volledig ontvangen. Probeer opnieuw.');
  stage='validate';
  if(declaration.kind==='document'){
   await inspectClaimDocument(path,type,filename);
  }else if(declaration.kind==='image'){
   type=await inspectPhoto(path);
  }else{
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
  }
  stage='store';await putValidatedMedia({owner:user.id,id,type,size,stream:createReadStream(path)});
  let previewId=null;if(declaration.kind==='image'){try{const previewPath=join(dir,'preview.jpg');await sharp(path,{limitInputPixels:60000000}).timeout({seconds:20}).rotate().resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).jpeg({quality:78}).toFile(previewPath);const preview=key?uploadIdentity(user.id,claimOnly,key+':preview'):randomUUID();await putValidatedMedia({owner:user.id,id:preview,type:'image/jpeg',size:(await stat(previewPath)).size,stream:createReadStream(previewPath)});previewId=preview;}catch{}}
  await kkPut('media',id,user.id,{id,type,size,declaredType,kind:declaration.kind,claimOnly,filename,previewId,createdAt:Date.now()});stats.succeeded++;stats.bytes+=size;return {id,kind:declaration.kind};
 }catch(e){if(started)stats.failed++;if(e.status)throw e;const ref=randomUUID().slice(0,8);console.error('KK_UPLOAD',ref,stage,String(e.code||e.name||'Error'));fail(stage==='validate'?'Het bestand kan niet worden gelezen. Sla de foto opnieuw op als JPEG of PNG, of kies een andere video. Foutcode: '+ref:stage==='receive'?'De upload is onderbroken. Controleer je verbinding en probeer opnieuw. Foutcode: '+ref:'Het bestand kon niet worden opgeslagen. Probeer opnieuw. Foutcode: '+ref,stage==='validate'?422:503);}finally{active--;if(leased)await kkReleaseUploadLease(id,nonce).catch(()=>{});if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
export function validateSubmission(data){
 if(!['proof','update'].includes(data.kind))fail('Kies bewijs of update.');
 const text=String(data.text||'').trim();if(text.length>10000)fail('Gebruik maximaal 10.000 tekens.');
 const media=Array.isArray(data.media)?[...new Set(data.media)]:[];if(media.length>5)fail('Maximaal vier foto’s en één video.');
 if(data.kind==='update'&&!text)fail('Voeg tekst toe aan je update.');
 let location=null;
 if(data.location){const {latitude,longitude,accuracy,timestamp}=data.location;if(![latitude,longitude,accuracy,timestamp].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0||timestamp>Date.now()+60000||timestamp<0)fail('Ongeldige locatie.');location={latitude,longitude,accuracy,timestamp};}
 if(data.kind==='proof'&&!media.length&&data.withoutAttachment!==true)fail('Bevestig dat je zonder foto wilt insturen.');
 const station=data.kind==='proof'?String(data.station||'').trim().slice(0,200):'';const stationId=data.kind==='proof'?String(data.stationId||''):'';if(stationId&&!/^nl-[a-z0-9-]{1,20}$/.test(stationId))fail('Ongeldig station.');return {kind:data.kind,title:data.kind==='update'?String(data.title||'').trim().slice(0,120):'',text,media,location,station,stationId,withoutAttachment:data.kind==='proof'&&!media.length&&data.withoutAttachment===true};
}
export async function saveSubmission(user,data){
 const value=validateSubmission(data);if(value.kind==='proof'&&!canUseProof(user))fail('Privébewijs is beschikbaar na goedkeuring door de organisatie.',403);
 if(!/^[a-f0-9-]{36}$/.test(data.id||''))fail('Ongeldige inzending.');
 const existing=await kkGet('submission',data.id);if(existing){if(existing.owner!==user.id)fail('Geen toegang.',403);return existing.value;}
 let images=0,videos=0;
 for(const id of value.media){const m=await kkGet('media',id);if(!m||m.owner!==user.id)fail('Een bestand is niet beschikbaar.',403);if(m.value.claimOnly||m.value.kind==='document')fail('Dit bestand is alleen bedoeld voor een eindclaim.');if(m.value.kind==='image')images++;else videos++;}
 
 if(images>4||videos>1)fail('Maximaal vier foto’s en één video per inzending.');
 if(!await kkLimit('submission:'+user.id,60,3600000))fail('Te veel inzendingen. Probeer later opnieuw.',429);
 const submission={...value,id:data.id,displayName:user.displayName||'Deelnemer',createdAt:Date.now(),receivedAt:Date.now()};
 if(!await kkInsert('submission',data.id,user.id,submission)){const saved=await kkGet('submission',data.id);if(saved.owner!==user.id)fail('Geen toegang.',403);return saved.value;}return submission;
}
export async function ownSubmissions(user){return (await kkList('submission',user.id)).filter(r=>r.value.kind==='update'||canUseProof(user)).map(r=>r.value);}
export async function mediaLink(user,id,admin=false){const m=await kkGet('media',id);if(!m||(!admin&&(m.owner!==user.id||!canUseProof(user))))fail('Geen toegang tot dit bestand.',403);return authorizedMediaUrl(m.owner,id);}

export async function inspectClaimDocument(path,type,name){const ext=name.split('.').pop().toLowerCase();const types={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',csv:'text/csv',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain',ods:'application/vnd.oasis.opendocument.spreadsheet',odt:'application/vnd.oasis.opendocument.text'};if(types[ext]!==type)fail('Bestandsnaam en documenttype komen niet overeen.');const f=await open(path,'r');const b=Buffer.alloc(512);let length;try{length=(await f.read(b,0,512,0)).bytesRead;}finally{await f.close();}const head=b.subarray(0,length);const valid=ext==='pdf'?head.subarray(0,5).toString()==='%PDF-':['doc','xls'].includes(ext)?head.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1':['docx','xlsx','ods','odt'].includes(ext)?head.subarray(0,4).toString('hex')==='504b0304':!head.includes(0)&&!head.subarray(0,2).equals(Buffer.from('MZ'));if(!valid)fail('Het bestand lijkt geen geldig '+ext.toUpperCase()+'-document. Exporteer het opnieuw, bijvoorbeeld als PDF.');}
