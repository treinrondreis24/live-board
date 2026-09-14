import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runConnectionMonitor,handleConnections,connectionMonitorStatus} from './connections-monitor.mjs';
import {transferStatus,platformRelation,evaluateConnections,assessPair} from './connections-engine.mjs';
import {connectionRules,activeRule,connectionDate} from './connections-rules.mjs';
import {initConnections,recordConnectionEvents,recordConnectionPlanHour,connectionInputs,saveConnectionAssessment,readConnections,readConnectionRevisions,cleanConnectionWorkingData} from './connections-store.mjs';
const date='2026-09-14',ts=t=>Date.parse(date+'T'+t+':00+02:00'),now=ts('13:00');
const event=(number,mode,time,extra={})=>({number,mode,planned:ts(time),expected:ts(time),date,station:'koeln',category:'ICE',seenAt:now,realtime:true,plannedTrack:'4',currentTrack:'4',...extra});
const evaluate=(events,extra={})=>evaluateConnections({date,events,now,...extra});
const result=(events,id='koeln-106-224',extra={})=>evaluate(events,extra).find(r=>r.ruleId===id&&!r.alternativeFor&&r.station===connectionRules.find(x=>x.id===id).station);
test('all minute boundaries and platform groups',()=>{
 for(const [relation,values] of Object.entries({same:[[-1,'missed'],[0,'uncertain'],[1,'feasible']],different:[[2,'missed'],[3,'uncertain'],[6,'uncertain'],[7,'feasible']],unknown:[[-1,'missed'],[0,'uncertain'],[6,'uncertain'],[7,'feasible']]}))for(const [min,status] of values)assert.equal(transferStatus(min,relation),status);
 assert.equal(platformRelation('4','5',{platformGroups:[['4','5'],['6','7']]}),'same');
 assert.equal(platformRelation('4','6',{platformGroups:[['4','5'],['6','7']]}),'different');
 assert.equal(platformRelation('4','5',null),'unknown');assert.equal(platformRelation('','',null),'unknown');assert.equal(platformRelation('Gleis 4','4',null),'same');
});
test('replacement requires complete planning; cancellation never selects replacement',()=>{
 const rows=[event('106','arrival','13:00'),event('1254','departure','13:10')];
 assert.equal(result(rows).status,'unknown');assert.equal(result(rows,undefined,{completeStations:new Set(['koeln'])}).outgoing.number,'1254');
 rows.push(event('224','departure','13:10',{cancelled:true}));assert.equal(result(rows).status,'missed');assert.equal(result(rows).outgoing.number,'224');
});
test('missing, ambiguous, stale and planning-only stay unknown',()=>{
 const a=event('106','arrival','13:00'),b=event('224','departure','13:10');
 assert.equal(result([a]).status,'unknown');
 assert.equal(result([a,b,{...b,planned:ts('14:00')}]).reason,'ambiguous-services');
 assert.equal(result([{...a,seenAt:now-16*60000},b]).reason,'stale-observation');
 assert.equal(result([{...a,realtime:false},b]).reason,'planning-only');
 assert.equal(result([a,b]).status,'feasible');
 assert.equal(result([a,{...b,source:'DB',expected:ts('13:12')},{...b,source:'DB_PLAN',seenAt:now+1,realtime:false}]).minutes,12);
});
test('planned and unplanned Cologne failures add Duesseldorf without losing Cologne',()=>{
 for(const planned of [true,false]){
 const rows=[event('106','arrival','13:00'),event('224','departure',planned?'12:59':'13:10',{expected:ts('12:59')}),event('106','arrival','13:20',{station:'duesseldorf'}),event('224','departure','13:25',{station:'duesseldorf'})];
 const pair=evaluate(rows).filter(r=>r.ruleId==='koeln-106-224');assert.equal(pair.length,2);assert.equal(pair[1].status,'feasible');assert.equal(pair[1].fallbackReason,planned?'planned-impossible':'live-missed');
 }
});
test('Berlin alternatives and date limits',()=>{
 const rows=[event('178','arrival','13:00',{station:'berlin'}),event('140','departure','13:20',{station:'berlin'})];
 assert.equal(evaluate(rows,{completeStations:new Set(['berlin'])}).find(r=>r.alternativeFor==='142').outgoing.number,'140');
 assert.equal(activeRule(connectionRules.find(r=>r.id==='dresden-178-2440'),'2026-10-06'),false);assert.equal(activeRule(connectionRules.find(r=>r.id==='dresden-178-2440'),'2026-10-07'),true);
 assert.equal(activeRule(connectionRules.find(r=>r.id==='osnabrueck-145-202'),'2026-10-05'),false);
});
test('Wien time conditions and replacement Railjet',()=>{
 const rows=[event('68','arrival','16:30',{station:'wien',category:'RJX'}),event('40490','departure','18:30',{station:'wien'})];
 assert.equal(result(rows,'wien-66-40490',{completeStations:new Set(['wien'])}).incoming.number,'68');
 assert.equal(result(rows,'wien-146-40490').status,'not-applicable');
 rows[1].planned=ts('19:30');assert.equal(result(rows,'wien-66-40490').status,'not-applicable');
});
test('Mannheim destination window and airport origin',()=>{
 const rows=[event('225','arrival','13:20',{station:'mannheim'}),event('77','departure','13:40',{station:'mannheim',destination:'Basel SBB'}),event('78','departure','13:30',{station:'mannheim',destination:'Berlin Hbf'})];
 assert.equal(result(rows,'mannheim-225-371',{completeStations:new Set(['mannheim'])}).outgoing.number,'77');
 const airport=[event('28','arrival','13:00',{station:'flughafen',origin:'Wien Hbf'}),event('224','departure','13:10',{station:'flughafen'})];
 assert.equal(result(airport,'flughafen-28-224').status,'feasible');airport[0].origin='';assert.equal(result(airport,'flughafen-28-224').reason,'unknown-origin');airport[0].origin='Hamburg';assert.equal(result(airport,'flughafen-28-224').status,'not-applicable');
});
test('actual timestamps cross midnight and remain distinct from expectations',()=>{
 const a=event('1','arrival','23:59'),b=event('2','departure','23:59');b.planned+=600000;a.actual=a.planned;b.actual=b.planned;
 assert.equal(assessPair({id:'test'},date,'koeln',a,b,null,now+2*86400000).evidence,'actual-times');
 assert.equal(assessPair({id:'test'},date,'koeln',a,b,null,now+2*86400000).minutes,10);
});
test('persistent snapshots, deduplicated revisions, last assessment retention and coverage',async()=>{
 const sqlite=new DatabaseSync(':memory:');await initConnections({sqlite});
 const raw={number:'106',category:'ICE',observedAt:'Köln Hbf',eventMode:'arrival',plannedTimestamp:ts('13:00'),expectedTimestamp:ts('13:01'),sourceEventId:'a',hasRealtime:true};
 await recordConnectionEvents([raw],'DB',now);await recordConnectionEvents([{...raw,expectedTimestamp:ts('14:00')}],'DB',now-1);await recordConnectionEvents([raw],'OTHER',now);
 assert.equal((await connectionInputs(date)).events.length,1);assert.equal((await connectionInputs(date)).events[0].expected,ts('13:01'));
 for(let t=ts('00:00');connectionDate(t)===date;t+=3600000)await recordConnectionPlanHour('Köln Hbf',t);
 assert.equal((await connectionInputs(date)).completeStations.has('koeln'),true);
 const r=result([event('106','arrival','13:00'),event('224','departure','13:10')]);await saveConnectionAssessment(r);await saveConnectionAssessment({...r,evaluatedAt:now+1});
 let saved=(await readConnections(date))[0];assert.equal(saved.revision,1);
 await saveConnectionAssessment({...r,evaluatedAt:now+2,status:'unknown',reason:'stale-observation'});saved=(await readConnections(date))[0];assert.equal(saved.revision,2);assert.equal(saved.lastKnown.status,'feasible');assert.equal((await readConnectionRevisions(saved.key)).length,2);
 for(let t=ts('00:00');connectionDate(t)===date;t+=3600000)await recordConnectionPlanHour('Berlin Hbf',t);
 assert.equal((await connectionInputs(date)).completeStations.has('berlin'),false);
 for(let t=ts('00:00');connectionDate(t)===date;t+=3600000)await recordConnectionPlanHour('Berlin Hbf (tief)',t);
 assert.equal((await connectionInputs(date)).completeStations.has('berlin'),true);
 assert.equal((await readConnectionRevisions(saved.key,{before:2,limit:1}))[0].revision,1);
 await cleanConnectionWorkingData(now+10*86400000);assert.equal((await connectionInputs(date)).events.length,0);assert.equal((await readConnections(date)).length,1);
 await saveConnectionAssessment({...r,station:'duesseldorf',fallbackFor:'koeln',evaluatedAt:now+2});
 await runConnectionMonitor(async()=>null,now+3);assert.equal(connectionMonitorStatus.lastError,null);
 assert.equal((await readConnections(date)).find(x=>x.fallbackFor==='koeln').reason,'alternative-no-longer-triggered');
 const response={writeHead(s){this.status=s;},end(s){this.body=JSON.parse(s);}};
 await handleConnections({method:'GET'},response,new URL('http://localhost/api/connections?date='+date));assert.equal(response.status,200);assert.ok(response.body.connections.length>0);
 await handleConnections({method:'GET'},response,new URL('http://localhost/api/connections?date=2026-02-30'));assert.equal(response.status,400);
 await handleConnections({method:'GET'},response,new URL('http://localhost/api/connections/revisions?before=-1'));assert.equal(response.status,400);
 await handleConnections({method:'POST'},response,new URL('http://localhost/api/connections'));assert.equal(response.status,405);sqlite.close();
});
