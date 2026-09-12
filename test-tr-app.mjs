import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {parseStationCatalog,parseNews,createTreinreizigerHandler} from './tr-app-data.mjs';
import {initBoardCache} from './board-cache.mjs';
const catalog=parseStationCatalog(fs.readFileSync(new URL('../ndov-september.zip',import.meta.url)));assert(catalog.length>400);assert(catalog.some(s=>s.code==='AC'));assert(catalog.every(s=>s.country==='NL'));
const xml='<rss><channel><item><title><![CDATA[Test &#8211; &lt;b&gt;nieuws&lt;/b&gt;]]></title><link>https://www.treinreiziger.nl/test</link><description><![CDATA[<p>Hello</p>]]></description></item><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>';
assert.deepEqual(parseNews(xml).map(x=>x.title),['Test – nieuws']);assert.throws(()=>parseNews('<!DOCTYPE rss>'+xml));
const js=fs.readFileSync(new URL('./tr-app.js',import.meta.url),'utf8');const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const ctx={norm};vm.createContext(ctx);vm.runInContext(js.slice(js.indexOf('function matches('),js.indexOf('function rowsFor('))+';this.check=matches;',ctx);
assert(ctx.check({category:'IC',to:'Utrecht',route:['Gouda']},[{direction:'Utrecht',types:'IC',via:'Gouda',exclude:'Schiphol'}]));assert(!ctx.check({category:'SPR',to:'Utrecht',route:['Gouda']},[{direction:'Utrecht',types:'IC'}]));assert(ctx.check({category:'ICE',to:'Köln',route:[]},[{types:'IC'},{types:'ICE'}]));
const sqlite=new DatabaseSync(':memory:');await initBoardCache({backend:'sqlite',sqlite});const handler=createTreinreizigerHandler({stations:[{id:'test',country:'DE',name:'Test'}],getBoard:()=>({source:'test',departures:{all:[{number:'1',to:'A',plannedTimestamp:Date.now()+60000,hasRealtime:false}]}})});
const server=http.createServer(async(req,res)=>{await handler(req,res,new URL(req.url,'http://'+req.headers.host));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port;
try{let r=await fetch(root+'/app/');assert.equal(r.status,200);assert((await r.text()).includes('Mijn treintijden'));r=await fetch(root+'/app/api/board/test');assert.equal((await r.json()).departures.length,1);for(let i=0;i<2;i++){r=await fetch(root+'/app/api/added',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:'test'})});assert.equal(r.status,200);}assert.equal(sqlite.prepare('SELECT additions FROM app_station_usage').get().additions,2);r=await fetch(root+'/app/api/added',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});assert.equal(r.status,403);console.log('PASS: station catalog, news sanitization, filters, routes, aggregate counter and cross-origin rejection');}finally{server.close();sqlite.close();}
