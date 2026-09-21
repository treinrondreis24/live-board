const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;
if(path==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta name="viewport" content="width=device-width"><div id="host"></div><script src="/stations.js"></script><script>kkStations(document.getElementById("host"))</script>'});
if(path==='/stations.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:await fs.readFile('kk-stations.js','utf8')});
if(path.endsWith('.css'))return route.fulfill({contentType:'text/css',body:await fs.readFile(path.includes('/app/')?'tr-app.css':'kk-stations.css','utf8')});
if(path==='/app/api/stations')return route.fulfill({json:{stations:[{id:'nl-ut',name:'Utrecht Centraal',country:'NL'},{id:'nl-amf',name:'Amersfoort Centraal',country:'NL'}]}});
if(path.startsWith('/app/api/board/'))return route.fulfill({json:{departures:[{time:'12:00',to:'Amsterdam C',category:'IC',number:'123',track:'5',hasRealtime:true,delay:0,route:['Amsterdam C']}],source:'Testbron',notice:'Testgegevens'}});
return route.fulfill({json:{ok:true}});});
await page.goto('https://test.local/#mijn-stations');await page.getByRole('heading',{name:'Utrecht Centraal',exact:true}).waitFor();assert.equal(await page.locator('iframe').count(),0);
await page.locator('.station-link').click();await page.getByText('Eerste trein richting Rotterdam (via Gouda)',{exact:true}).waitFor();assert.match(page.url(),/#mijn-stations\//);
await page.getByRole('link',{name:'← Mijn stations'}).click();await page.getByRole('button',{name:'+ Station',exact:true}).click();await page.locator('#search').fill('Amers');await page.getByRole('button',{name:'Amersfoort Centraal NL'}).click();await page.locator('#style').selectOption('db');await page.getByRole('button',{name:'Bewaar station',exact:true}).click();await page.getByRole('heading',{name:'Amersfoort Centraal',exact:true}).waitFor();
await page.reload();await page.getByRole('heading',{name:'Amersfoort Centraal',exact:true}).waitFor();assert.equal(errors.length,0,errors.join('\n'));console.log('PASS native stations: default filters, detail route, search, style, saved preferences, no iframe, no browser errors');
}finally{await browser.close();}
