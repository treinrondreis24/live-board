export function boardRows(rows=[],now=Date.now()){
 const groups=new Map();
 for(const row of rows){
  if(row.eligible!==true||!row.incoming||!row.outgoing||['not-planned','not-applicable'].includes(row.status))continue;
  if(Number.isFinite(row.incoming.planned)&&now>row.incoming.planned+150*60000)continue;
  const key=[row.date||'',row.ruleId||row.key||`${row.incoming.number}|${row.outgoing.number}`].join('|');
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 return [...groups.values()].map(group=>{
  const main=group.find(row=>!row.fallbackFor&&!row.alternativeFor);
  const alternative=group.find(row=>row.fallbackFor)||group.find(row=>row.alternativeFor);
  return alternative&&(!main||main.status==='missed')?alternative:main||group[0];
 }).sort((a,b)=>(a.incoming.planned||0)-(b.incoming.planned||0)||String(a.ruleId||'').localeCompare(String(b.ruleId||'')));
}
export function shortCity(value=''){
 const name=String(value).trim();
 const aliases={'Frankfurt(Main)Hbf':'Frankfurt Hbf','Frankfurt(main) Hnf':'Frankfurt Hbf','Frankfurt(M) Flughafen Fernbf':'Frankfurt Flughafen','Milano Centrale':'Milano C','Amsterdam Centraal':'Amsterdam C','Berlin Hbf (tief)':'Berlin Hbf'};
 if(aliases[name])return aliases[name];
 return name.replace(/Centraal\b/g,'C').replace(/Centrale\b/g,'C').replace(/\b(Hbf|HB|SBB)\b.*$/,'$1').replace(/^Venezia\b.*$/,'Venezia');
}
export function statusView(row,stale=false){
 if(row.incoming?.cancelled||row.outgoing?.cancelled)return {kind:'missed',symbol:'×',label:'Geannuleerd',detail:'Aansluiting niet mogelijk'};
 if(stale||row.status==='unknown')return {kind:'unknown',symbol:'?',label:'Onbekend',detail:stale?'Metingen verouderd':'Geen actuele meting'};
 const min=Number.isFinite(row.minutes)?Math.round(row.minutes):null;
 return {kind:row.status,symbol:row.status==='feasible'?'✓':row.status==='missed'?'×':'?',label:min===null?'Onbekend':`${min} min`,detail:row.status==='feasible'?(row.evidence==='planning-assumption'?'Kennelijk haalbaar':'Haalbaar'):row.status==='missed'?'Niet haalbaar':'Onzeker'};
}

export function destinationCity(value=''){return shortCity(value).replace(/\s*\(main\)/ig,'').replace(/[-\s]+(?:Keleti|Altona|Ost|Hbf|Hnf|HB|SBB|C|Centraal|Centrale|Central|Flughafen)\b.*$/i,'').trim();}

export function eventDelay(e){return e&&e.planned&&(e.actual||e.expected)?Math.round(((e.actual||e.expected)-e.planned)/60000):0;}
export function planningMark(e){if(e?.cancelled)return '<span class="late" title="Geannuleerd">×</span>';const delay=eventDelay(e);if(delay)return '<span class="'+(delay>=5?'late':'')+'">'+(delay>0?'+':'')+delay+'</span>';if(e?.realtime||e?.actual)return '<span class="on-time" title="Op tijd">✓</span>';return '<svg class="planning-clock" viewBox="0 0 32 32" role="img" aria-label="Gepland"><circle cx="16" cy="16" r="12"/><path d="M16 7v9h8"/></svg>';}
