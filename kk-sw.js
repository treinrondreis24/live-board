// Network-only: no accounts, proof, media or API responses are cached.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode!=='navigate'||event.request.method!=='GET')return;
 event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Geen verbinding</title><h1>Even geen internetverbinding</h1><p>Voor Kilometer Kampioen heb je internet nodig. Controleer je verbinding en open de app opnieuw. Een inzending is pas ontvangen als je de ontvangstbevestiging hebt gezien.</p><a href="/kilometerkampioen/">Opnieuw proberen</a></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
