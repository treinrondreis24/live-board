import http from 'node:http';
import https from 'node:https';
import {Transform} from 'node:stream';
import {adminAuthenticated} from './admin-security.mjs';

export const BOOKLETS_PREFIX='/seinhuis/boekjesmaker';
const MAX_UPLOAD=50*1024*1024;
export function createBookletsGateway({authenticate=adminAuthenticated, configuration=()=>({upstream:process.env.BOOKLETS_INTERNAL_URL,secret:process.env.BOOKLETS_GATEWAY_SECRET,origin:process.env.BOOKLETS_PUBLIC_ORIGIN||'https://treinbord.up.railway.app'})}={}) {
  return async function handleBooklets(req,res,url) {
    const prefix=BOOKLETS_PREFIX;
    if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
    for(const [key,value] of Object.entries({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}))res.setHeader(key,value);
    const fail=(code,message)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:message}));return true;};
    const owner=await authenticate(req);
    if(!owner){
      // A cross-site OAuth return has no SameSite=Strict cookie. A deliberate
      // same-site click restores it; no code is processed before owner login.
      if(url.pathname===prefix+'/google/callback'&&req.method==='GET'&&!url.searchParams.has('continue')){
        const next=new URL(url);next.searchParams.set('continue','1');
        const href=(next.pathname+next.search).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"});
        res.end('<!doctype html><meta charset="utf-8"><title>Google koppelen</title><p><a href="'+href+'">Google-koppeling afronden in Seinhuis</a></p>');return true;
      }
      if(req.method==='GET'&&(url.pathname===prefix||url.pathname===prefix+'/')){res.writeHead(303,{Location:'/seinhuis'});res.end();return true;}
      return fail(401,'Log eerst in bij Seinhuis.');
    }
    if(!['GET','POST','HEAD'].includes(req.method))return fail(405,'Deze methode is niet toegestaan.');
    const config=configuration();
    if(req.method==='POST'&&(req.headers.origin!==config.origin||req.headers['x-booklets']!=='1'))return fail(403,'Ongeldige oorsprong. Open de boekjesmaker vanuit Seinhuis.');
    const length=Number(req.headers['content-length']||0);
    if(!Number.isSafeInteger(length)||length<0||length>MAX_UPLOAD)return fail(413,'Maximaal 50 MB per upload.');
    if(req.method==='POST'&&!req.headers['content-length'])return fail(411,'De uploadlengte ontbreekt.');
    if(!config.upstream||!config.secret||config.secret.length<32)return fail(503,'De online boekjesmaker wordt nog ingericht.');
    let target;
    try{target=new URL(config.upstream);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error();}catch{return fail(503,'De boekjesmaker is tijdelijk niet beschikbaar.');}
    // Never resolve user-controlled paths as URLs: //host must not become SSRF.
    target.pathname='/';target.search='';
    const upstreamPath=(url.pathname.slice(prefix.length)||'/')+url.search;
    const headers={'x-booklets-gateway':config.secret,'x-booklets':'1'};
    for(const name of ['content-type','content-length'])if(req.headers[name])headers[name]=req.headers[name];
    const upstream=(target.protocol==='https:'?https:http).request(target,{method:req.method,path:upstreamPath,headers},response=>{
      const forwarded={};
      for(const name of ['content-type','content-length','content-disposition','retry-after'])if(response.headers[name])forwarded[name]=response.headers[name];
      res.writeHead(response.statusCode,forwarded);
      response.on('error',()=>res.destroy());response.pipe(res);
    });
    upstream.setTimeout(180000,()=>upstream.destroy(new Error('timeout')));
    upstream.on('error',()=>{if(!res.headersSent)fail(502,'De boekjesmaker is tijdelijk niet bereikbaar. Probeer opnieuw.');else res.destroy();});
    req.on('aborted',()=>upstream.destroy());
    res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
    let received=0;
    const limiter=new Transform({transform(chunk,encoding,callback){received+=chunk.length;callback(received>MAX_UPLOAD?new Error('upload too large'):null,chunk);}});
    limiter.on('error',()=>{upstream.destroy();if(!res.headersSent)fail(413,'Maximaal 50 MB per upload.');});
    req.on('error',()=>upstream.destroy());req.pipe(limiter).pipe(upstream);
    return true;
  };
}
export const handleBooklets=createBookletsGateway();
