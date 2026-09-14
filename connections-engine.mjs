import {connectionRules,connectionRulesVersion,replacements,normalized,localClock,activeRule} from './connections-rules.mjs';
const validTrack=t=>!['','—','-','?','null','undefined'].includes(String(t||'').trim());
export function platformRelation(a,b,layout){
 if(!validTrack(a)||!validTrack(b))return 'unknown';
 const clean=t=>String(t).trim().toUpperCase().replace(/^(GLEIS|SPOOR|BINARIO)\s+/,'');a=clean(a);b=clean(b);
 if(a===b)return 'same';
 const groups=layout?.platformGroups||[];const ai=groups.findIndex(g=>g.map(clean).includes(a)),bi=groups.findIndex(g=>g.map(clean).includes(b));
 return ai<0||bi<0?'unknown':ai===bi?'same':'different';
}
export function transferStatus(minutes,relation){
 if(!Number.isFinite(minutes))return 'unknown';
 if(relation==='same')return minutes>=1?'feasible':minutes>=0?'uncertain':'missed';
 if(relation==='different')return minutes>=7?'feasible':minutes>2?'uncertain':'missed';
 return minutes>=7?'feasible':minutes>=0?'uncertain':'missed';
}
export function uniqueEvent(events){
 const groups=new Map();for(const e of events){const key=[e.number,e.planned,e.mode,e.category].join('|');const old=groups.get(key);if(!old||(old.source==='DB_PLAN'&&e.source!=='DB_PLAN')||(old.source===e.source&&e.seenAt>old.seenAt))groups.set(key,e);}
 return groups.size===1?{event:[...groups.values()][0]}:groups.size>1?{reason:'ambiguous-services'}:{reason:'missing-planning'};
}
function select(events,number,mode,complete,allowReplacement=true){
 const primary=uniqueEvent(events.filter(e=>e.number===number&&e.mode===mode));if(primary.event||primary.reason==='ambiguous-services')return primary;
 if(!complete)return {reason:'incomplete-planning',requested:number};
 const replacement=allowReplacement&&replacements[number];return replacement?{...uniqueEvent(events.filter(e=>e.number===replacement&&e.mode===mode)),replacementFor:number}:{reason:'not-in-plan',requested:number};
}
const inWindow=(e,window)=>localClock(e.planned)>=window.from&&localClock(e.planned)<=window.to;
export function assessPair(rule,date,station,a,b,layout,now){
 const plannedRelation=platformRelation(a.plannedTrack,b.plannedTrack,layout),relation=platformRelation(a.currentTrack,b.currentTrack,layout);
 const plannedMinutes=(b.planned-a.planned)/60000,plannedStatus=transferStatus(plannedMinutes,plannedRelation);
 const result={ruleId:rule.id,rulesVersion:connectionRulesVersion,date,station,incoming:a,outgoing:b,plannedMinutes,plannedRelation,relation,layout:layout?{station:layout.station,platformGroups:layout.platformGroups,source:layout.source,verificationStatus:layout.verificationStatus,notes:layout.notes}:null,plannedStatus,eligible:plannedStatus!=='missed',evaluatedAt:now,minutes:null,status:'unknown',reason:null,evidence:'none',phase:'upcoming'};
 if(!result.eligible){result.reason='not-planned-feasible';result.status='not-planned';return result;}
 const measuredA=a.actual||a.expected,measuredB=b.actual||b.expected;
 result.phase=now>=measuredB+300000?'after-time':'upcoming';
 if((!a.actual&&now-a.seenAt>15*60000)||(!b.actual&&now-b.seenAt>15*60000)){result.reason='stale-observation';return result;}
 if(a.cancelled||b.cancelled){result.status='missed';result.reason='cancelled';result.evidence='cancellation';return result;}
 if(!(a.actual||a.realtime)||!(b.actual||b.realtime)||!measuredA||!measuredB){result.reason='planning-only';return result;}
 result.minutes=(measuredB-measuredA)/60000;result.status=transferStatus(result.minutes,relation);result.evidence=a.actual&&b.actual?'actual-times':'latest-expectations';result.reason='time-comparison';return result;
}
// Complete means full-day station planning coverage, not just absence from a response.
export function evaluateConnections({date,events,layouts={},completeStations=new Set(),now=Date.now()}){
 const results=[];
 for(const rule of connectionRules){if(!activeRule(rule,date))continue;
 function at(station,forcedOutgoing){
 const list=events.filter(e=>e.date===date&&e.station===station),complete=completeStations.has(station);
 let incoming=select(list,rule.incoming,'arrival',complete),outgoing=select(list,forcedOutgoing||rule.outgoing,'departure',complete,!forcedOutgoing);
 if(!incoming.event&&incoming.reason!=='ambiguous-services'&&complete&&rule.alternativeArrival){const options=list.filter(e=>e.mode==='arrival'&&rule.alternativeArrival.categories.includes(e.category)&&inWindow(e,rule.alternativeArrival)).sort((a,b)=>a.planned-b.planned);incoming=options.length?{event:options[0],alternative:true}:incoming;}
 if(!outgoing.event&&outgoing.reason!=='ambiguous-services'&&complete&&rule.alternativeDeparture){const window=rule.alternativeDeparture;const options=list.filter(e=>e.mode==='departure'&&inWindow(e,window)&&window.destinations.some(d=>normalized(e.destination).includes(d))).sort((a,b)=>a.planned-b.planned);outgoing=options.length?{event:options[0],alternative:true}:outgoing;}
 const a=incoming.event,b=outgoing.event;
 const base={ruleId:rule.id,rulesVersion:connectionRulesVersion,date,station,evaluatedAt:now,eligible:false,status:'unknown',requestedIncoming:rule.incoming,requestedOutgoing:forcedOutgoing||rule.outgoing,incoming:a||null,outgoing:b||null,reason:incoming.reason||outgoing.reason,selection:{incomingReplacement:incoming.replacementFor||null,outgoingReplacement:outgoing.replacementFor||null,alternativeArrival:!!incoming.alternative,alternativeDeparture:!!outgoing.alternative}};
 if(b&&((rule.departureBefore&&localClock(b.planned)>=rule.departureBefore)||(rule.departureAfter&&localClock(b.planned)<=rule.departureAfter)))return {...base,status:'not-applicable',reason:'departure-time-condition'};
 if(a&&rule.origin){if(!a.origin||['—','-'].includes(a.origin))return {...base,reason:'unknown-origin'};if(normalized(a.origin)!==rule.origin||a.category!==rule.incomingCategory)return {...base,status:'not-applicable',reason:'origin-condition'};}
 if(!a||!b)return base;
 return {...base,...assessPair(rule,date,station,a,b,layouts[station],now)};
 }
 const main=at(rule.station);results.push(main);
 if(rule.fallbackStation&&(main.status==='not-planned'||main.eligible&&main.status==='missed')){
 const fallback=at(rule.fallbackStation,main.outgoing?.number);fallback.fallbackFor=rule.station;fallback.fallbackReason=main.status==='not-planned'?'planned-impossible':'live-missed';results.push(fallback);
 }
 if(rule.alternativeTrain&&(main.status==='not-planned'||main.eligible&&main.status==='missed'||main.reason==='not-in-plan')){const alternative=at(rule.station,rule.alternativeTrain);alternative.alternativeFor=rule.outgoing;results.push(alternative);}
 }
 return results;
}
