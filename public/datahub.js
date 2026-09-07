function fmt(ms){
  if(!ms)return "—";
  return new Intl.DateTimeFormat("nl-NL",{dateStyle:"short",timeStyle:"short"}).format(new Date(Number(ms)));
}
function stat(label,value){return `<div class="stat"><span>${label}</span><b>${value ?? "—"}</b></div>`;}
async function refresh(){
  try{
    const [sr,rr]=await Promise.all([fetch("/api/v1/stats",{cache:"no-store"}),fetch("/api/v1/sources",{cache:"no-store"})]);
    const stats=await sr.json(),sourcesPayload=await rr.json();
    if(!sr.ok)throw new Error(stats.error||`HTTP ${sr.status}`);
    if(!rr.ok)throw new Error(sourcesPayload.error||`HTTP ${rr.status}`);
    document.getElementById("stats").innerHTML=[
      stat("Ritten",stats.serviceRuns),
      stat("Waarnemingen",stats.eventObservations),
      stat("Ingest batches",stats.ingestBatches),
      stat("Migratie",`${stats.migration?.status||"—"} · ${stats.migration?.migratedRows||0}`)
    ].join("");
    document.getElementById("sources").innerHTML=(sourcesPayload.sources||[]).map(s=>`
      <article class="source">
        <div class="source-head">
          <strong>${s.name}</strong>
          <span class="badge ${s.connected?"live":""}">${s.connected?"data ontvangen":s.adapter_status}</span>
        </div>
        <div class="meta">
          ${s.source_id} · ${s.kind} · ${Array.isArray(s.countries)?s.countries.join(", "):""}<br>
          Laatste data: ${fmt(s.last_seen_at)} · planning/realtime/spoor: ${s.planning_priority}/${s.realtime_priority}/${s.platform_priority}
        </div>
      </article>
    `).join("");
    document.getElementById("error").hidden=true;
  }catch(e){
    const el=document.getElementById("error");el.hidden=false;el.textContent=e.message;
  }
}
refresh();setInterval(refresh,30000);
