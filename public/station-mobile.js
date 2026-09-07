const cfg = {
  "/duesseldorf": {
    api: "/api/views/duesseldorf",
    title: "Düsseldorf Hbf → Nederland",
    sub: "Actuele vertrekken die na Düsseldorf stoppen in Amsterdam Centraal, Arnhem Centraal, Venlo of Utrecht Centraal"
  },
  "/wien": {
    api: "/api/views/wien",
    title: "Wien Hbf",
    sub: "Alle actuele Fernverkehr-vertrekken"
  },
  "/mannheim": {
    api: "/api/views/mannheim",
    title: "Mannheim Hbf",
    sub: "Alle actuele Fernverkehr-vertrekken"
  }
};

const key = location.pathname.replace(/\/$/, "") || "/";
const view = cfg[key] || cfg["/mannheim"];

document.getElementById("title").textContent = view.title;
document.getElementById("subtitle").textContent = view.sub;

async function refresh(){
  try{
    const r = await fetch(view.api,{cache:"no-store"});
    const p = await r.json();
    if(!r.ok) throw new Error(p.error || `HTTP ${r.status}`);
    renderList(document.getElementById("rows"),p.trains||[]);
    document.getElementById("updated").textContent =
      `${p.count||0} treinen · scan ${fmtUpdated(p.lastScanAt)}`;
  }catch(e){
    document.getElementById("updated").textContent = e.message;
  }
}

refresh();
setInterval(refresh,20000);
