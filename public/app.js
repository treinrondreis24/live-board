
const CONFIG = {
  dbRowsPerPage: 8,
  apiRefreshMs: 20000,

  // Weergavetijden
  dbMinScreenMs: 10000,
  dbTargetMsPerPage: 10000,
  italyScreenMs: 10000
};

let dbTrains = [];
let italyTrains = [];
let dbPage = 0;
let activeIndex = 0;

let screenTimer = null;
let dbPageTimer = null;

const screens = [
  document.getElementById("db-screen"),
  document.getElementById("italy-milano-split")
];

const dbRowsEl = document.getElementById("db-rows");
const dbPageIndicatorEl = document.getElementById("db-page-indicator");
const dbDataStatusEl = document.getElementById("db-data-status");
const dbDotEl = document.getElementById("db-dot");

const italyMilanoDepRows = document.getElementById("italy-milano-dep-rows");
const italyMilanoArrRows = document.getElementById("italy-milano-arr-rows");
const italyRomaDepRows = document.getElementById("italy-roma-dep-rows");

const italyDots = [
  document.getElementById("italy-dot-1"),
  document.getElementById("italy-dot-2")
];

const italyStatuses = [
  document.getElementById("italy-status-1"),
  document.getElementById("italy-status-2")
];

const errorPanelEl = document.getElementById("error-panel");
const errorTextEl = document.getElementById("error-text");

