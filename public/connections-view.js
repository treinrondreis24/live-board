export function boardRows(rows=[]){return rows.filter(r=>r.eligible===true&&r.incoming&&r.outgoing&&!['not-planned','not-applicable'].includes(r.status)).sort((a,b)=>a.outgoing.planned-b.outgoing.planned||a.ruleId.localeCompare(b.ruleId));}
export function shortCity(value=''){
 const name=String(value).trim();
 const aliases={'Frankfurt(Main)Hbf':'Frankfurt Hbf','Frankfurt(M) Flughafen Fernbf':'Frankfurt Flughafen','Milano Centrale':'Milano C','Amsterdam Centraal':'Amsterdam C','Berlin Hbf (tief)':'Berlin Hbf'};
 if(aliases[name])return aliases[name];
 return name.replace(/Centraal\b/g,'C').replace(/Centrale\b/g,'C').replace(/\b(Hbf|HB|SBB)\b.*$/,'$1').replace(/^Venezia\b.*$/,'Venezia');
}
export function statusView(row,stale=false){
 if(row.incoming?.cancelled||row.outgoing?.cancelled)return {kind:'missed',symbol:'×',label:'Geannuleerd',detail:'Aansluiting niet mogelijk'};
 if(stale||row.status==='unknown')return {kind:'unknown',symbol:'?',label:'Onbekend',detail:stale?'Metingen verouderd':'Geen actuele meting'};
 const min=Number.isFinite(row.minutes)?Math.round(row.minutes):null;
 return {kind:row.status,symbol:row.status==='feasible'?'✓':row.status==='missed'?'×':'?',label:min===null?'Onbekend':`${min} min`,detail:row.status==='feasible'?'Haalbaar':row.status==='missed'?'Niet haalbaar':'Onzeker'};
}
