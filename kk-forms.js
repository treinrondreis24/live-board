window.kkForms=function(content,api,participant){
 const area=document.createElement('div');content.append(area);window.kkClaims(area,api,participant);window.kkCommunity(area,api);
 if(participant.approval!=='approved'&&(participant.manualRegistration||participant.approval)){const note=document.createElement('p');note.textContent='Je kunt updates bekijken en delen. Privébewijs komt beschikbaar zodra de organisatie je aanmelding heeft goedgekeurd. Vernieuw deze pagina om je status bij te werken.';note.dataset.page='bewijs';area.append(note);}
 for(const kind of (participant.approval!=='approved'&&(participant.manualRegistration||participant.approval)?['update']:['proof','update'])){
  const section=document.createElement('section');section.dataset.page=kind==='proof'?'bewijs':'delen';area.append(section);
  section.innerHTML=`<a class="quiet-link" href="#insturen">← Terug</a><h1>${kind==='proof'?'Bewijs insturen':'Update delen'}</h1><form>${kind==='update'?'<label>Titel (optioneel)<input name="title" maxlength="120"></label>':''}<label>${kind==='proof'?'Locatie foto / station':'Hoe gaat je reis?'}<textarea rows="${kind==='proof'?1:4}" maxlength="${kind==='proof'?200:10000}" ${kind==='update'?'required':''}></textarea></label><label>Foto’s of video<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,video/mp4,video/quicktime,video/webm"></label><small>Maximaal vier foto’s (15 MB per foto) en één video (100 MB, 60 seconden). ${kind==='update'?'Foto of video is optioneel.':'Een bijlage is aanbevolen, maar niet verplicht. Bewijs is alleen zichtbaar voor jou en het beheer.'}</small>${kind==='proof'?'<button type="button" class="secondary location">Locatie toevoegen</button>':''}<p class="locationNote"></p><progress max="100" value="0" hidden aria-label="Uploadvoortgang"></progress><p role="status" class="status"></p><button type="submit">${kind==='proof'?'Bewijs insturen':'Update insturen'}</button></form>`;
  const form=section.querySelector('form'),status=section.querySelector('.status'),progress=section.querySelector('progress'),files=form.querySelector('input[type=file]'),textarea=form.querySelector('textarea');
  const draftKey='kk-draft-'+participant.id+'-'+kind,state=window.kkReliable.draft(draftKey);
  textarea.value=state.value.text||'';if(form.elements.title)form.elements.title.value=state.value.title||'';
  if(state.value.text||state.value.title)status.textContent='Je concept is hersteld. Kies eventuele bestanden opnieuw; ontvangen bestanden worden herkend.';
  if(!state.persistent)status.textContent='Je browser kan het concept niet bewaren. Laat deze pagina open tot je ontvangstbevestiging ziet.';
  function saveDraft(){state.value.text=textarea.value;state.value.title=form.elements.title?.value||'';state.save();}
  form.addEventListener('input',saveDraft);
  const previews=document.createElement('div');previews.className='upload-previews';files.after(previews);let chosen=[],objectUrls=[];
  function showChosen(){for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls=[];previews.replaceChildren();chosen.forEach((file,index)=>{const card=document.createElement('div'),url=URL.createObjectURL(file),media=document.createElement(file.type.startsWith('video/')?'video':'img');objectUrls.push(url);media.src=url;if(media.tagName==='VIDEO')media.controls=true;else media.alt=file.name;const remove=document.createElement('button');remove.type='button';remove.textContent='Verwijderen';remove.onclick=()=>{chosen.splice(index,1);showChosen();};card.append(media,document.createTextNode(file.name),remove);previews.append(card);});}
  files.onchange=()=>{chosen=[...files.files];showChosen();};
  let stations=[];
  if(kind==='proof'){
   const label=textarea.parentElement,input=document.createElement('input'),choices=document.createElement('datalist'),note=document.createElement('small');input.type='text';input.value=textarea.value;input.required=true;input.maxLength=200;input.setAttribute('list','proof-stations');choices.id='proof-stations';note.textContent='Kies een station uit de suggesties of vul een andere locatie in.';textarea.hidden=true;label.append(input,choices,note);
   fetch('/app/api/stations').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{stations=data.stations.filter(s=>s.country==='NL');for(const station of stations){const option=document.createElement('option');option.value=station.name;choices.append(option);}}).catch(()=>{note.textContent='Stationslijst niet beschikbaar. Je kunt de locatie zelf invullen.';});
   input.oninput=()=>{textarea.value=input.value;};
  }
  let location=null;
  const locate=section.querySelector('.location');if(locate)locate.onclick=()=>{
   if(!navigator.geolocation){status.textContent='Locatie delen wordt niet ondersteund. Je kunt wel bewijs insturen.';return;}
   locate.disabled=true;navigator.geolocation.getCurrentPosition(p=>{location={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};section.querySelector('.locationNote').textContent=`Locatie vastgelegd om ${new Date(p.timestamp).toLocaleTimeString('nl-NL')} (nauwkeurigheid ${Math.round(p.coords.accuracy)} meter).`;locate.disabled=false;},()=>{status.textContent='Locatie niet beschikbaar. Controleer je toestemming of stuur bewijs zonder locatie.';locate.disabled=false;},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  };
  function complete(saved){form.hidden=false;form.reset();chosen=[];showChosen();state.clear();location=null;section.querySelector('.locationNote').textContent='';status.textContent='Je inzending is opgeslagen.';const thanks=area.querySelector('[data-page="bedankt"]');thanks.replaceChildren();const title=document.createElement('h1'),note=document.createElement('p');title.textContent=kind==='proof'?'✓ Bewijs ontvangen':'✓ Update ontvangen';note.textContent='Je inzending is opgeslagen op '+window.kkDate(saved.submission.receivedAt||saved.submission.createdAt)+'.';thanks.append(title,note);if(kind==='proof'){const hilta=document.createElement('section');thanks.append(hilta);window.kkHilta(hilta,api,saved.submission.id);}for(const [label,target] of (kind==='proof'?[['Nieuw bewijs insturen','bewijs'],['Mijn reis en bewijs bekijken','mijn-reis']]:[['Nieuwe update insturen','delen'],['Alle updates bekijken','updates'],['Mijn updates bekijken','mijn-updates']])){const link=document.createElement('a');link.className='button';link.textContent=label;link.href='#'+target;link.onclick=()=>{history.dataset.kind=kind;};thanks.append(link);}locationHash('bedankt');}
  const recovery=window.kkReliable.recovery(section,form,state,'submit',complete);
  form.onsubmit=async e=>{
   e.preventDefault();const selected=[...chosen];let images=0,videos=0;
   for(const f of selected){const video=f.type.startsWith('video/');video?videos++:images++;if(f.size>(video?100000000:15000000)){status.textContent='Een bestand is te groot. Foto maximaal 15 MB; video maximaal 100 MB.';return;}}
   if(images>4||videos>1){status.textContent='Kies maximaal vier foto’s en één video.';return;}
   if(kind==='proof'&&!selected.length&&!await confirmWithoutAttachment(files))return;
   const controls=[...form.querySelectorAll('input,textarea,button')];controls.forEach(el=>el.disabled=true);status.textContent='Bezig met versturen…';
   try{
    const media=[];for(const f of selected){progress.hidden=false;media.push((await uploadFile(f,progress,status,state)).id);}
    const station=kind==='proof'?stations.find(s=>s.name===textarea.value):null;
    state.value.pending={id:state.value.id,kind,title:form.elements.title?.value||'',text:textarea.value,station:kind==='proof'?textarea.value:'',stationId:station?.id||'',location,media,withoutAttachment:kind==='proof'&&!selected.length};saveDraft();
    const saved=await window.kkReliable.send('submit',state.value.pending,status);complete(saved);

   }catch(error){if([400,413,415,422].includes(error.status)){delete state.value.pending;state.save();}status.textContent=error.message+' Je gegevens blijven behouden. Kies hieronder voor afronden als de bevestiging ontbreekt.';recovery.refresh();}

   finally{progress.hidden=true;controls.forEach(el=>el.disabled=false);}
  };
 }
 const thanks=document.createElement('section');thanks.dataset.page='bedankt';area.append(thanks);
 const history=document.createElement('section');history.dataset.page='inzendingen';area.append(history);history.innerHTML='<h2>Mijn inzendingen</h2><button class="secondary">Inzendingen bekijken</button><div></div>';
 history.querySelector('button').textContent='Vernieuwen';history.querySelector('button').onclick=async()=>{const list=history.querySelector('div');list.className='kk-timeline';list.textContent='Laden…';try{const data=await api('submissions');list.replaceChildren();for(const item of data.submissions.filter(x=>!history.dataset.kind||x.kind===history.dataset.kind)){const card=window.kkCard(item,api);list.append(card);if(item.kind==='proof'){const route=document.createElement('button');route.textContent='Trajecten nakijken met Hilta';route.onclick=()=>{const box=document.createElement('section');card.append(box);route.disabled=true;window.kkHilta(box,api,item.id);};card.append(route);}}if(!list.children.length)list.textContent='Je hebt hier nog geen inzendingen.';}catch(e){list.textContent=e.message;}};
};
function uploadFile(file,progress,status,state){const type=file.type||({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',heic:'image/heic',heif:'image/heif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'}[file.name.split('.').pop().toLowerCase()]||'application/octet-stream');return window.kkReliable.upload(file,type,false,state,progress,status);}

function locationHash(value){window.location.hash=value;}
function confirmWithoutAttachment(files){return new Promise(resolve=>{
 const dialog=document.createElement('dialog');dialog.className='attachment-confirm';dialog.setAttribute('aria-labelledby','attachment-title');
 dialog.innerHTML='<h2 id="attachment-title">Nog geen bijlage toegevoegd</h2><p>Een foto of video helpt de organisatie je reis te controleren. Wil je alsnog een bestand toevoegen?</p><button type="button" autofocus>Ja, ik wil bestand alsnog toevoegen</button><button type="button" class="secondary">Ik wil op dit moment zonder foto sturen</button>';
 const finish=value=>{dialog.close();dialog.remove();resolve(value);};
 const buttons=dialog.querySelectorAll('button');buttons[0].onclick=()=>{finish(false);files.click();};buttons[1].onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false);};document.body.append(dialog);dialog.showModal();buttons[0].focus();
});}
