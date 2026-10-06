// This adapter deliberately exposes only GET queries. Never a mutation endpoint.
export function sanityConfig(){return {project:process.env.FLORA_SANITY_PROJECT||'il9cyh3m',dataset:process.env.FLORA_SANITY_DATASET||'production',token:process.env.FLORA_SANITY_READ_TOKEN||''};}
export async function fetchBookings({fetcher=fetch,config=sanityConfig(),trips}={}){
 if(!config.token)throw Error('Stel FLORA_SANITY_READ_TOKEN in Railway in met een aparte Sanity Viewer-token.');
 if(!/^[a-z0-9]+$/.test(config.project)||!/^[-a-z0-9]+$/.test(config.dataset))throw Error('Ongeldige Sanity-configuratie.');
 if(trips&&(!Array.isArray(trips)||!trips.length||trips.some(t=>!/^\d+$/.test(String(t)))))throw Error('Ongeldige boekingsselectie.');
 const all=[];let after='';
 for(let page=0;page<1000;page++){
  let query='*[_type == "tourBooking" && _id > $after] | order(_id asc)[0...100]{_id,_updatedAt,index,status,dateDeparture,dateReturn,firstName,lastName,"floraPaymentLinkCreated":count(payments[defined(checkoutUrl)]) > 0,passengers[]{firstName,lastName},todos[]{_key,title,description,done,status,tag,quantity,startDate,endDate,supplierBookingNumber},notes,documents[]{_key,title,asset->{_id,_createdAt,originalFilename,mimeType,size}},lines[]{title,visible}}';
  if(trips)query=query.replace('_id > $after','_id > $after && index in $trips');
  const url=new URL(`https://${config.project}.api.sanity.io/v2026-10-03/data/query/${config.dataset}`);url.searchParams.set('query',query);url.searchParams.set('$after',JSON.stringify(after));url.searchParams.set('perspective','raw');if(trips)url.searchParams.set('$trips',JSON.stringify(trips.map(Number)));
  const response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Sanity lezen mislukt (${response.status}). Controleer project, dataset en Viewer-rechten.`);
  const {result}=await response.json();if(!Array.isArray(result))throw Error('Sanity gaf geen boekingenlijst.');all.push(...result);if(result.length<100)return all;const next=result.at(-1)._id;if(next<=after)throw Error('Sanity-paginering is gestopt.');after=next;
 }
 throw Error('Te veel boekingen; synchronisatie niet opgeslagen.');
}
