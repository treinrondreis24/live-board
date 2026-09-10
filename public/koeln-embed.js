const stationPageId=location.pathname.match(/^\/embed\/([a-z0-9-]+)\/?$/)?.[1]||"koeln";
document.title="Vertrektijden";
document.querySelector(".board-head h2").textContent="Vertrektijden";
let data=null,activeTab="fernverkehr";
const expandedDirections=new Set();
const quickEl=document.getElementById("quick");
const fullEl=document.getElementById("full-board");
const fullRowsEl=document.getElementById("full-rows");
const toggleFull=document.getElementById("toggle-full");
const scanStatus=document.getElementById("scan-status");

function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
function statusClass(t){
  if(t.partialCancellation)return Number(t.delay||0)>30?"major-delay":"delay";
  if(t.cancelled||t.type==="cancel")return "cancel";
  if(Number(t.delay||0)>30||t.type==="major-delay")return "major-delay";
  if(Number(t.delay||0)>0||t.type==="delay")return "delay";
  return "";
}
function statusText(t){
  if(["ENTUR","OJP","NDOV_IFF","NDOV"].includes(t.source)&&!t.hasRealtime&&!t.cancelled)return "";
  if(t.source==="NMBS"&&!t.hasRealtime&&!t.cancelled)return "";
  if(t.partialCancellation)return t.status||"Deels geannuleerd";
  if(t.cancelled)return "Geannuleerd";
  if(Number(t.delay||0)>0)return `+${Number(t.delay)} min`;
  if(Number(t.delay||0)<0)return `${Number(t.delay)} min`;
  return "Op tijd";
}
function compactRow(t){
  return `<div class="direction-main">
    <div class="where-line"></div>
    <div class="time">${esc(t.plannedTime||t.time||"--:--")}</div>
    <div class="train">${esc(t.train||"—")}</div>
    <div class="destination">${esc(t.to||"—")}</div>
    <div class="track">${t.transportMode==='water'?'steiger':'spoor'} <strong>${esc(t.track||"—")}</strong></div>
    <div class="status ${statusClass(t)}">${esc(statusText(t))}</div>
  </div>`;
}
function renderQuick(){
  quickEl.innerHTML="";
  for(const group of data?.quick||[]){
    const section=document.createElement("section");
    section.className="direction";

    if(!group.trains?.length){
      section.innerHTML=`<div class="direction-main">
        <div class="where-line"><span class="where">${esc(group.label)}</span></div>
        <div class="empty" style="grid-column:2/-1">Geen vertrek gevonden</div>
      </div>`;
      quickEl.appendChild(section);continue;
    }

    const [first,...rest]=group.trains;
    const groupKey=group.id||group.label,expanded=expandedDirections.has(groupKey);
    section.innerHTML=`<div class="direction-main">
      <div class="where-line">
        <span class="where">${esc(group.label)}</span>
        ${rest.length?`<button class="more" type="button" aria-expanded="${expanded}">${expanded?"toon minder":"toon meer"}</button>`:""}
      </div>
      <div class="time">${esc(first.plannedTime||first.time||"--:--")}</div>
      <div class="train">${esc(first.train||"—")}</div>
      <div class="destination">${esc(first.to||"—")}</div>
      <div class="track">${first.transportMode==='water'?'steiger':'spoor'} <strong>${esc(first.track||"—")}</strong></div>
      <div class="status ${statusClass(first)}">${esc(statusText(first))}</div>
    </div>
    ${rest.map(t=>`<div class="extra" ${expanded?"":"hidden"}>${compactRow(t)}</div>`).join("")}`;

    const btn=section.querySelector(".more");
    if(btn)btn.addEventListener("click",()=>{
      const extras=[...section.querySelectorAll(".extra")];
      const open=extras.some(x=>x.hidden);
      if(open)expandedDirections.add(groupKey);else expandedDirections.delete(groupKey);
      extras.forEach(x=>x.hidden=!open);
      btn.setAttribute("aria-expanded",String(open));
      btn.textContent=open?"toon minder":"toon meer";
    });
    quickEl.appendChild(section);
  }
}
function renderFull(){
  const rows=data?.departures?.[activeTab]||[];
  fullRowsEl.innerHTML=rows.length?rows.map(t=>`<div class="full-row">
    <div class="time">${esc(t.plannedTime||t.time||"--:--")}</div>
    <div class="train">${esc(t.train||"—")}</div>
    <div class="destination">${esc(t.to||"—")}</div>
    <div class="track"><span class="mobile-track-label">${t.transportMode==='water'?'steiger':'spoor'} </span><strong>${esc(t.track||"—")}</strong></div>
    <div class="status ${statusClass(t)}">${esc(statusText(t))}</div>
  </div>`).join(""):'<div class="empty">Geen actuele vertrekken gevonden.</div>';
}
toggleFull.addEventListener("click",()=>{
  fullEl.hidden=!fullEl.hidden;
  toggleFull.textContent=fullEl.hidden?"Toon compleet vertrekbord":"Verberg compleet vertrekbord";
  if(!fullEl.hidden)renderFull();
});
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  activeTab=btn.dataset.tab;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  renderFull();
}));
async function refresh(){
  try{
    const r=await fetch(`/api/views/${stationPageId}`,{cache:"no-store"});
    const p=await r.json();
    if(!r.ok)throw new Error(p.error||`HTTP ${r.status}`);
    document.title=p.title||"Vertrektijden";
    document.querySelector(".board-head h2").textContent=document.title;
    if(!data){
      const allTab=document.querySelector('[data-tab="all"]');
      allTab.hidden=!(["NL","BE","NO"].includes(p.country)||p.source==="OJP");
      if((["NL","BE","NO"].includes(p.country)||p.source==="OJP"))activeTab="all";
      if(!p.quick?.length){fullEl.hidden=false;toggleFull.textContent="Verberg compleet vertrekbord";}
      document.querySelectorAll(".tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.tab===activeTab));
    }
    if(p.country==="BE"&&!document.getElementById("belgium-source")){const a=document.createElement("a");a.id="belgium-source";a.href="https://data.belgianmobility.io/";a.textContent="Bron: NMBS — Belgian Mobility Company";document.querySelector(".board-footer").appendChild(a);}
    if(p.country==="NO"&&!document.getElementById("entur-source")){const a=document.createElement("a");a.id="entur-source";a.href="https://entur.no/";a.textContent="Bron: Entur (NLOD)";document.querySelector(".board-footer").appendChild(a);}
    if(p.source==="OJP"&&!document.getElementById("swiss-source")){const a=document.createElement("a");a.id="swiss-source";a.href="https://opentransportdata.swiss/";a.textContent="Bron: opentransportdata.swiss (OJP)";document.querySelector(".board-footer").appendChild(a);}
    if(p.notice&&!document.getElementById("station-notice")){const note=document.createElement("p");note.id="station-notice";note.textContent=p.notice;document.querySelector(".board").appendChild(note);}
    data=p;renderQuick();if(!fullEl.hidden)renderFull();
    const d=p.lastScanAt?new Date(p.lastScanAt):null;
    scanStatus.textContent=d&&!Number.isNaN(d.getTime())
      ?`bijgewerkt ${new Intl.DateTimeFormat("nl-NL",{hour:"2-digit",minute:"2-digit"}).format(d)}`
      :"actueel";
    if((["BE","NO"].includes(p.country)||p.source==="OJP")&&p.status!=="ready")scanStatus.textContent=p.status==="starting"?"dienstregeling laden…":"realtime tijdelijk niet beschikbaar";
  }catch(e){
    scanStatus.textContent="tijdelijk niet beschikbaar";
    if(!data)quickEl.innerHTML=`<div class="empty">${esc(e.message)}</div>`;
  }
}
refresh();setInterval(refresh,20000);

// Measure the content, not the iframe viewport: this also allows shrinking after collapse.
let lastEmbedHeight=0,embedFrame=0;
function reportEmbedHeight(force=false){
  cancelAnimationFrame(embedFrame);
  embedFrame=requestAnimationFrame(()=>{
    const board=document.querySelector('.board'),style=getComputedStyle(document.body);
    const hoogte=Math.ceil(board.getBoundingClientRect().height+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom));
    if(window.parent!==window&&(force||hoogte!==lastEmbedHeight)){
      lastEmbedHeight=hoogte;window.parent.postMessage({type:'treinbord:hoogte',hoogte},'*');
    }
  });
}
new ResizeObserver(()=>reportEmbedHeight()).observe(document.querySelector('.board'));
window.addEventListener('resize',()=>reportEmbedHeight());
window.addEventListener('load',()=>reportEmbedHeight(true));
window.addEventListener('message',event=>{if(event.source===window.parent&&event.data?.type==='treinbord:meet')reportEmbedHeight(true);});
document.fonts?.ready.then(()=>reportEmbedHeight(true));
reportEmbedHeight(true);
