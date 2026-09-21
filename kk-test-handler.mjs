import {readFile} from 'node:fs/promises';
import {handleKilometerkampioen} from './kk-handler.mjs';
import {handlePasswordReset} from './password-reset.mjs';
import {kkTestConfig} from './kk-store.mjs';
import {withTestEdition,testLinks} from './kk-edition-context.mjs';
const prefixes=['/kilometerkampioen-test','/treinhuis-test','/wachtwoord-herstellen-test'];
export async function handleKKTest(req,res,url){
 const prefix=prefixes.find(p=>url.pathname===p||url.pathname.startsWith(p+'/')||p==='/wachtwoord-herstellen-test'&&url.pathname===p+'.js');
 if(!prefix)return false;
 try{
  const config=await kkTestConfig();
 if(url.pathname==='/kilometerkampioen-test/station-catalog.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({stations:config.network.stations.map(({name,code,aliases})=>({name,code,aliases}))}));return true;}
 if(url.pathname==='/kilometerkampioen-test/station-picker.css'){res.writeHead(200,{'Content-Type':'text/css','Cache-Control':'no-cache'});res.end(await readFile(new URL('./kk-station-picker.css',import.meta.url)));return true;}
 if(url.pathname==='/kilometerkampioen-test/station-picker.js'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-cache'});res.end(await readFile(new URL('./kk-station-picker.js',import.meta.url)));return true;}
 if(['/kilometerkampioen-test/help.js','/treinhuis-test/help.js','/kilometerkampioen-test/help.css'].includes(url.pathname)){const css=url.pathname.endsWith('.css');res.writeHead(200,{'Content-Type':css?'text/css':'application/javascript','Cache-Control':'no-cache'});res.end(await readFile(new URL(css?'./kk-questions.css':'./kk-questions.js',import.meta.url)));return true;}
 const canonical=new URL(url);canonical.pathname=canonical.pathname.replace(prefix,prefix.replace('-test',''));
  if(canonical.pathname.includes('/network-next')){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Deze testeditie gebruikt een vast netwerk. Bewerk het volgende-editienetwerk in het gewone beheer.'}));return true;}
  // Real credentials and test credentials must never share a reset form/action.
  if(prefix==='/wachtwoord-herstellen-test'&&req.method==='POST'){
   const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>4096)throw Error('Formulier te groot.');chunks.push(c);}
   const payload=Buffer.concat(chunks),data=JSON.parse(payload);
   if(!String(data.token||'').startsWith('participant.'))throw Error('Alleen testdeelnemers kunnen hier hun wachtwoord herstellen.');
   const {Readable}=await import('node:stream');const clone=Readable.from([payload]);Object.assign(clone,{headers:req.headers,method:req.method,url:req.url,socket:req.socket});req=clone;
  }
  const originalEnd=res.end.bind(res),originalWriteHead=res.writeHead.bind(res);
  res.writeHead=(status,...args)=>{res.statusCode=status;for(const a of args)if(a&&typeof a==='object'&&!Array.isArray(a))for(const [key,value] of Object.entries(a))res.setHeader(key,key.toLowerCase()==='location'&&value.startsWith('/')?testLinks(value):value);return res;};
  res.end=(body,...args)=>{
   const type=String(res.getHeader('Content-Type')||'');
   if(body&&/text\/|javascript|json/.test(type)){
    let text=testLinks(Buffer.isBuffer(body)?body.toString('utf8'):String(body));
    if(type.includes('javascript'))text=text.replaceAll('localStorage.getItem(',"localStorage.getItem('kk-test:'+").replaceAll('localStorage.setItem(',"localStorage.setItem('kk-test:'+").replaceAll('localStorage.removeItem(',"localStorage.removeItem('kk-test:'+");
    if(type.includes('manifest+json')){const manifest=JSON.parse(text);manifest.name='TEST · '+manifest.name;manifest.short_name='KMtrein TEST';text=JSON.stringify(manifest);}
    if(type.includes('html')&&['/kilometerkampioen-test','/treinhuis-test'].includes(prefix))text=text.replace('</head>','<link rel="stylesheet" href="/kilometerkampioen-test/help.css"><script src="/kilometerkampioen-test/help.js" defer></script></head>');
    if(type.includes('html')&&prefix==='/kilometerkampioen-test')text=text.replace('</head>','<link rel="stylesheet" href="/kilometerkampioen-test/station-picker.css"><script src="/kilometerkampioen-test/station-picker.js" defer></script></head>');
    if(type.includes('html'))text=text.replace('<title>','<title>TEST · ').replace(/<body([^>]*)>/,'<body$1><aside class="kk-test-banner" role="note">TESTEDITIE — regels 2026 · Je testgegevens tellen niet mee voor de wedstrijd. <a href="/kilometerkampioen-test/">Testapp</a> · <a href="/treinhuis-test">Testbeheer</a></aside>');
    if(type.includes('css'))text+='\n.kk-test-banner{background:#ffdf75;color:#29220d;padding:14px 20px;font:700 16px Arial,sans-serif;border-bottom:3px solid #ba8400}.kk-test-banner a{color:#29220d;text-decoration:underline}';
    res.removeHeader('Content-Length');body=text;
   }
   originalWriteHead(res.statusCode);return originalEnd(body,...args);
  };
  return await withTestEdition(config,()=>prefix==='/wachtwoord-herstellen-test'?handlePasswordReset(req,res,canonical):handleKilometerkampioen(req,res,canonical));
 }catch(e){res.writeHead(e.status||400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.message}));return true;}
}
