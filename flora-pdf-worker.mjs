import {parentPort,workerData} from 'node:worker_threads';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
try{
 const task=getDocument({data:new Uint8Array(workerData),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
 const pdf=await task.promise;if(pdf.numPages>50)throw Error('PDF bevat meer dan 50 pagina’s.');
 const pages=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),items=(await page.getTextContent()).items;const raw=items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('');if(!/FINNLINES|Dit is uw hotelvoucher/i.test(raw)){pages.push(raw);continue;}const rows=[];for(const item of items.filter(x=>x.str).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])){let row=rows.find(r=>Math.abs(r.y-item.transform[5])<2);if(!row){row={y:item.transform[5],items:[]};rows.push(row);}row.items.push(item);}pages.push(rows.sort((a,b)=>b.y-a.y).map(r=>r.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(x=>x.str).join(' ')).join('\n'));}
 await task.destroy();parentPort.postMessage({pages});
}catch{parentPort.postMessage({error:'PDF kon niet worden uitgelezen; handmatige controle nodig.'});}
