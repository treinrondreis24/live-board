import {activeBooking,waitingBooking,reservationScope,currentBookings,evaluate,hash,recurringFinding,stays,tripNumber} from './flora-engine.mjs';

// Bookkeeping timestamps do not invalidate a completed substantive check.
function bookingHashes(state){
 const hashes=Object.create(null);
 for(const {_updatedAt,_id,...b} of currentBookings(state.bookings||[]))hashes[tripNumber(b.index)]=hash(b);
 return hashes;
}
function evidenceHashes(state){
 const grouped=Object.create(null);for(const {importedAt,...e} of state.evidence||[]){const trip=e.trip||'onbekend';(grouped[trip]??=[]).push(e);}
 return Object.fromEntries(Object.entries(grouped).map(([trip,rows])=>[trip,hash(rows.sort((a,b)=>a.id.localeCompare(b.id)))]));
}
export function planFollowup(state){
 const booking=bookingHashes(state),evidence=evidenceHashes(state),old=state.checkpoint;
 const changed=new Set();
 for(const trip of new Set([...Object.keys(booking),...Object.keys(evidence),...Object.keys(old?.booking||{}),...Object.keys(old?.evidence||{})]))if(!old||booking[trip]!==old.booking?.[trip]||evidence[trip]!==old.evidence?.[trip])changed.add(trip);
 const recurring=new Set((state.findings||[]).filter(recurringFinding).map(f=>f.trip));
 for(const b of currentBookings(state.bookings||[]))if((activeBooking(b.status)||waitingBooking(b.status))&&reservationScope(b,state.evidence)&&stays(b).some(t=>t.type==='Hotel'&&!t.confirmed))recurring.add(tripNumber(b.index));
 for(const b of currentBookings(state.bookings||[]))if(waitingBooking(b.status)&&(state.evidence||[]).some(e=>e.trip===tripNumber(b.index)&&e.status==='confirmed'))recurring.add(tripNumber(b.index));
 return {trips:new Set([...changed,...recurring]),changed,recurring,booking,evidence};
}
export function applyFollowup(state,{now=new Date().toISOString(),mode='manual',user='FloRA'}={}){
 const plan=planFollowup(state),from=state.checkpoint?.at||null;
 Object.assign(state,evaluate(state,now,{trips:plan.trips,followup:true}));
 state.checkpoint={at:now,booking:plan.booking,evidence:plan.evidence};
 const run={at:now,from,mode,user,selected:plan.trips.size,changed:plan.changed.size,recurring:plan.recurring.size};
 (state.checkRuns??=[]).push(run);
 state.audit.push({at:now,user,action:mode==='daily'?'Dagelijkse controle':'Extra controle',detail:`Vanaf ${from||'eerste controle'}: ${run.selected} boekingen geselecteerd (${run.changed} nieuw/gewijzigd, ${run.recurring} met hercontrole; kan overlappen). Ongewijzigde overige aandachtspunten behouden.`});
 return run;
}
