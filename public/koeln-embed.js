const stationPageId=location.pathname.match(/^\/embed\/([a-z0-9-]+)\/?$/)?.[1]||"koeln";
document.title="Vertrektijden";
document.querySelector(".board-head h2").textContent="Vertrektijden";
let data=null,activeTab="fernverkehr";
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
    <div class="track">spoor <strong>${esc(t.track||"—")}</strong></div>
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
    section.innerHTML=`<div class="direction-main">
      <div class="where-line">
        <span class="where">${esc(group.label)}</span>
        ${rest.length?'<button class="more" type="button">toon meer</button>':""}
      </div>
      <div class="time">${esc(first.plannedTime||first.time||"--:--")}</div>
      <div class="train">${esc(first.train||"—")}</div>
      <div class="destination">${esc(first.to||"—")}</div>
      <div class="track">spoor <strong>${esc(first.track||"—")}</strong></div>
      <div class="status ${statusClass(first)}">${esc(statusText(first))}</div>
    </div>
    ${rest.map(t=>`<div class="extra" hidden>${compactRow(t)}</div>`).join("")}`;

    const btn=section.querySelector(".more");
    if(btn)btn.addEventListener("click",()=>{
      const extras=[...section.querySelectorAll(".extra")];
      const open=extras.some(x=>x.hidden);
      extras.forEach(x=>x.hidden=!open);
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
    <div class="track"><strong>${esc(t.track||"—")}</strong></div>
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
    data=p;renderQuick();if(!fullEl.hidden)renderFull();
    const d=p.lastScanAt?new Date(p.lastScanAt):null;
    scanStatus.textContent=d&&!Number.isNaN(d.getTime())
      ?`bijgewerkt ${new Intl.DateTimeFormat("nl-NL",{hour:"2-digit",minute:"2-digit"}).format(d)}`
      :"actueel";
  }catch(e){
    scanStatus.textContent="tijdelijk niet beschikbaar";
    quickEl.innerHTML=`<div class="empty">${esc(e.message)}</div>`;
  }
}
refresh();setInterval(refresh,20000);
