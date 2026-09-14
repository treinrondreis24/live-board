// Usage: node connections-browser-check.mjs <Playwright module URL>
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.argv[2]||'playwright');
const rows=['Köln Hbf','Basel SBB','Zürich HB','Wien Hbf','Milano Centrale','Mannheim Hbf','Innsbruck Hbf','Berlin Hbf'].map((station,i)=>({ruleId:String(i),eligible:true,status:i===4?'missed':i===1?'uncertain':'feasible',minutes:i===1?5:10,incoming:{stationName:station,source:'DB',category:'ICE',number:'225',origin:'Amsterdam Centraal',planned:Date.now(),expected:Date.now(),currentTrack:'5',cancelled:i===4},outgoing:{source:'DB',category:'EC',number:'371',destination:'München Hbf',planned:Date.now()+600000,expected:Date.now()+600000,currentTrack:'7'}}));
rows.push({...rows[0],ruleId:'hidden',eligible:false,status:'not-planned'});
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/connections')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({monitor:{lastRun:Date.now()},connections:rows}));}
 const name=req.url==='/'?'/connections.html':req.url;
 if(!fs.existsSync('public'+name)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync('public'+name));
}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 for(const viewport of [{width:1672,height:941},{width:1280,height:720}]){
 await page.setViewportSize(viewport);await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});await page.waitForSelector('.entry');
 assert.equal(await page.locator('.entry').count(),7);assert.equal(await page.getByText('Aansluiting niet mogelijk').count(),1);
 const bounds=await page.evaluate(()=>({last:document.querySelector('.entry:last-child').getBoundingClientRect().bottom,footer:document.querySelector('footer').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth}));
 assert.ok(bounds.last<=bounds.footer+1,JSON.stringify(bounds));assert.equal(bounds.overflow,false);
 if(viewport.width===1672)await page.screenshot({path:'connections-preview.png'});
 await page.clock.fastForward(15000);assert.equal(await page.locator('#pages').textContent(),'2 / 2');assert.equal(await page.locator('.entry').count(),1);
 }
 assert.deepEqual(errors,[]);console.log('Browser checks passed: filtering, cancellation, pagination, two screen sizes, no overlap or script errors.');
}finally{await browser.close();server.close();}
