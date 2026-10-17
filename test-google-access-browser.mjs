import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin='https://example.test',time=Date.now(),errors=[],requests=[];
const browser=await chromium.launch({headless:true,...(process.env.SEINHUIS_TEST_CHROME?{executablePath:process.env.SEINHUIS_TEST_CHROME}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 let state={configured:true,authenticated:true,isAdmin:true,legacyOwner:false,identity:'admin@example.test',currentDeviceId:'admin-device',confirmation:{method:'google',validUntil:time+600000},sessionDays:30,countryAllowed:true};
 const device={id:'device',email:'colleague@example.test',label:'Collega laptop',status:'pending',created:time,lastSeen:time,browser:'Voorbeeldbrowser',location:{country:'NL',city:'Voorbeeldstad',ip:'192.0.2.1'}};
 const adminDevice={...device,id:'admin-device',email:'admin@example.test',label:'Mijn computer',status:'approved'};
 let failAction=false;
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(url.hostname==='accounts.google.com'){
   const channel=url.searchParams.get('channel');
   if(path==='/fake-complete'){state.confirmation.validUntil=Date.now()+600000;return route.fulfill({contentType:'text/html',body:`<p>Bevestigd</p><script>window.opener?.postMessage({type:'seinhuis-confirmed',channel:${JSON.stringify(channel)}},${JSON.stringify(origin)});window.close();</script>`});}
   return route.fulfill({contentType:'text/html',body:`<h1>Fictieve Google-bevestiging</h1><a href="/fake-complete?channel=${encodeURIComponent(channel)}">Bevestiging afronden</a>`});
  }
  if(path.startsWith('/api/seinhuis-access/')){
   const action=path.split('/').at(-1),body=req.postDataJSON();requests.push({action,body});
   if(action==='status')return respond(state);
   if(action==='overview')return respond({appScopes:{stations:'Stationschef',booklets:'Boekjesmaker',flora:'FloRA'},accounts:[{email:'admin@example.test',role:'admin',active:true,linked:true,apps:[]},{email:device.email,role:'user',apps:['booklets','flora'],active:true,linked:true}],devices:[device,adminDevice],sessions:[{id:'session',email:device.email,device:device.id,created:time,lastSeen:time,expires:time+30*86400000}],audit:[]});
   if(action==='reauth')return respond({url:'https://accounts.google.com/fake-confirmation?channel='+encodeURIComponent(body.channel)});
   if(failAction)return respond({error:'Fictieve fout: de gegevens zijn gewijzigd. Probeer opnieuw.'},409);
   if(state.legacyOwner&&body.code!=='123456')return respond({error:'Gebruik een verse Authenticator-code.',confirmationRequired:true},403);
   if(action==='approve')device.status='approved';if(action==='revoke')device.status='revoked';
   return respond({ok:true});
  }
  const file=({'/seinhuis/toegang':'google-access.html','/seinhuis/toegang.js':'google-access.js','/seinhuis/toegang.css':'google-access.css','/admin-security.css':'admin-security.css'})[path];
  return route.fulfill({status:file?200:404,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:file?await readFile(file,'utf8'):''});
 });
 await page.goto(origin+'/seinhuis/toegang');await page.getByRole('heading',{name:'Accounts en computers',exact:true}).waitFor();
 assert.equal(await page.locator('#requests .request-card').count(),1);assert.equal(await page.locator('#devices .device-account').count(),2);assert.equal(await page.getByText('Deze browser',{exact:true}).count(),1);
 await page.getByLabel('Zoek account of computer').fill('colleague');assert.equal(await page.locator('#devices .device-account').count(),1);await page.getByLabel('Zoek account of computer').fill('');
 await page.getByRole('button',{name:'Goedkeuren',exact:true}).click();await page.getByText('Browser goedgekeurd.',{exact:false}).waitFor();assert.equal(device.status,'approved');assert.equal(await page.getByRole('dialog').isVisible(),false,'fresh confirmation needs no login');
 await page.locator('#accounts summary').filter({hasText:'colleague@example.test'}).click();const rights=page.getByRole('group',{name:'Onderdelen voor colleague@example.test',exact:true});await rights.getByRole('checkbox',{name:'Stationschef',exact:true}).check();await rights.getByRole('button',{name:'Onderdeelrechten opslaan',exact:true}).click();await page.getByText('Onderdeelrechten opgeslagen.',{exact:false}).waitFor();assert.deepEqual(requests.find(r=>r.action==='permissions').body.apps,['stations','booklets','flora']);
 state.confirmation.validUntil=time-1;await page.reload();await page.locator('#devices').getByRole('button',{name:'Toegang intrekken',exact:true}).first().waitFor();
 const target=page.locator('#devices .device-account').filter({hasText:'colleague@example.test'});await target.getByRole('button',{name:'Toegang intrekken',exact:true}).click();await page.getByRole('dialog').waitFor();assert.match(await page.locator('#confirmation-target').innerText(),/Collega laptop/);
 let count=requests.filter(r=>r.action==='revoke').length;await page.getByRole('button',{name:'Annuleren',exact:true}).click();assert.equal(requests.filter(r=>r.action==='revoke').length,count,'cancel does not send the pending action');
 await target.getByRole('button',{name:'Toegang intrekken',exact:true}).click();const popupPromise=context.waitForEvent('page');await page.getByRole('button',{name:'Bevestigen met Google',exact:true}).click();const popup=await popupPromise;await popup.getByRole('link',{name:'Bevestiging afronden',exact:true}).waitFor();assert.equal(requests.filter(r=>r.action==='revoke').length,count,'action waits for real status confirmation');await popup.getByRole('link',{name:'Bevestiging afronden',exact:true}).click();await page.getByText('Toegang tot deze browser ingetrokken.',{exact:true}).waitFor();assert.equal(device.status,'revoked');assert.equal(requests.filter(r=>r.action==='revoke').length,count+1,'action retried once after popup');assert.equal(await page.getByRole('dialog').isVisible(),false);
 // Existing-owner confirmation stays on the page, with retry inside the dialog.
 state={...state,authenticated:false,legacyOwner:true,confirmation:{method:'totp',validUntil:0}};device.status='pending';await page.reload();await page.getByRole('button',{name:'Goedkeuren',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByLabel('Authenticatorcode',{exact:true}).fill('000000');await page.getByRole('button',{name:'Bevestigen',exact:true}).click();await page.getByText('Gebruik een verse Authenticator-code.',{exact:true}).waitFor();await page.getByRole('dialog').getByLabel('Authenticatorcode',{exact:true}).fill('123456');await page.getByRole('button',{name:'Bevestigen',exact:true}).click();await page.getByText('Browser goedgekeurd.',{exact:false}).waitFor();
 // A failure is visible and focused even when the action was far down the page.
 state={...state,authenticated:true,legacyOwner:false,confirmation:{method:'google',validUntil:Date.now()+600000}};await page.reload();await page.locator('#accounts details').filter({hasText:'colleague@example.test'}).getByRole('button',{name:'Alle toegang blokkeren'}).count();await page.locator('#accounts summary').filter({hasText:'colleague@example.test'}).click();failAction=true;await page.locator('#accounts details').filter({hasText:'colleague@example.test'}).getByRole('button',{name:'Alle toegang blokkeren'}).click();await page.getByRole('alert').filter({hasText:'Fictieve fout'}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'message');assert.equal(await page.locator('#message').evaluate(e=>e.getBoundingClientRect().top>=0&&e.getBoundingClientRect().bottom<=innerHeight),true);failAction=false;
 await mkdir('outputs',{recursive:true});await page.screenshot({path:'outputs/google-access-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no horizontal overflow');await page.screenshot({path:'outputs/google-access-mobile.png',fullPage:true});
 state={configured:true,authenticated:false,isAdmin:false,legacyOwner:false,device:{email:device.email,status:'pending',label:device.label},countryAllowed:true};await page.reload();await page.getByRole('heading',{name:'Wachten op goedkeuring',exact:true}).waitFor();assert.equal(await page.locator('#admin').isVisible(),false);
 state.countryAllowed=false;state.country='US';await page.reload();await page.getByRole('heading',{name:'Toegang vanuit dit land geblokkeerd',exact:true}).waitFor();assert.equal(await page.locator('#pending').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS grouped devices, filters, fresh approval, cancellation, Google popup and same-page retry, TOTP retry, visible errors, mobile and restricted views');
}finally{await browser.close();}
