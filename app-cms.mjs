import {readFile} from 'node:fs/promises';
import {XMLParser} from 'fast-xml-parser';
import {adminAuthenticated} from './admin-security.mjs';
import {readAppContent,writeAppContent} from './board-cache.mjs';
import {parseTrips,plain} from './tr-app-content.mjs';

const NEWS='https://www.treinreiziger.nl/category/nieuws/feed/',TRIPS='https://www.treinrondreis.nl/feed';
const hosts=['www.treinreiziger.nl','treinreiziger.nl','www.treinrondreis.nl','treinrondreis.nl'];
const types=['overview','feed','reader','embed'];
const layouts=['hero','medium','small','titles','slider','tiny','overlay','slideshow'];
const emptyLink={page:'',url:''};
const decode=s=>String(s??'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v<=0x10ffff?String.fromCodePoint(v):'';}).replace(/&(nbsp|amp|quot|apos|lt|gt);/g,(_,n)=>({nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[n]));
export function articleBlocks(html){
 const blocks=[];let kind='p',value='';
 const flush=()=>{const text=plain(decode(value.replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,'')));if(text)blocks.push({kind,text});value='';};
 const safe=String(html||'').replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 for(const part of safe.split(/(<\/?(?:p|h[1-6]|li|div)\b[^>]*>)/gi)){
  if(/^<\/?(?:p|h[1-6]|li|div)\b/i.test(part)){flush();kind=/^<h[1-3]\b/i.test(part)?'h2':/^<h[4-6]\b/i.test(part)?'h3':'p';}else value+=part;
 }flush();return blocks;
}
const feed=(title,url,extra={})=>({kind:'feed',title,more:{page:'',url:''},moreLabel:'',feed:url,layout:'medium',count:6,start:1,field:'',equals:'',complete:false,...extra});
export const defaultNavigation=()=>[['nieuws','Nieuws','▤'],['tijden','Mijn treintijden','◷'],['tickets','Tickets','▱'],['internationaal','Internationaal','◎'],['posities','Treinposities','⌖']].map(([page,title,icon])=>({page,title,icon,visible:true}));
export function defaultContent(){return {navigation:defaultNavigation(),pages:[
 {id:'nieuws',title:'Nieuws',showTitle:false,logo:'default',type:'feed',sections:[feed('',NEWS,{layout:'hero',count:30})],menu:[]},
 {id:'internationaal',title:'Ontdek Europa per trein',showTitle:true,logo:'default',type:'overview',menu:[['rondreizen','Rondreizen','◎'],['tickets','Tickets & Treinpassen','▱'],['internationaal-nieuws','Internationaal Nieuws','▤'],['bestemmingen','Bestemmingen','⌖'],['treinen','Treinen','⇄']].map(([page,title,icon])=>({title,icon,page,url:''})),sections:[feed('Rondreizen',TRIPS,{complete:true,more:{page:'rondreizen',url:''},moreLabel:'Alle rondreizen'}),feed('Internationaal nieuws',NEWS,{field:'categories',equals:'Internationaal',count:3,more:{page:'internationaal-nieuws',url:''},moreLabel:'Meer nieuws'})]},
 {id:'rondreizen',title:'Rondreizen',showTitle:true,logo:'default',type:'feed',menu:[],sections:[feed('',TRIPS,{count:100,countryFilter:true})]},
 {id:'internationaal-nieuws',title:'Internationaal nieuws',showTitle:true,logo:'default',type:'feed',menu:[],sections:[feed('',NEWS,{field:'categories',equals:'Internationaal',count:30})]},
 {id:'tickets',title:'Tickets & Treinpassen',showTitle:true,logo:'default',type:'overview',menu:[{title:'Bekijk treintickets',icon:'▱',url:'https://tickets.treinreiziger.nl/',page:''}],sections:[{kind:'content',title:'',text:'Bekijk het aanbod bij Treinreiziger. Informatie over Interrail en andere treinpassen volgt.',image:'',layout:'medium',more:emptyLink,link:emptyLink}]},
 {id:'posities',title:'Treinposities',showTitle:true,logo:'default',type:'overview',menu:[{title:'Open de treinenkaart',icon:'⌖',url:'https://treinposities.nl/',page:''}],sections:[]},
 {id:'bestemmingen',title:'Bestemmingen',showTitle:true,logo:'default',type:'feed',menu:[],sections:[feed('',TRIPS,{count:100,countryFilter:true})]},
 {id:'treinen',title:'Treinen',showTitle:true,logo:'default',type:'overview',menu:[],sections:[{kind:'content',title:'',text:'Hier vind je straks informatie over internationale treinen en nachttreinen.',image:'',layout:'medium',more:emptyLink,link:{page:'internationaal-nieuws',url:''}}]}
 ]};}
