import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFloraHandler} from './flora.mjs';
import {emptyState} from './flora-store.mjs';
import {evaluate,validateEvidence} from './flora-engine.mjs';
let state=emptyState(),revision=0;
state.bookings=[{_id:'test',index:42,status:'te verwerken',firstName:'Test',lastName:'Reiziger',dateDeparture:'2027-02-19',passengers:[{firstName:'Test',lastName:'Reiziger'}],todos:[{_key:'h',title:'Testhotel | Double',tag:'hotel',startDate:'2027-02-19',endDate:'2027-02-20',done:true}]}];
state.evidence=validateEvidence([{trip:'42',todoKey:'h',provider:'Testhotel',reference:'test',source:'test.pdf',status:'confirmed',start:'2027-02-18',end:'2027-02-20',name:'Test Reiziger',capacity:2,occupants:1,productMatch:true}]);Object.assign(state,evaluate(state));
const handler=createFloraHandler({authenticate:async()=>true,read:async()=>({state:structuredClone(state),revision}),write:async(s,r)=>{assert.equal(r,revision);state=s;return ++revision;},actor:async()=> 'Testbeheerder',configuration:()=>({token:''})});
const server=http.createServer((req,res)=>void handler(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;process.env.FLORA_PUBLIC_ORIGIN=origin;
let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/seinhuis/flora/');await page.getByRole('button',{name:'Bekijken →'}).click();await page.locator('#reason').fill('Bevestiging nagekeken; dit blijft een aandachtspunt.');await page.locator('#reviewstatus').selectOption('attention');await page.getByRole('button',{name:'Beoordeling opslaan'}).click();await page.locator('#detail').waitFor({state:'hidden'});assert.equal(state.findings[0].override.status,'attention');
 await page.reload();await page.locator('#status').selectOption('alarm');await page.getByText('Geen meldingen binnen deze filters.').waitFor();await page.locator('#status').selectOption('attention');await page.getByRole('button',{name:'Bekijken →'}).waitFor();
 await page.getByRole('button',{name:'Importeren',exact:true}).click();const content=JSON.stringify([{trip:'42',todoKey:'h',provider:'Testhotel',reference:'test',source:'nieuw.pdf',status:'confirmed',start:'2027-02-19',end:'2027-02-20',name:'Test Reiziger',capacity:2,occupants:1,productMatch:true}]);await page.locator('#file').setInputFiles({name:'bevestiging.json',mimeType:'application/json',buffer:Buffer.from(content)});await page.getByRole('button',{name:'Deze import opslaan en controleren'}).click();await page.getByText('Import opgeslagen en gecontroleerd.').waitFor();assert.equal(state.summary[0].checked,true);
 await page.getByRole('button',{name:'Boekingen',exact:true}).click();await page.getByText('✓ Gecontroleerd',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Controleregels',exact:true}).click();await page.locator('#namerule').selectOption('accept');await page.getByRole('button',{name:'Regelwijziging testen'}).click();await page.getByRole('button',{name:'Geteste wijziging activeren'}).click();await page.waitForFunction(()=>document.querySelector('#saverules').hidden);assert.equal(state.rules.partialNames,'accept');
 await page.getByRole('button',{name:'Meldingen',exact:true}).click();await page.screenshot({path:process.env.FLORA_SCREENSHOT||join(tmpdir(),'flora-test.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS FloRA browser: review persistence, filters, import preview/commit, green booking, rule test/activate, mobile layout');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
