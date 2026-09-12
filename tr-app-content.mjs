import {XMLParser} from 'fast-xml-parser';

export const plain = value => String(value ?? '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export function contentUrl(value, hosts) {
 try { const u = new URL(String(value)); return u.protocol === 'https:' && !u.username && !u.password && hosts.includes(u.hostname) ? u.href : null; } catch { return null; }
}
export function parseTrips(xml) {
 if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Ongeldige reizenfeed');
 const products = new XMLParser().parse(xml)?.productFeed?.product;
 if (!products) throw Error('Reizenfeed niet beschikbaar');
 return (Array.isArray(products) ? products : [products]).slice(0,1000).map(p => {
  const price = Number(p.price);
  return {id:plain(p.ID), title:plain(p.name), summary:plain(p.description),
   url:contentUrl(p.productURL,['www.treinrondreis.nl','treinrondreis.nl']),
   image:contentUrl(p.imageURL,['cdn.sanity.io','www.treinrondreis.nl']),
   price:Number.isFinite(price) && price > 0 ? price : null, priceType:plain(p.priceType),
   duration:plain(p.duration), durationType:plain(p.durationType),
   country:/^[a-z]{2}$/i.test(String(p.isoCodeArrival)) ? String(p.isoCodeArrival).toUpperCase() : ''};
 }).filter(p => p.title && p.url);
}
let saved, pending;
export async function getTrips() {
 if (saved && Date.now()-saved.at < 15*60000) return saved;
 if (!pending) pending = (async()=>{
  try {
   const r=await fetch('https://www.treinrondreis.nl/feed',{signal:AbortSignal.timeout(15000)});
   if(!r.ok) throw Error('Rondreizen tijdelijk niet bereikbaar');
   const xml=await r.text(); if(xml.length>2e6) throw Error('Reizenfeed te groot');
   return saved={at:Date.now(),items:parseTrips(xml)};
  } catch(e) { if(saved) return {...saved,stale:true}; throw e; }
 })().finally(()=>pending=null);
 return pending;
}
