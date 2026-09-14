import {boardRows,shortCity,destinationCity,statusView} from './connections-view.js';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'}),dateFormat=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Berlin',weekday:'short',day:'numeric',month:'short',year:'numeric'});
const singleScreen=new URLSearchParams(location.search).get('screen')==='1';
if(singleScreen)document.getElementById('archive-link').hidden=true;
let data=null,page=0,lastSuccess=0,failed=false;
const time=ts=>ts?clock.format(new Date(ts)):'—';
function journey(e,mode){const t=e.actual||e.expected||e.planned;return `<div class="journey"><div class="journey-line"><time>${time(t)}</time><span class="city" title="${esc(mode==='arrival'?e.origin:e.destination)}">${esc(destinationCity(mode==='arrival'?e.origin:e.destination)||'—')}</span></div><small>${t!==e.planned?`<del>${time(e.planned)}</del>`:''}${e.cancelled?'<span>Geannuleerd</span>':''}</small></div>`;}
function render(){
 const all=boardRows(data?.connections),total=singleScreen?1:Math.max(1,Math.ceil(all.length/7));page%=total;
 const stale=Date.now()-lastSuccess>120000||!data?.monitor?.lastRun||Date.now()-data.monitor.lastRun>180000;
 $('rows').innerHTML=all.slice(page*7,page*7+7).map(r=>{const s=statusView(r,stale);return `<div class="entry row" role="row"><div class="station" role="cell">${esc(shortCity(r.incoming.stationName||r.station))}<small>${esc(r.incoming.number)} - ${esc(r.outgoing.number)}</small>${r.fallbackFor?'<small>Alternatief voor Köln</small>':''}</div>${journey(r.incoming,'arrival')}<div class="track">${esc(r.incoming.currentTrack||'—')}</div>${journey(r.outgoing,'departure')}<div class="track">${esc(r.outgoing.currentTrack||'—')}</div><div class="status ${s.kind}"><div class="status-inner"><span class="badge" aria-hidden="true"><span>${s.symbol}</span></span><strong>${esc(s.label)}</strong></div><small>${esc(s.detail)}</small></div></div>`;}).join('');
 $('empty').hidden=all.length>0;$('empty').textContent=failed&&!data?'Aansluitingen kunnen niet worden geladen. We proberen het opnieuw.':'Nog geen planmatig mogelijke aansluitingen beschikbaar voor vandaag.';
 $('pages').textContent=!singleScreen&&all.length?`${page+1} / ${total}`:'';
 const sources=[...new Set(all.flatMap(r=>[r.incoming.source,r.outgoing.source]).map(s=>s==='DB_PLAN'?'DB dienstregeling':s==='DB'?'DB Timetables':s).filter(Boolean))];
 $('source').textContent=`Bronnen: ${sources.join(' · ')||'DB Timetables · ViaggiaTreno'}${data?.monitor?.lastRun?' · Laatste beoordeling '+time(data.monitor.lastRun):''} · Inschatting op basis van treinmetingen`;
 $('connection-state').textContent=failed?'Verbinding onderbroken · automatisch opnieuw proberen':stale&&data?'Metingen verouderd':'';
}
function loadConnections(){return new Promise((resolve,reject)=>{const request=new XMLHttpRequest();request.open('GET','/api/connections');request.timeout=15000;request.onload=()=>{try{if(request.status<200||request.status>=300)throw Error('HTTP '+request.status);resolve(JSON.parse(request.responseText));}catch(error){reject(error);}};request.onerror=()=>reject(Error('Verbindingsfout'));request.ontimeout=()=>reject(Error('Wachttijd verstreken'));request.send();});}
async function refresh(){try{data=await loadConnections();lastSuccess=Date.now();failed=false;}catch{failed=true;}render();}
function tick(){const now=new Date();$('clock').textContent=clock.format(now);$('date').textContent=dateFormat.format(now);}
$('fullscreen').onclick=()=>{const action=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();action?.catch(()=>{});};
tick();refresh();setInterval(tick,1000);setInterval(refresh,30000);setInterval(()=>{page++;render();},15000);
