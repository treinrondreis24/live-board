import {readFile} from 'node:fs/promises';

import {adminAuthenticated} from './admin-security.mjs';

import {readSubscription,saveSubscription,reserveSubscription,storeEvent,listEvents} from './expedia-store.mjs';

import {WEBHOOK,endpoint,verify,decrypt,eventRecord,subscribe} from './expedia-core.mjs';

import {readFlora} from './flora-store.mjs';

import {expediaControls} from './flora-expedia.mjs';

const prefix='/seinhuis/flora/expedia';

export function createExpediaHandler({authenticate=adminAuthenticated,read=readSubscription,save=saveSubscription,reserve=reserveSubscription,store=storeEvent,list=listEvents,readState=readFlora,env=process.env,fetcher=fetch}={}){

 return async(req,res,url)=>{

  if(url.pathname!==WEBHOOK&&url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;

  res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Content-Type-Options','nosniff');

  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};

  try{

   if(url.pathname===WEBHOOK){

    if(req.method!=='POST')return reply(405,{status:'error'});

    const config=await read();if(!config.secret)return reply(503,{status:'error'});

    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)return reply(413,{status:'error'});chunks.push(chunk);}const raw=Buffer.concat(chunks);

    if(url.search||!verify(decrypt(config.secret,env),raw,endpoint(env),req.headers.authorization))return reply(401,{status:'error'});

    let event;try{event=eventRecord(raw);}catch{return reply(400,{status:'error'});}

    await store(event);return reply(200,{status:'success',message:'Webhook event processed successfully'});

   }

   if(!await authenticate(req)){if(req.method==='GET'&&url.pathname===prefix){res.writeHead(303,{Location:'/seinhuis'});res.end();return true;}return reply(401,{error:'Log eerst in bij Seinhuis.'});}

   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");

   if(req.method==='GET'&&[prefix,prefix+'/'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(new URL('./expedia.html',import.meta.url)));return true;}

   if(req.method==='GET'&&url.pathname===prefix+'/expedia.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL('./expedia.js',import.meta.url)));return true;}

   if(req.method==='GET'&&url.pathname===prefix+'/checks'){const {state}=await readState(),itinerary=url.searchParams.get('itinerary')||'';return reply(200,{policy:'email-primary',checkedAt:state.expediaCheckedAt||null,controls:expediaControls(state).filter(c=>!itinerary||c.reference===itinerary)});}

   if(req.method==='GET'&&url.pathname===prefix+'/status'){const config=await read();return reply(200,{credentialsConfigured:!!(env.EXPEDIA_CLIENT_ID&&env.EXPEDIA_CLIENT_SECRET),active:config.state==='active'&&!!config.secret,subscriptionId:config.subscriptionId||null,state:config.state||'inactive',activatedAt:config.activatedAt||null,endpoint:endpoint(env).href,events:await list(url.searchParams.get('itinerary')||'')});}

   if(req.method==='POST'&&url.pathname===prefix+'/activate'){

    if(req.headers.origin!==endpoint(env).origin)return reply(403,{error:'Open het beheer op de eigen website.'});

    return reply(200,await subscribe({env,fetcher,read,reserve,save}));

   }

   return reply(404,{error:'Niet gevonden.'});

  }catch(e){return reply(url.pathname===WEBHOOK?503:400,{error:url.pathname===WEBHOOK?'Opslag tijdelijk niet beschikbaar.':e.message});}

 };

}

export const handleExpedia=createExpediaHandler();