function escapeHtml(v){
  return String(v ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderClock(){
  const now = new Date();

  const clock = new Intl.DateTimeFormat("nl-NL",{
    hour:"2-digit",
    minute:"2-digit",
    hour12:false
  }).format(now);

  const date = new Intl.DateTimeFormat("nl-NL",{
    weekday:"short",
    day:"numeric",
    month:"short"
  }).format(now);

  document.querySelectorAll(".shared-clock").forEach(el=>el.textContent=clock);
  document.querySelectorAll(".shared-date").forEach(el=>el.textContent=date);
}

function trendHtml(t){
  if(t.trend30 === "up") return ' <span class="trend-arrow">↑</span>';
  if(t.trend30 === "down") return ' <span class="trend-arrow">↓</span>';
  return "";
}

function dbEventMarker(t){
  if(t.eventMode === "arrival") return "ᵃ";
  if(t.eventMode === "departure") return "ᵛ";
  return "";
}

function dbTimeHtml(t){
  const planned = escapeHtml(t.plannedTime || t.time || "--:--");
  const current = escapeHtml(t.currentTime || t.time || planned);
  const marker = dbEventMarker(t);

  if(t.hasChangedTime && current !== planned){
    return `
      <span class="db-time-planned changed">${planned}</span>
      <span class="db-time-current">${current}</span>
      <span class="db-event-marker">${marker}</span>
    `;
  }

  return `
    <span class="db-time-current">${planned}</span>
    <span class="db-event-marker">${marker}</span>
  `;
}

function shortStation(value,italian=false){
  let name=String(value||'').replace(/\bCentraal\b/gi,'C').replace(/(\bHbf\b).*$/i,'$1').replace(/(\bVenezia\b).*$/i,'$1');
  if(italian)name=name.replace(/\bCentrale\b/gi,'').replace(/\s+/g,' ');
  return name.trim();
}
function screenStatus(t){
  if(t.cancelled||t.type==='cancel')return '<span title="Geannuleerd">×</span>';
  if(t.type==='partial')return '<span title="Gedeeltelijk geannuleerd">⚠</span>';
  const delay=Math.round(Number(t.delay)||0);
  if(delay)return (delay>0?'+':'')+delay;
  return t.hasRealtime?'<span class="on-time" title="Op tijd" aria-label="Op tijd">✓</span>':'<span class="planned-only" title="Gepland; geen actuele bevestiging" aria-label="Gepland">◷</span>';
}
function dbPageItems(){
  const cancelled=dbTrains.filter(t=>t.cancelled||t.type==='cancel');
  const delayed=dbTrains.filter(t=>!cancelled.includes(t)&&Number(t.delay)>=20).sort((a,b)=>Number(b.delay)-Number(a.delay)).slice(0,4);
  const pinned=[...cancelled,...delayed];
  const rotating=dbTrains.filter(t=>!pinned.includes(t));
  const size=Math.max(CONFIG.dbRowsPerPage,pinned.length+(rotating.length?1:0));
  const slots=Math.max(1,size-pinned.length),pages=Math.max(1,Math.ceil(rotating.length/slots));
  return {pinned,rotating,size,slots,pages};
}
function dbPageCount(){
  return dbPageItems().pages;
}

function dbScreenDuration(){
  const pages = dbPageCount();

  // Iedere pagina blijft tien seconden zichtbaar.
  return Math.max(
    CONFIG.dbMinScreenMs,
    pages * CONFIG.dbTargetMsPerPage
  );
}

function renderDb(){
  const pages = dbPageCount();
  if(dbPage >= pages) dbPage = 0;

  const group=dbPageItems(),start=dbPage*group.slots;
  const items=[...group.pinned,...group.rotating.slice(start,start+group.slots)];
  document.documentElement.style.setProperty('--db-row-count',group.size);

  if(!items.length){
    dbRowsEl.innerHTML = `
      <div class="db-train-row">
        <div class="db-cell db-time">--:--</div>
        <div class="db-cell db-train">—</div>
        <div class="db-cell db-from">Geen data</div>
        <div class="db-cell db-to">DB Timetables</div>
        <div class="db-cell db-status">Wachten…</div>
      </div>`;
  }else{
    dbRowsEl.innerHTML = items.map(t=>`
      <div class="db-train-row ${t.type === "cancel" ? "db-cancelled-row" : ""}">
        <div class="db-cell db-time-cell"><div class="db-time">${dbTimeHtml(t)}</div><div class="db-scanpoint">${escapeHtml(shortStation(t.observedAt))}</div></div>
        <div class="db-cell db-train">${escapeHtml(t.train)}</div>
        <div class="db-cell db-from">${escapeHtml(shortStation(t.from))}</div>
        <div class="db-cell db-to">${escapeHtml(shortStation(t.to))}</div>
        <div class="db-cell db-status ${escapeHtml(t.type)}">
          ${screenStatus(t)}${trendHtml(t)}
        </div>
      </div>
    `).join("");
  }

  dbPageIndicatorEl.textContent = `${Math.min(dbPage+1,pages)} / ${pages}`;
}

function italyFullRowHtml(t){
  return `
    <div class="italy-train-row ${t.type === "cancel" ? "italy-cancelled-row" : ""}">
      <div class="italy-cell italy-time">${escapeHtml(t.time)}</div>
      <div class="italy-cell italy-train">${escapeHtml(t.number||t.train)}</div>
      <div class="italy-cell">${escapeHtml(shortStation(t.from))}</div>
      <div class="italy-cell">${escapeHtml(shortStation(t.to))}</div>
      <div class="italy-cell italy-track">${escapeHtml(t.track || "—")}</div>
      <div class="italy-cell italy-status ${escapeHtml(t.type)}">
        ${screenStatus(t)}${trendHtml(t)}
      </div>
    </div>`;
}

function italySplitRowHtml(t, kind){
  const mainPlace = kind === "departure" ? t.to : t.from;
  return `
    <div class="italy-train-row ${t.type === "cancel" ? "italy-cancelled-row" : ""}">
      <div class="italy-cell italy-time">${escapeHtml(t.time)}</div>
      <div class="italy-cell italy-train">${escapeHtml(t.number||t.train)}</div>
      <div class="italy-cell">${escapeHtml(shortStation(mainPlace,true))}</div>
      <div class="italy-cell italy-track">${escapeHtml(t.track || "—")}</div>
      <div class="italy-cell italy-status ${escapeHtml(t.type)}">
        ${screenStatus(t)}${trendHtml(t)}
      </div>
    </div>`;
}

function renderItalyGroup(container, items, kind = "full"){
  if(!items.length){
    const label = kind === "departure" ? "NESSUNA PARTENZA" :
                  kind === "arrival" ? "NESSUN ARRIVO" : "NESSUN DATO";

    if(kind === "full"){
      container.innerHTML = `
        <div class="italy-train-row">
          <div class="italy-cell italy-time">--:--</div>
          <div class="italy-cell italy-train">—</div>
          <div class="italy-cell">NESSUN DATO</div>
          <div class="italy-cell">VIAGGIATRENO</div>
          <div class="italy-cell italy-track">—</div>
          <div class="italy-cell italy-status">ATTESA…</div>
        </div>`;
    } else {
      container.innerHTML = `
        <div class="italy-train-row">
          <div class="italy-cell italy-time">--:--</div>
          <div class="italy-cell italy-train">—</div>
          <div class="italy-cell">${label}</div>
          <div class="italy-cell italy-track">—</div>
          <div class="italy-cell italy-status">ATTESA…</div>
        </div>`;
    }
    return;
  }

  if(kind === "full"){
    container.innerHTML = items.map(italyFullRowHtml).join("");
  } else {
    container.innerHTML = items.map(t => italySplitRowHtml(t, kind)).join("");
  }
}

function renderItaly(){
  const milanoDep = italyTrains.filter(t =>
    t.station === "Milano Centrale" && t.mode === "departure"
  );

  const milanoArr = italyTrains.filter(t =>
    t.station === "Milano Centrale" && t.mode === "arrival"
  );

  const romaDep = italyTrains.filter(t =>
    t.station === "Roma Termini"
  );

  renderItalyGroup(italyMilanoDepRows, milanoDep, "departure");
  renderItalyGroup(italyMilanoArrRows, milanoArr, "arrival");
  renderItalyGroup(italyRomaDepRows, romaDep, "full");
}

function fmtTime(iso){
  if(!iso) return "--:--";
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return "--:--";

  return new Intl.DateTimeFormat("nl-NL",{
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit"
  }).format(d);
}

async function refreshDb(){
  try{
    const response = await fetch("/api/trains",{cache:"no-store"});
    const payload = await response.json();
    if(!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    dbTrains = payload.trains || [];
    renderDb();

    dbDotEl.className = "dot live";
    dbDataStatusEl.textContent =
      `DB Timetables · ${dbTrains.length} treinen · ${fmtTime(payload.lastScanAt || payload.updatedAt)}`;

  }catch(err){
    dbDotEl.className = "dot error";
    dbDataStatusEl.textContent = "DB Timetables niet actief";
    showError(`DB: ${err.message}`);
  }
}

async function refreshItaly(){
  try{
    const response = await fetch("/api/italy",{cache:"no-store"});
    const payload = await response.json();
    if(!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    italyTrains = payload.trains || [];
    renderItaly();

    italyDots.forEach(dot=>dot.className="italy-dot live");
    italyStatuses.forEach(el=>{
      el.textContent = `ViaggiaTreno · ${italyTrains.length} treni · ${fmtTime(payload.lastScanAt)}`;
    });

  }catch(err){
    italyDots.forEach(dot=>dot.className="italy-dot error");
    italyStatuses.forEach(el=>el.textContent="ViaggiaTreno non disponibile");
    if(activeIndex > 0) showError(`Italia: ${err.message}`);
  }
}

function showError(text){
  errorTextEl.textContent = text;
  errorPanelEl.classList.remove("hidden");
  setTimeout(()=>errorPanelEl.classList.add("hidden"),7000);
}

function clearScreenTimers(){
  if(screenTimer){
    clearTimeout(screenTimer);
    screenTimer = null;
  }
  if(dbPageTimer){
    clearTimeout(dbPageTimer);
    dbPageTimer = null;
  }
}

function scheduleDbPages(duration){
  const pages = dbPageCount();

  if(pages <= 1) return;

  // Verdeel de totale DB-weergavetijd gelijkmatig over alle pagina's.
  const perPage = duration / pages;

  function scheduleNextPage(){
    dbPageTimer = setTimeout(()=>{
      dbPage++;

      if(dbPage < pages){
        renderDb();
        scheduleNextPage();
      }
    }, perPage);
  }

  scheduleNextPage();
}

function enterScreen(index){
  clearScreenTimers();

  screens.forEach((screen,i)=>{
    screen.classList.toggle("active", i === index);
  });

  activeIndex = index;

  let duration;

  if(index === 0){
    // Bij elke nieuwe DB-ronde beginnen we op pagina 1 en tonen
    // vervolgens alle DB-pagina's in dezelfde ronde.
    dbPage = 0;
    renderDb();

    duration = dbScreenDuration();
    scheduleDbPages(duration);
  }else{
    duration = CONFIG.italyScreenMs;
  }

  screenTimer = setTimeout(()=>{
    enterScreen((activeIndex + 1) % screens.length);
  }, duration);
}

renderClock();
renderDb();
renderItaly();

refreshDb();
refreshItaly();

setInterval(renderClock,1000);
setInterval(refreshDb,CONFIG.apiRefreshMs);
setInterval(refreshItaly,CONFIG.apiRefreshMs);

// Start de schermrotatie bij DB.
enterScreen(0);
