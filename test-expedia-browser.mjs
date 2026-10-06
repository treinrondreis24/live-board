import http from 'node:http';

import assert from 'node:assert/strict';

import {chromium} from 'playwright';

import {readFile} from 'node:fs/promises';

import {createExpediaHandler} from './expedia.mjs';

const ref='73559294378081',cancelRef='73559325708011',at='2026-10-06T06:00:00Z';

const events=[ref,cancelRef].map((itineraryId,i)=>({itineraryId,updatedAt:at,receivedAt:at,payload:{data:{itinerary_id:itineraryId,status:i?'Cancelled':'Confirmed',property_booking_items:[{status:i?'Cancelled':'Confirmed',checkin_date:'2026-10-13',checkout_date:'2026-10-16',adult_count:2,child_count:0}]}}}));

const state={evidence:[{id:'test',provider:'Expedia',reference:ref,status:'confirmed',start:'2026-10-13',end:'2026-10-16',occupants:2,room:'Double room, ontbijt inbegrepen'}],expediaEvents:events};

const handler=createExpediaHandler({authenticate:async()=>true,read:async()=>({state:'active',secret:'not-returned',activatedAt:at}),list:async ref=>events.filter(e=>!ref||e.itineraryId===ref),readState:async()=>({state})});

const server=http.createServer(async(req,res)=>{if(req.url==='/seinhuis/flora/flora.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end(await readFile(new URL('./flora.css',import.meta.url)));return;}if(!await handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});

await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;

try{

 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/seinhuis/flora/expedia`);


 await page.getByRole('heading',{name:ref+' · Geen tegenstrijdigheid gevonden',exact:true}).waitFor();await page.getByRole('heading',{name:cancelRef+' · Annulering: voucher niet gebruiken',exact:true}).waitFor();await page.getByText('API bevat geen vergelijkbaar kamertype of ontbijt. E-mail blijft leidend.',{exact:true}).waitFor();

 await page.locator('#itinerary').fill(cancelRef);await page.locator('#search').click();await page.waitForFunction(()=>document.querySelectorAll('#checks article').length===1&&document.querySelector('#checks').textContent.includes('voucher niet gebruiken'));assert.equal(await page.locator('#events details').count(),1);

 await page.locator('#itinerary').fill(ref);await page.locator('#search').click();await page.getByRole('heading',{name:ref+' · Geen tegenstrijdigheid gevonden',exact:true}).waitFor();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);console.log('PASS Expedia browser: matched email, missing fields, cancellation, exact filter and mobile layout');

}finally{await browser?.close();await new Promise(r=>server.close(r));}

