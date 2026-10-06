import {pdfText} from './flora-mail-source.mjs';
import {sanityConfig} from './flora-sanity.mjs';
import {parseDocument} from './flora-mail-parser.mjs';

// Assets are immutable. Never send the Sanity API token to downloads or follow redirects.
export function assetURL(asset,config=sanityConfig()){
 const id=asset?._id||asset?._ref||'',m=id.match(/^file-([a-f0-9]{40})-pdf$/);
 if(!m||!/^[a-z0-9]+$/.test(config.project)||!/^[-a-z0-9]+$/.test(config.dataset))return null;
 return `https://cdn.sanity.io/files/${config.project}/${config.dataset}/${m[1]}.pdf`;
}
export async function readAssetPDF(asset,{fetcher=fetch,readPDF=pdfText,config=sanityConfig()}={}){
 const url=assetURL(asset,config);if(!url)throw Error('Bestandsformaat niet ondersteund; PDF nodig.');
 if(asset.size>10*1024*1024)throw Error('Bijlage is groter dan 10 MB.');
 const r=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(`Sanity-bijlage niet beschikbaar (HTTP ${r.status}).`);
 const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>10*1024*1024){await r.body.cancel().catch(()=>{});throw Error('Bijlage is groter dan 10 MB.');}chunks.push(chunk);}
 return readPDF(Buffer.concat(chunks));
}
export const barcodeOnly=text=>/Dit is geen vervoerbewijs|This is not a ticket|geen vervoerbewijs|passageticket/i.test(text)&&!/VERVOERBEWIJS\s*\+\s*RESERVERING/i.test(text);
export function attachmentMessage(booking,file,pages){
 const id=file.asset?._id||file.asset?._ref||'',at=file.asset?._createdAt;
 if(!at||!Number.isFinite(Date.parse(at)))throw Error('Uitgiftetijd van bijlage ontbreekt.');
 const docs=pages.map((text,i)=>({label:(file.asset.originalFilename||file.title||'Sanity-bijlage')+' · pagina '+(i+1),text,year:pages.join(' ').match(/\b\d{2}[.]\d{2}[.](20\d{2})\b/)?.[1]}));
 return {id:`sanity-${booking.index}-${id}`,sourceKind:'sanity',sourceTrip:String(booking.index),assetId:id,subject:file.title||'Sanity-bijlage',from:'',at,url:assetURL(file.asset),docs,issues:[],retiredLinks:[],hasLinks:false};
}
export async function collectSanityDocuments(booking,{read,write,readPDF=readAssetPDF,clock=Date.now,deadline=clock()+45000,onProgress=async()=>{}}){
 const messages=[],checks=[];
 for(const file of booking.documents||[]){
  const asset=file.asset||{},assetId=asset._id||asset._ref||'',label=file.title||asset.originalFilename||'Bijlage';
  const check={assetId,title:label,url:assetURL(asset),state:'incomplete',issues:[]};checks.push(check);
  try{
   const key=`message:sanity-${booking.index}-${assetId}`,cached=await read(key);let m=cached.value;
   if(!m?.docs||m.sanityVersion!==1){
    if(clock()>deadline)throw Error('Tijdslimiet bereikt; deze bijlage wordt bij de volgende controle opnieuw geprobeerd.');
    await onProgress({phase:'Sanity-bijlage lezen: '+label});
    m=attachmentMessage(booking,file,await readPDF(asset));m.sanityVersion=1;await write(key,m,cached.revision);
   }
   messages.push(m);
   const meaningful=m.docs.filter(d=>!barcodeOnly(d.text)),proofs=meaningful.map(d=>parseDocument(d,m)).filter(Boolean);
   // Keep unrecognized pages visible even when another page was successfully parsed.
   const unparsed=meaningful.filter(d=>!parseDocument(d,m)&&(!d.text.trim()||!proofs.some(e=>e.documentPages?.includes(d.label))));
   check.pages=m.docs.length;check.references=proofs.map(e=>e.reference);
   check.state=meaningful.length===0?'informational':unparsed.length?'incomplete':'read';
   if(unparsed.length)check.issues.push('Niet automatisch beoordeeld: '+unparsed.map(d=>d.label).join(', ')+'. Bekijk de bijlage; dit is geen bewijs van een foutieve reservering.');
  }catch(e){check.issues.push(e.message);}
 }
 return {messages,checks};
}
