// Emails remain the source of voucher content. API snapshots only corroborate explicit fields.
const normal=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function breakfastValue(text){
 const s=normal(text);
 const no=/\b(?:zonder ontbijt|exclusief ontbijt|ontbijt niet inbegrepen|no breakfast|without breakfast|breakfast not included|room only)\b/.test(s),yes=/\b(?:inclusief ontbijt|ontbijt inbegrepen|gratis ontbijt|including breakfast|breakfast included|free breakfast|complimentary breakfast|bed and breakfast)\b/.test(s);
 return yes===no?null:yes;
}
const roomKinds=text=>{
 const s=normal(text),k=[];
 for(const [kind,re] of [['single',/\b(?:single|eenpersoonskamer)\b/],['twin',/\b(?:twin|2 single beds|2 eenpersoonsbedden)\b/],['double',/\b(?:double|tweepersoonsbed|1 double bed)\b/],['suite',/\bsuite\b/],['triple',/\b(?:triple|driepersoonskamer)\b/]])if(re.test(s))k.push(kind);
 return k;
};
export function latestExpedia(events=[]){
 const byRef=new Map();
 for(const event of events){const ref=String(event.itineraryId||event.payload?.data?.itinerary_id||'');if(!ref)continue;const previous=byRef.get(ref),time=Date.parse(event.updatedAt||event.payload?.data?.update_date_time||event.payload?.time);if(!Number.isFinite(time))continue;
  const oldTime=previous?Date.parse(previous.updatedAt||previous.payload?.data?.update_date_time||previous.payload?.time):-Infinity;
  if(time>oldTime||time===oldTime&&String(event.receivedAt||'')>String(previous.receivedAt||''))byRef.set(ref,event);
 }
 return [...byRef.values()];
}
const cancelled=s=>/^(?:cancelled|canceled)$/i.test(String(s||''));
export function compareExpedia(event,emailRows=[]){
 const data=event?.payload?.data,reference=String(event?.itineraryId||data?.itinerary_id||emailRows[0]?.reference||''),differences=[],checked=[];
 const latest=new Map();for(const e of emailRows.filter(e=>e.provider==='Expedia'&&String(e.reference)===reference).sort((a,b)=>String(a.observedAt||a.importedAt||'').localeCompare(String(b.observedAt||b.importedAt||''))))latest.set(e.id||e.todoKey||e.reference,e);
 const emails=[...latest.values()],items=data?.property_booking_items||[],active=items.filter(i=>!cancelled(i.status)),blocked=!!data&&(cancelled(data.status)||items.some(i=>cancelled(i.status)));
 const result={reference,updatedAt:event?.updatedAt||null,emailIds:emails.map(e=>e.id),status:!data?'no-api':blocked?'cancelled':!emails.length?'awaiting-email':'matched',voucherBlocked:blocked,checked,differences,missing:[]};
 if(!data)return result;
 if(blocked){differences.push({field:'status',code:'cancelled',severity:'alarm',detail:cancelled(data.status)||!active.length?'Expedia meldt een annulering. Deze reservering mag niet als actieve voucher worden gebruikt.':'Expedia meldt een geannuleerde kamer. Controleer welke kamers nog actief zijn voordat een voucher wordt gebruikt.'});}
 if(!emails.length||blocked)return result;
 const add=(field,detail,severity='alarm')=>differences.push({field,code:field,severity,detail});
 const confirmed=emails.filter(e=>e.status==='confirmed');
 if(!blocked&&confirmed.length===0&&/confirmed/i.test(data.status||''))add('status','De e-mail meldt annulering, terwijl Expedia de reservering nog als bevestigd vermeldt. Controleer het tijdstip van beide bronnen.','attention');
 for(const [field,key,label] of [['arrival','checkin_date','aankomst'],['departure','checkout_date','vertrek']]){
  const api=[...new Set(active.map(i=>i[key]).filter(Boolean))].sort(),mail=[...new Set(confirmed.map(e=>e[field==='arrival'?'start':'end']).filter(Boolean))].sort();
  if(api.length&&mail.length){checked.push(field);if(JSON.stringify(api)!==JSON.stringify(mail))add(field,`Afwijkende ${label}: e-mail ${mail.join(', ')}; Expedia ${api.join(', ')}.`);}
 }
 const countsKnown=active.length&&active.every(i=>Number.isInteger(i.adult_count)&&Number.isInteger(i.child_count));
 if(countsKnown&&confirmed.length&&confirmed.every(e=>Number.isInteger(e.occupants))){checked.push('occupants');const api=active.reduce((n,i)=>n+i.adult_count+i.child_count,0),mail=confirmed.reduce((n,e)=>n+e.occupants,0);if(api!==mail)add('occupants',`Aantal personen verschilt: e-mail ${mail}; Expedia ${api}.`);}
 const apiHotels=[...new Set(active.map(i=>normal(i.property?.name)).filter(Boolean))],mailHotels=[...new Set(confirmed.map(e=>normal(e.product)).filter(Boolean))];
 if(apiHotels.length&&mailHotels.length){checked.push('hotel');if(apiHotels.some(a=>!mailHotels.some(m=>a.includes(m)||m.includes(a))))add('hotel','De hotelnaam in Expedia wijkt af van de e-mail. Controleer of dit dezelfde accommodatie is.','attention');}
 const apiRooms=active.map(i=>i.room_name).filter(s=>typeof s==='string'&&s.trim()),mailRooms=confirmed.map(e=>e.room).filter(Boolean);
 if(apiRooms.length===active.length&&active.length&&mailRooms.length){checked.push('room');const a=apiRooms.flatMap(roomKinds),m=mailRooms.flatMap(roomKinds);if(a.length&&m.length&&!a.some(k=>m.includes(k)))add('room',`Kamertype beoordelen: e-mail ${mailRooms.join('; ')}; Expedia ${apiRooms.join('; ')}.`,'attention');}
 else result.missing.push('room');
 const apiBreakfast=active.map(i=>breakfastValue(i.rate?.rate_plan_name)),mailBreakfast=confirmed.map(e=>typeof e.breakfast==='boolean'?e.breakfast:breakfastValue(e.room+' '+(e.sourceText||'')));
 if(active.length&&apiBreakfast.every(v=>v!==null)&&mailBreakfast.length&&mailBreakfast.every(v=>v!==null)){checked.push('breakfast');if([...new Set(apiBreakfast)].sort().join()!==[...new Set(mailBreakfast)].sort().join())add('breakfast','Ontbijt verschilt tussen de e-mail en de expliciete Expedia-tariefomschrijving. Controleer de bevestiging.','attention');}
 else result.missing.push('breakfast');
 const agency=String(data.agency_reference_code||'').trim().match(/^(\d{4})A$/i)?.[1],trips=[...new Set(emails.map(e=>String(e.trip||'').replace(/A$/i,'')).filter(Boolean))];
 if(agency&&trips.length){checked.push('agency-reference');if(!trips.includes(agency))add('agency-reference',`Expedia noemt referentie ${agency}A; de e-mail is gekoppeld aan ${trips.join(', ')}A.`,'attention');}
 if(!blocked&&differences.length)result.status='attention';
 return result;
}
export function expediaControls(state,events=state.expediaEvents||[]){
 const latest=latestExpedia(events),refs=new Set(latest.map(e=>e.itineraryId||e.payload.data.itinerary_id));
 return [...latest.map(e=>compareExpedia(e,state.evidence||[])),...(state.evidence||[]).filter(e=>e.provider==='Expedia'&&!refs.has(String(e.reference))).filter((e,i,rows)=>rows.findIndex(x=>x.reference===e.reference)===i).map(e=>compareExpedia(null,(state.evidence||[]).filter(x=>x.reference===e.reference)))];
}
