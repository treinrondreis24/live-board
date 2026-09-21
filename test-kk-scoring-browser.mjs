import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const source=readFileSync('kk-navigation.js','utf8');
const render=source.slice(source.indexOf('async function loadJourney()'),source.indexOf(" let previousPage="));
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<main id="journey"></main>');
 await page.evaluate(async code=>{
  const journey=document.getElementById('journey'),observers=new Set();let journeyVersion=0;
  const make=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
  const api=async path=>path==='journey'?{summary:{validKm:83.1,travelledKm:110.8,excludedKm:27.7,pending:2,elapsedMinutes:null,checkpointMissing:true},routes:[]}:{submissions:[]};
  eval(code+';window.testLoadJourney=loadJourney;');await window.testLoadJourney();
 },render);
 assert.equal(await page.locator('.km-value').innerText(),'83,1 km');
 assert.equal(await page.locator('details').getAttribute('open'),null);
 await page.getByText('Opbouw kilometers',{exact:true}).click();
 assert.equal(await page.getByText(/27.7 km telt niet mee/).isVisible(),true);
 assert.equal(await page.getByText(/Nog geen bewijs van meldpunt/).isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'2 trajecten nog controleren'}).isVisible(),true);
 console.log('PASS score display: valid km prominent, exclusions collapsed, pending distinct, missing checkpoint visible in detail');
}finally{await browser.close();}
