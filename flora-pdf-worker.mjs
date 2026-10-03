import {parentPort,workerData} from 'node:worker_threads';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
try{
 const task=getDocument({data:new Uint8Array(workerData),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
 const pdf=await task.promise;if(pdf.numPages>50)throw Error('PDF bevat meer dan 50 pagina’s.');
 const pages=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),items=(await page.getTextContent()).items;pages.push(items.map(x=>x.str+(x.hasEOL?'\n':' ')).join(''));}
 await task.destroy();parentPort.postMessage({pages});
}catch{parentPort.postMessage({error:'PDF kon niet worden uitgelezen; handmatige controle nodig.'});}
