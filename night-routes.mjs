const calendar=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'});
export const stationIdentity=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function departureDay(day,offset){return validDay(day)?new Date(Date.parse(day+'T12:00:00Z')-offset*86400000).toISOString().slice(0,10):null;}
export function observedDay(row){return Number(row.plannedTimestamp)>0?calendar.format(Number(row.plannedTimestamp)):null;}
export const trainSource=r=>r.source==='DB_PLAN'?'DB':r.source||'DB';
export function nightRule(settings,row,number=row.number){return settings?.trains?.find(t=>trainSource(t)===trainSource(row)&&Number(t.number)===Number(number))?.nightRoute||null;}
export function stationDay(rule,name){const key=stationIdentity(name);if(!key)return null;const point=rule.stations.find(p=>[p.name,...p.aliases||[]].some(s=>stationIdentity(s)===key));return point?.day??null;}
export function runDay(rule,row){const offset=stationDay(rule,row.observedAt||row.station);return offset===null?null:departureDay(observedDay(row),offset);}
export function nightBookingMatches(rule,train,booking){
 const run=runDay(rule,train),boardingOffset=stationDay(rule,booking.from);
 if(!run||boardingOffset===null||rule.fromDate&&run<rule.fromDate||rule.untilDate&&run>rule.untilDate)return false;
 return run===departureDay(booking.date,boardingOffset);
}
export function validateNightRoute(input){
 const fail=message=>{throw Object.assign(Error(message),{status:400});};
 if(input==null)return null;
 if(typeof input!=='object'||Array.isArray(input)||!Array.isArray(input.stations)||!input.stations.length||input.stations.length>100)fail('Voeg 1 tot 100 meet- of instapstations toe voor het nachttraject.');
 const result={stations:[]};for(const key of ['fromDate','untilDate'])if(input[key]){if(!validDay(input[key]))fail('Ongeldige ingangs- of einddatum van het nachttraject.');result[key]=input[key];}
 if(result.fromDate&&result.untilDate&&result.untilDate<result.fromDate)fail('De einddatum moet op of na de ingangsdatum liggen.');
 const names=new Set();result.stations=input.stations.map(p=>{
  if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>120||![0,1].includes(p.day)||!Array.isArray(p.aliases||[])||(p.aliases||[]).length>10)fail('Geef elk station een naam en kies vertrekdag of +1 dag.');
  const aliases=p.aliases||[];if(aliases.some(a=>typeof a!=='string'||!a.trim()||a.length>120))fail('Ongeldige alternatieve stationsnaam.');
  for(const name of [p.name,...aliases]){const key=stationIdentity(name);if(!key||names.has(key))fail('Elk station of synoniem mag maar één keer in het nachttraject staan.');names.add(key);}
  return {name:p.name.trim(),day:p.day,aliases:aliases.map(a=>a.trim())};
 });return result;
}
export function nightWarnings(settings,bookings,observations=[]){
 const warnings=[];
 for(const train of settings.trains||[]){const rule=train.nightRoute;if(!rule)continue;
  const missing=new Set();
  for(const r of observations)if(trainSource(r)===train.source&&Number(r.number)===Number(train.number)&&stationDay(rule,r.observedAt||r.station)===null)missing.add('Meetstation: '+(r.observedAt||r.station||'naam ontbreekt'));
  for(const r of bookings)if(Number(r.number)===Number(train.number)&&r.trip&&!r.cancelled&&!r.deleted&&['Bevestigd','Te beoordelen'].includes(r.status)&&validDay(r.date)&&(!rule.fromDate||r.date>=rule.fromDate)&&(!rule.untilDate||r.date<=departureDay(rule.untilDate,-1))&&stationDay(rule,r.from)===null)missing.add('Instapstation uit FloRA: '+(r.from||'naam ontbreekt'));
  for(const detail of missing)warnings.push({number:train.number,source:train.source,message:detail+' — nog instellen; hier wordt geen boekingsnummer gekoppeld.'});
 }return warnings;
}
