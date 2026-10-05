import {createHmac,createHash,timingSafeEqual,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
export const EVENT='taap.itinerary.change',WEBHOOK='/api/expedia/itinerary-events';
export function endpoint(env=process.env){const origin=env.EXPEDIA_PUBLIC_ORIGIN||'https://treinbord.up.railway.app';const url=new URL(WEBHOOK,origin);if(url.protocol!=='https:'||url.username||url.password)throw Error('Expedia vereist een HTTPS-ontvangstadres.');return url;}
const hmac=(secret,value)=>createHmac('sha256',secret).update(value).digest('base64');
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function sign(secret,raw,url,ts=String(Date.now()),nonce=randomBytes(16).toString('hex')){const bodyhash=hmac(secret,raw),port=url.port||'443',message=[ts,nonce,'POST',url.pathname+url.search,url.hostname,port==='80'?'443':port,bodyhash,''].join('\n');return {ts,nonce,bodyhash,mac:hmac(secret,message)};}
export function verify(secret,raw,url,authorization){
 if(!/^MAC\s/.test(authorization||''))return false;
 const values={},parts=authorization.slice(4).split(',');
 for(const part of parts){const match=part.trim().match(/^(ts|nonce|bodyhash|mac)=['"]([^'"]+)['"]$/);if(!match||values[match[1]])return false;values[match[1]]=match[2];}
 if(!/^\d{10,16}$/.test(values.ts||'')||!values.nonce||!values.bodyhash||!values.mac)return false;
 const expected=sign(secret,raw,url,values.ts,values.nonce);
 return equal(expected.bodyhash,values.bodyhash)&&equal(expected.mac,values.mac);
}
export function eventRecord(raw){let payload;try{payload=JSON.parse(raw);}catch{throw Error('Ongeldige JSON.');}
 if(payload?.type!==EVENT||payload.specversion!=='1.0'||typeof payload.id!=='string'||!payload.id||typeof payload.data?.itinerary_id!=='string'||!payload.data.itinerary_id)throw Error('Ongeldig Expedia-bericht.');
 const updated=payload.data.update_date_time||payload.time;if(!Number.isFinite(Date.parse(updated)))throw Error('Ongeldig tijdstip.');
 return {digest:createHash('sha256').update(raw).digest('hex'),itineraryId:payload.data.itinerary_id,eventId:payload.id,updatedAt:new Date(updated).toISOString(),receivedAt:new Date().toISOString(),raw:raw.toString()};
}
function key(env){const value=env.ADMIN_ENCRYPTION_KEY||env.BOARD_ADMIN_PASSWORD;if(!value)throw Error('Beveiligde opslag is nog niet ingesteld.');return createHash('sha256').update('expedia-taap-v1\0'+value).digest();}
export function encrypt(value,env=process.env){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv);return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');}
export function decrypt(value,env=process.env){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key(env),b.subarray(0,12));cipher.setAuthTag(b.subarray(-16));return Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString();}
export async function subscribe({env=process.env,fetcher=fetch,read,reserve,save}){
 const target=endpoint(env).href;
 if(!env.EXPEDIA_CLIENT_ID||!env.EXPEDIA_CLIENT_SECRET)throw Error('De Expedia API-gegevens ontbreken in Railway.');
 encrypt('storage-check',env);
 const api='https://analytics.ean.com/taap/v1';
 const request=async(path,options={})=>{let response;try{response=await fetcher(api+path,{...options,signal:AbortSignal.timeout(20000)});}catch{throw Error('Expedia is niet bereikbaar.');}if(!response.ok)throw Error(`Expedia antwoordt met HTTP ${response.status}.`);return response.json();};
 const token=await request('/oauth/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.EXPEDIA_CLIENT_ID+':'+env.EXPEDIA_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
 if(!token.access_token)throw Error('Expedia heeft geen toegangstoken teruggegeven.');
 const headers={Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
 const subscriptions=await request('/subscriptions',{headers});if(!Array.isArray(subscriptions))throw Error('Onverwacht antwoord van Expedia.');
 const matching=subscriptions.filter(s=>s.endpoint===target&&s.event_type===EVENT),stored=await read();
 if(matching.length){if(matching.length!==1||stored.subscriptionId!==matching[0].subscription_id||!stored.secret)throw Error('Er bestaat al een abonnement, maar de opgeslagen sleutel ontbreekt of er zijn dubbele abonnementen. Controleer dit eerst.');decrypt(stored.secret,env);return {subscriptionId:stored.subscriptionId,endpoint:target,active:true};}
 if(stored.subscriptionId)throw Error('Het eerder opgeslagen abonnement ontbreekt bij Expedia. Controleer dit eerst.');
 if(!await reserve({state:'creating',endpoint:target,startedAt:new Date().toISOString()}))throw Error('Activering is al gestart. Controleer de status voordat je opnieuw probeert.');
 const created=await request('/subscriptions',{method:'POST',headers,body:JSON.stringify({event_type:EVENT,endpoint:target,configuration:{include_pii:true}})});
 if(!created.subscription_id||!created.shared_secret)throw Error('Expedia heeft geen abonnementssleutel teruggegeven.');
 const value={state:'active',subscriptionId:created.subscription_id,endpoint:target,secret:encrypt(created.shared_secret,env),activatedAt:new Date().toISOString()};
 let last;for(let attempt=0;attempt<3;attempt++){try{await save(value);return {active:true,subscriptionId:value.subscriptionId,endpoint:target};}catch(e){last=e;}}
 throw Error('Abonnement aangemaakt, maar opslaan van de sleutel is mislukt. Controleer de opslag; activeer niet opnieuw.',{cause:last});
}
