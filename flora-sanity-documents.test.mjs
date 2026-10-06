import test from 'node:test';
import assert from 'node:assert/strict';
import {assetURL,readAssetPDF,attachmentMessage,collectSanityDocuments} from './flora-sanity-documents.mjs';
import {parseDocument} from './flora-mail-parser.mjs';
import {createMailControl,latestReservationState} from './flora-mail.mjs';
import {emptyState} from './flora-store.mjs';
import {evaluate} from './flora-engine.mjs';
import {messageKind} from './flora-suppliers.mjs';
const now='2026-10-06T12:00:00Z',asset={_id:'file-'+ 'a'.repeat(40)+'-pdf',_createdAt:'2026-06-20T09:00:00Z',originalFilename:'hotel.pdf'};
const voucher=ref=>`Voucher / Confirmation Booking ${ref} Hotel/Service Hotel Bernina Via Roma 24 Booking name Ms. Eva Test, Netherlands Check in day 20.10.2026 Check out day 21.10.2026 Nights 1 Occupancy 2 adults Room description Standard room Room type code MX Switzerland Travel Centre`;
const booking=()=>({_id:'b',index:6333,status:'afgehandeld',firstName:'Eva',lastName:'Test',dateDeparture:'2026-10-20',dateReturn:'2026-10-25',passengers:[{firstName:'Eva',lastName:'Test'},{firstName:'Jan',lastName:'Test'},{firstName:'Anna',lastName:'Test'},{firstName:'Tim',lastName:'Test'}],documents:[{title:'Bernina',asset}],todos:[{_key:'h',tag:'hotel',done:true,title:'Hotel Bernina | Double',quantity:2,startDate:'2026-10-20',endDate:'2026-10-21'}]});
const memory=()=>{const db=new Map();return {read:async k=>structuredClone(db.get(k)||{value:{},revision:0}),write:async(k,value,r)=>{db.set(k,{value:structuredClone(value),revision:r+1});return r+1;}};};
test('Sanity download uses only configured CDN and no credentials or redirects',async()=>{
 assert.equal(assetURL({...asset,url:'https://evil.example'}),'https://cdn.sanity.io/files/il9cyh3m/production/'+ 'a'.repeat(40)+'.pdf');
 assert.equal(assetURL({_id:'https://evil.example'}),null);let calls=0;
 await readAssetPDF(asset,{fetcher:async(url,opts)=>{calls++;assert.equal(opts.method,'GET');assert.equal(opts.headers,undefined);assert.equal(opts.redirect,'error');return new Response('%PDF-example');},readPDF:async bytes=>{assert.equal(bytes.toString(),'%PDF-example');return ['text'];}});assert.equal(calls,1);
 await assert.rejects(()=>readAssetPDF({...asset,size:11*1024*1024}),/10 MB/);
});
test('all STC pages are read, cached, grouped and barcodes ignored; unknown pages remain visible',async()=>{
 const b=booking(),db=memory();let reads=0;const opts={...db,readPDF:async()=>{reads++;return [voucher('TRR12345'),voucher('TRR67890'),'Dit is geen vervoerbewijs. Barcode'];}};
 const a=await collectSanityDocuments(b,opts);assert.equal(a.checks[0].state,'read');assert.deepEqual(a.checks[0].references,['TRR12345','TRR67890']);
 const e=a.messages[0].docs.map(d=>parseDocument(d,a.messages[0])).filter(Boolean);assert.equal(e.length,2);assert.equal(e[0].group,e[1].group);assert.equal(e[0].automaticSanity,true);
 await collectSanityDocuments(b,opts);assert.equal(reads,1);
 const bad=await collectSanityDocuments(b,{...memory(),readPDF:async()=>[voucher('TRR12345'),'Scanned image without readable text']});assert.equal(bad.checks[0].state,'incomplete');assert.match(bad.checks[0].issues[0],/pagina 2/);
});
test('targeted scan links two Sanity rooms, searches their references and preserves cancellations',async()=>{
 const b=booking(),db=memory();let state={...emptyState(),bookings:[b]};const queries=[];
 const control=createMailControl({...db,readState:async()=>({state:structuredClone(state),revision:0}),writeState:async s=>{state=s;return 1;},sync:async()=>[b],collectDocuments:(b,opts)=>collectSanityDocuments(b,{...opts,readPDF:async()=>[voucher('TRR12345'),voucher('TRR67890')]}),google:{status:async()=>({connected:true}),reader:async()=>async(path,args)=>{queries.push(args?.q);return {messages:[]};}}});
 await control.start({mode:'targeted',trips:['6333']});await control.tick();assert.equal((await control.status()).status,'completed');assert.equal(state.evidence.length,2);assert.equal(state.documentChecks['6333'].files[0].state,'read');assert.equal(state.emailChecks['6333'].stays[0].state,'found');assert.ok(!state.findings.some(f=>['duplicate','missing'].includes(f.code)));assert.ok(queries.some(q=>q?.includes('TRR12345')));
 const e=state.evidence[0];const canceled=latestReservationState({emailCancellations:{x:{provider:'STC',reference:e.reference,at:'2026-06-01',source:'cancel'}}},e);assert.equal(canceled.status,'cancelled');
 state.bookings[0].documents=[];assert.ok(evaluate(state,now).findings.some(f=>f.code==='documents-incomplete'));
});
test('own reminders never become confirmations, supplier replies remain candidates and request-only alarm is precise',()=>{
 const m={from:'Reservations <reservations@treinrondreis.nl>',subject:'Re: New reservation request nr 6665A Montpellier',docs:[{label:'E-mail',text:'Hi, Is this booked? Best regards Florentina'}]};assert.equal(messageKind(m),'own-request');assert.equal(parseDocument(m.docs[0],m),null);
 const b=booking();b.documents=[];const s={bookings:[b],evidence:[],emailChecks:{6333:{stays:[{todoKey:'h',state:'candidates',sources:[{subject:m.subject,kind:messageKind(m)}]}]}}};assert.equal(evaluate(s,now).findings.find(f=>f.code==='missing').status,'alarm');
 s.emailChecks[6333].stays[0].sources.push({kind:'supplier-message',subject:m.subject});assert.equal(evaluate(s,now).findings.find(f=>f.code==='missing').status,'attention');
});
test('Expedia voucher preserves visual date order and combines room rows on multiple pages once',async()=>{
 const header='Dit is uw hotelvoucher! Verblijf bij Test Hotel - | Reisplannummer 73478493938440 21 oktober 2026 26 oktober 2026 Check-in Check-out ';
 const room=n=>`Kamer ${n}: Bevestigingsnummer: ABC${n} Double Beschikbare voorzieningen: Gratis wifi Gereserveerd voor: Eva Test 2 volwassenen `;
 const b=booking(),result=await collectSanityDocuments(b,{...memory(),readPDF:async()=>[header+room(1),room(2)+' Verplichte toeslagen: toeristenbelasting']});
 assert.equal(result.checks[0].state,'read');const m=result.messages[0],proofs=m.docs.map(d=>parseDocument(d,m)).filter(Boolean);assert.equal(proofs.length,1);assert.equal(proofs[0].occupants,4);assert.equal(proofs[0].start,'2026-10-21');assert.equal(proofs[0].end,'2026-10-26');
 assert.equal(parseDocument({...m.docs[0],text:(header+room(1)).replace('Check-in Check-out','Check-out Check-in')},{...m,docs:[]}),null);
});