function bad(s){const e=Error(s);e.status=400;throw e;}
const text=(v,max=160)=>typeof v==='string'?v.slice(0,max):'';
export function safeHttps(value){if(!value)return '';try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)bad('Gebruik een https-link zonder inloggegevens.');return u.href;}catch{bad('Ongeldige https-link.');}}
export function feedUrl(v){const u=new URL(safeHttps(v));if(!hosts.includes(u.hostname)||u.port)bad('Gebruik een feed van Treinreiziger.nl of Treinrondreis.nl.');return u.href;}
function link(v={}){return {page:text(v.page,80),url:safeHttps(v.url)};}
export function validateContent(input){
 if(!Array.isArray(input?.pages)||input.pages.length>80)bad('Maximaal 80 pagina’s.');
 const pages=input.pages.map(p=>{
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.id)||['tijden','station'].includes(p.id))bad('Gebruik een unieke paginacode met kleine letters, cijfers en streepjes. Treintijden is gereserveerd.');
  if(!types.includes(p.type)||!['default','none','custom'].includes(p.logo))bad('Onbekend paginatype of logo.');
  if(!Array.isArray(p.sections)||p.sections.length>30||!Array.isArray(p.menu)||p.menu.length>30)bad('Maximaal 30 onderdelen of menulinks per pagina.');
  const sections=p.sections.map(s=>{
   if(!['feed','content'].includes(s.kind)||!layouts.includes(s.layout))bad('Onbekende weergave.');
   const out={kind:s.kind,title:text(s.title),more:link(s.more),moreLabel:text(s.moreLabel),layout:s.layout,showIntro:s.showIntro??!['small','titles','tiny'].includes(s.layout),showDate:s.showDate!==false};
   if(s.kind==='feed'){
    const count=Number(s.count),start=Number(s.start);if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(start)||start<1||start>1000)bad('Aantal moet 1–100 zijn; beginbericht 1–1000.');
    return {...out,feed:feedUrl(s.feed),count,start,field:text(s.field,80),equals:text(s.equals),complete:!!s.complete,countryFilter:!!s.countryFilter,reader:text(s.reader,80)};
   }
   return {...out,headline:text(s.headline),text:text(s.text,10000),image:safeHttps(s.image),link:link(s.link)};
  });
  // Legacy feed pages now share the overview model and allow repeated feeds.
  return {id:p.id,title:text(p.title),showTitle:p.showTitle!==false,logo:p.logo,logoUrl:safeHttps(p.logoUrl),type:p.type==='feed'?'overview':p.type,embed:p.type==='embed'?safeHttps(p.embed):'',sections,menu:p.menu.map(m=>({...link(m),title:text(m.title),icon:text(m.icon,8)}))};
 });
 if(new Set(pages.map(p=>p.id)).size!==pages.length)bad('Paginacodes moeten uniek zijn.');
 const ids=new Set([...pages.map(p=>p.id),'tijden']);
 for(const p of pages){for(const l of [...p.menu,...p.sections.flatMap(s=>[s.more,s.link||emptyLink])])if(l.page&&!ids.has(l.page))bad('Verwijzing naar ontbrekende pagina: '+l.page);for(const s of p.sections)if(s.reader&&!pages.some(p=>p.id===s.reader&&p.type==='reader'))bad('Selecteer een bestaande artikelreader.');}
 const raw=input.navigation??defaultNavigation().filter(n=>ids.has(n.page));
 if(!Array.isArray(raw)||raw.length>30)bad('Maximaal 30 menu-items.');
 const navigation=raw.map(n=>({page:text(n.page,80),title:text(n.title,32),icon:text(n.icon,8),visible:n.visible!==false}));
 if(navigation.some(n=>!ids.has(n.page)||!n.title.trim()))bad('Kies een bestaande pagina en vul een menunaam in.');
 const visible=navigation.filter(n=>n.visible);if(visible.length<1||visible.length>6)bad('Toon minimaal 1 en maximaal 6 items in de onderste menubalk.');
 if(new Set(visible.map(n=>n.page)).size!==visible.length)bad('Toon elke pagina hoogstens één keer in het hoofdmenu.');
 return {pages,navigation};
}
const cache=new Map(),pending=new Map(),retryAfter=new Map();
export async function getCmsFeed(raw){
 const url=feedUrl(raw),saved=cache.get(url);if(saved&&Date.now()-saved.at<300000)return saved;
 const refresh=()=>{if(!pending.has(url))pending.set(url,loadCmsFeed(url,saved).finally(()=>pending.delete(url)));return pending.get(url);};
 if(saved&&Date.now()-saved.at<86400000){if(Date.now()>=(retryAfter.get(url)||0))void refresh().catch(()=>{});return {...saved,stale:true};}
 return refresh();
}
async function loadCmsFeed(url,saved){
 if(cache.size>100){const key=cache.keys().next().value;cache.delete(key);retryAfter.delete(key);}
 try{
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Feed tijdelijk niet bereikbaar.');
  let xml='',length=0;const decoder=new TextDecoder();for await(const bytes of r.body){length+=bytes.length;if(length>2e6)throw Error('Feed te groot.');xml+=decoder.decode(bytes,{stream:true});}xml+=decoder.decode();
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Ongeldige feed.');
  let items;
  if(xml.includes('<productFeed'))items=parseTrips(xml);
  else {const parsed=new XMLParser({ignoreAttributes:false}).parse(xml);const entries=parsed.rss?.channel?.item;if(!entries)throw Error('Gebruik een RSS-feed.');items=(Array.isArray(entries)?entries:[entries]).slice(0,200).map(i=>{
   const url=safeHttps(typeof i.link==='string'?i.link:'');let image='';try{image=safeHttps(typeof i.image==='string'?i.image:i.enclosure?.['@_url']||'');}catch{}
   const categories=(Array.isArray(i.category)?i.category:[i.category]).filter(v=>typeof v==='string');
   const article=String(i['content:encoded']||i.description||'').replace(/<\/(p|h[1-6]|li)>/gi,'\n\n').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').trim();
   return {id:url,url,title:plain(decode(i.title)),summary:plain(decode(i.description)).replace(/lees meer\s*\.\.\.\s*$/i,''),body:decode(article),blocks:articleBlocks(i['content:encoded']||i.description),image,date:plain(i.pubDate),categories:categories.map(decode)};
  }).filter(i=>i.url&&hosts.includes(new URL(i.url).hostname));}
  const value={at:Date.now(),items};cache.set(url,value);retryAfter.delete(url);return value;
 }catch(e){retryAfter.set(url,Date.now()+30000);if(saved&&Date.now()-saved.at<86400000)return {...saved,stale:true};throw e;}
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function input(req){let size=0,parts=[];for await(const b of req){size+=b.length;if(size>500000)bad('Inhoud te groot.');parts.push(b);}return JSON.parse(Buffer.concat(parts).toString());}
export async function handleAppCms(req,res,url){
 const p=url.pathname;
 if(!p.startsWith('/api/app-content/')&&!p.startsWith('/seinhuis/paginas')&&!['/app/cms-render.js','/app/cms.css'].includes(p))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
 try{
  const publicAssets={'/app/cms-render.js':'app-cms-render.js','/app/cms.css':'app-cms.css'};
  if(publicAssets[p]){res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/css'});res.end(await readFile(new URL(publicAssets[p],import.meta.url)));return true;}
  const record=await readAppContent(),value=record.value||{draft:defaultContent(),published:null};
  if(req.method==='GET'&&p==='/api/app-content/public'){json(res,200,value.published||{pages:[]});return true;}
  const authenticated=await adminAuthenticated(req);
  if(p==='/api/app-content/feed'&&req.method==='GET'){
   const feed=url.searchParams.get('url'),config=authenticated&&url.searchParams.get('preview')==='1'?value.draft:value.published;
   if(!config?.pages.some(p=>p.sections.some(s=>s.kind==='feed'&&s.feed===feed))){json(res,403,{error:'Feed is niet gepubliceerd.'});return true;}
   json(res,200,await getCmsFeed(feed));return true;
  }
  if(!authenticated){if(p==='/seinhuis/paginas'){res.writeHead(302,{Location:'/seinhuis'});res.end();}else json(res,401,{error:'Log opnieuw in via /seinhuis.'});return true;}
  if(p==='/seinhuis/paginas'||p==='/seinhuis/paginas.js'){
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
   res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});res.end(await readFile(new URL(p.endsWith('.js')?'app-cms-admin.js':'app-cms-admin.html',import.meta.url)));return true;
  }
  if(req.method==='GET'&&p==='/api/app-content/draft'){json(res,200,{revision:record.revision,...value});return true;}
  if(req.method==='POST'&&['/api/app-content/save','/api/app-content/publish'].includes(p)){
   if(req.headers.origin!=='https://'+req.headers.host){json(res,403,{error:'Open het beheer op de eigen website.'});return true;}
   const body=await input(req);if(body.revision!==record.revision){json(res,409,{error:'De inhoud is elders gewijzigd. Herlaad eerst.'});return true;}
   const draft=validateContent(body.draft);const next={...value,draft};if(p.endsWith('/publish')){next.previous=value.published;next.published=draft;next.publishedAt=Date.now();}
   const revision=await writeAppContent(next,record.revision);json(res,200,{revision,...next});return true;
  }
  json(res,404,{error:'Niet gevonden.'});
 }catch(e){json(res,e.status||400,{error:e.message});}return true;
}
