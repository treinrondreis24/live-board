window.kkForms=function(content,api,participant){
 const area=document.createElement('div');content.append(area);window.kkCommunity(area,api);const live=document.createElement('a');live.href='#live';live.dataset.page='live';live.className='button';live.textContent='Liveblog volgen';area.append(live);
 if(participant.manualRegistration&&participant.approval!=='approved'){const note=document.createElement('p');note.textContent='Je kunt updates bekijken en delen. Privébewijs komt beschikbaar zodra de organisatie je aanmelding heeft goedgekeurd. Vernieuw deze pagina om je status bij te werken.';note.dataset.page='bewijs';area.append(note);}
 for(const kind of (participant.manualRegistration&&participant.approval!=='approved'?['update']:['proof','update'])){
  const section=document.createElement('section');section.dataset.page=kind==='proof'?'bewijs':'delen';area.append(section);
  section.innerHTML=`<h2>${kind==='proof'?'Bewijs insturen':'Update delen'}</h2><form><label>Hoe gaat je reis?<textarea rows="4" maxlength="10000" ${kind==='update'?'required':''}></textarea></label><label>Foto’s of video<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"></label><small>Maximaal vier foto’s (15 MB per foto) en één video (100 MB, 60 seconden). ${kind==='update'?'Minimaal één bestand verplicht.':'Bewijs is alleen zichtbaar voor jou en het beheer.'}</small>${kind==='proof'?'<button type="button" class="secondary location">Locatie toevoegen</button>':''}<p class="locationNote"></p><progress max="100" value="0" hidden aria-label="Uploadvoortgang"></progress><p role="status" class="status"></p><button type="submit">${kind==='proof'?'Bewijs insturen':'Update insturen'}</button></form>`;
  const form=section.querySelector('form'),status=section.querySelector('.status'),progress=section.querySelector('progress'),files=form.querySelector('input'),textarea=form.querySelector('textarea');
  let location=null,id=crypto.randomUUID();const uploaded=new Map();
  const locate=section.querySelector('.location');if(locate)locate.onclick=()=>{
   if(!navigator.geolocation){status.textContent='Locatie delen wordt niet ondersteund. Je kunt wel bewijs insturen.';return;}
   locate.disabled=true;navigator.geolocation.getCurrentPosition(p=>{location={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};section.querySelector('.locationNote').textContent=`Locatie vastgelegd om ${new Date(p.timestamp).toLocaleTimeString('nl-NL')} (nauwkeurigheid ${Math.round(p.coords.accuracy)} meter).`;locate.disabled=false;},()=>{status.textContent='Locatie niet beschikbaar. Controleer je toestemming of stuur bewijs zonder locatie.';locate.disabled=false;},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  };
  form.onsubmit=async e=>{
   e.preventDefault();const selected=[...files.files];let images=0,videos=0;
   for(const f of selected){const video=f.type.startsWith('video/');video?videos++:images++;if(f.size>(video?100000000:15000000)){status.textContent='Een bestand is te groot. Foto maximaal 15 MB; video maximaal 100 MB.';return;}}
   if(images>4||videos>1||(kind==='update'&&!selected.length)){status.textContent='Kies maximaal vier foto’s en één video. Een update vereist minimaal één bestand.';return;}
   const controls=[...form.querySelectorAll('input,textarea,button')];controls.forEach(el=>el.disabled=true);status.textContent='Bezig met versturen…';
   try{
    const media=[];for(const f of selected){if(!uploaded.has(f)){progress.hidden=false;uploaded.set(f,(await uploadFile(f,progress,status)).id);}media.push(uploaded.get(f));}
    await api('submit',{id,kind,text:textarea.value,location,media});form.reset();uploaded.clear();location=null;id=crypto.randomUUID();section.querySelector('.locationNote').textContent='';status.textContent='Je inzending is opgeslagen.';
   }catch(error){status.textContent=error.message+' Je tekst en bestandskeuze zijn behouden. Je kunt opnieuw verzenden.';}
   finally{progress.hidden=true;controls.forEach(el=>el.disabled=false);}
  };
 }
 const history=document.createElement('section');history.dataset.page='inzendingen';area.append(history);history.innerHTML='<h2>Mijn inzendingen</h2><button class="secondary">Inzendingen bekijken</button><div></div>';
 history.querySelector('button').onclick=async()=>{const list=history.querySelector('div');list.textContent='Laden…';try{const data=await api('submissions');list.replaceChildren();for(const item of data.submissions){const p=document.createElement('p');p.textContent=`${item.kind==='proof'?'Bewijs':'Update'} · ${new Date(item.createdAt).toLocaleString('nl-NL')} — ${item.text}`;list.append(p);for(const id of item.media){const button=document.createElement('button');button.textContent='Bestand bekijken';button.onclick=async()=>{try{const {url}=await api('media?id='+encodeURIComponent(id));window.location.assign(url);}catch(e){button.textContent=e.message;}};list.append(button);}}if(!data.submissions.length)list.textContent='Je hebt nog geen inzendingen.';}catch(e){list.textContent=e.message;}};
};
function uploadFile(file,progress,status){return new Promise((resolve,reject)=>{
 const xhr=new XMLHttpRequest();xhr.open('POST','/kilometerkampioen/api/upload');xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');xhr.timeout=180000;
 xhr.upload.onprogress=e=>{if(e.lengthComputable){progress.value=Math.round(e.loaded/e.total*100);status.textContent=progress.value===100?'Bestand controleren en opslaan…':`Uploaden: ${progress.value}%`;}};
 xhr.onload=()=>{let v;try{v=JSON.parse(xhr.responseText);}catch{reject(Error('Upload is niet bevestigd.'));return;}xhr.status>=200&&xhr.status<300?resolve(v):reject(Error(v.error||'Upload mislukt.'));};xhr.onerror=xhr.ontimeout=()=>reject(Error('Verbinding onderbroken.'));xhr.send(file);
});}
