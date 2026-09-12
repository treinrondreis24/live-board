(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const preview=new URLSearchParams(location.search).get('preview')==='1';
 let config={pages:[]};
 const ready=fetch('/api/app-content/'+(preview?'draft':'public')).then(async r=>{if(!r.ok)throw Error('Open /seinhuis om het voorbeeld te bekijken.');const j=await r.json();config=preview?j.draft:j;}).catch(e=>{if(preview)throw e;});
 const link=l=>l?.page?'#'+l.page:l?.url||'';
 const ext=l=>l?.url&&!l.page?' target="_blank" rel="noopener"':'';
 const img=url=>url?`<img class="content-photo" src="${esc(url)}" loading="lazy" alt="">`:'';
 const countries=new Intl.DisplayNames(['nl'],{type:'region'});
 const feeds=new Map(),pendingFeeds=new Map();
 async function fetchFeed(url){let old=feeds.get(url);if(!old&&!preview){try{old=JSON.parse(sessionStorage.getItem('tr-feed:'+url));}catch{}}if(old&&Date.now()-old.at<300000)return old.data;const r=await fetch('/api/app-content/feed?'+new URLSearchParams({url,...(preview?{preview:'1'}:{})}));const j=await r.json();if(!r.ok)throw Error(j.error);const entry={at:j.stale?0:Date.now(),data:j};feeds.set(url,entry);if(!preview){try{sessionStorage.setItem('tr-feed:'+url,JSON.stringify(entry));}catch{}}return j;}
 async function feed(url){if(!pendingFeeds.has(url))pendingFeeds.set(url,fetchFeed(url).finally(()=>pendingFeeds.delete(url)));return pendingFeeds.get(url);}
 function navigation(hash){if(!config.navigation)return;const root=document.querySelector('nav[aria-label="Hoofdnavigatie"]'),id=hash.split('?')[0],current=id.startsWith('station/')?'tijden':id;root.innerHTML=config.navigation.filter(n=>n.visible!==false).map(n=>`<a href="#${esc(n.page)}" ${n.page===current?'aria-current="page"':''}><span aria-hidden="true">${esc(n.icon)}</span>${esc(n.title)}</a>`).join('');}
 function applyLogo(p){const brand=document.querySelector('.brand');brand.hidden=p?.logo==='none';const image=brand.querySelector('img');image.src=p?.logo==='custom'&&p.logoUrl?p.logoUrl:'https://www.treinreiziger.nl/wp-content/themes/treinreiziger/img/logogrey.png';image.alt=p?.logo==='custom'?p.title:'Treinreiziger.nl';}
 function heading(s){return `<div class="section-heading">${s.title?`<h2>${esc(s.title)}</h2>`:'<span></span>'}${link(s.more)&&s.moreLabel?`<a href="${esc(link(s.more))}"${ext(s.more)}>${esc(s.moreLabel)} ${s.more.url?'↗':'→'}</a>`:''}</div>`;}
 function cards(items,s){if(!items.length)return '<p>Geen berichten gevonden.</p>';return `<div class="cms-list cms-${esc(s.layout)}">`+items.map(t=>{
  const href=s.reader?'#'+s.reader+'?'+new URLSearchParams({feed:s.feed,item:t.id||t.url}):t.url;
  const intro=(s.showIntro??!['small','titles','tiny'].includes(s.layout))?`<p class="cms-intro">${esc(t.summary)}</p>`:'';
  const date=s.showDate!==false&&t.date&&Number.isFinite(Date.parse(t.date))?`<time>${esc(new Date(t.date).toLocaleDateString('nl-NL'))}</time>`:'';
  const title=`<h2>${esc(t.title)}</h2>`,overlay=s.layout==='overlay'&&t.image;
  const price=t.price?`<div class="trip-bottom">Vanaf <strong>${esc(new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',minimumFractionDigits:0,maximumFractionDigits:2}).format(t.price))}</strong> <small>${esc(t.priceType)}</small></div>`:'';
  return `<article class="cms-card ${t.image?'has-photo':''}"><a href="${esc(href)}"${s.reader?'':' target="_blank" rel="noopener"'}>${overlay?`<div class="cms-cover">${img(t.image)}<div class="cms-cover-title">${title}</div></div>`:s.layout!=='titles'?img(t.image):''}<div class="cms-copy">${t.country?`<small>${esc(countries.of(t.country))}${t.duration?' · '+esc(t.duration)+' '+esc(t.durationType):''}</small>`:''}${overlay?'':title}${date}${intro}${price}</div></a></article>`;
 }).join('')+'</div>';}
 const sliderCleanup=new Set();
 function sliderControls(holder,s){
  holder.stopSlider?.();
  if(!['slider','slideshow'].includes(s.layout))return;
  const list=holder.querySelector('.cms-list');if(!list||list.children.length<2)return;
  const controls=document.createElement('div');controls.className='cms-slide-controls';const previous=document.createElement('button'),next=document.createElement('button');previous.textContent='← Vorige';next.textContent='Volgende →';previous.type=next.type='button';
  const move=direction=>{const step=list.children[0].getBoundingClientRect().width+18;list.scrollBy({left:direction*step,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
  previous.onclick=()=>move(-1);next.onclick=()=>move(1);controls.append(previous,next);holder.append(controls);
  if(s.layout!=='slideshow')return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),dots=document.createElement('div');dots.className='cms-slide-dots';dots.setAttribute('aria-label','Kies een bericht');
  let paused=reduced.matches,hover=false,index=0;
  const go=i=>{index=(i+list.children.length)%list.children.length;list.scrollTo({left:list.children[index].offsetLeft-list.children[0].offsetLeft,behavior:reduced.matches?'instant':'smooth'});update();};
  const update=()=>{[...dots.children].forEach((d,i)=>d.setAttribute('aria-current',String(i===index)));};
  [...list.children].forEach((_,i)=>{const dot=document.createElement('button');dot.type='button';dot.setAttribute('aria-label','Ga naar bericht '+(i+1));dot.onclick=()=>go(i);dots.append(dot);});
  const pause=document.createElement('button');pause.type='button';const label=()=>pause.textContent=paused?'Afspelen':'Pauzeren';pause.onclick=()=>{paused=!paused;label();};label();controls.insertBefore(pause,next);holder.append(dots);update();
  previous.onclick=()=>go(index-1);next.onclick=()=>go(index+1);
  list.addEventListener('scroll',()=>{const step=list.children[1].offsetLeft-list.children[0].offsetLeft;index=Math.max(0,Math.min(list.children.length-1,Math.round(list.scrollLeft/step)));update();},{passive:true});
  holder.onmouseenter=()=>hover=true;holder.onmouseleave=()=>hover=false;
  const timer=setInterval(()=>{if(!holder.isConnected||!list.isConnected){stop();return;}if(!paused&&!hover&&!document.hidden&&!holder.contains(document.activeElement))go(index+1);},5000);
  const stop=()=>{clearInterval(timer);sliderCleanup.delete(stop);};holder.stopSlider=stop;sliderCleanup.add(stop);
 }
 function readerText(item){return (item.blocks?.length?item.blocks:String(item.body||item.summary||'').split(/\n\s*\n/).filter(x=>x.trim()).map(text=>({kind:'p',text}))).map(b=>{const tag=['h2','h3'].includes(b.kind)?b.kind:'p';return `<${tag}>${esc(b.text)}</${tag}>`;}).join('');}

 async function section(s,root,token,current){
  root.innerHTML=heading(s);
  if(s.kind==='content'){root.insertAdjacentHTML('beforeend',`<article class="cms-own cms-own-${esc(s.layout)}">${img(s.image)}${s.headline?`<h3>${esc(s.headline)}</h3>`:''}<p>${esc(s.text).replace(/\n/g,'<br>')}</p>${link(s.link)?`<a href="${esc(link(s.link))}"${ext(s.link)}>Lees verder ${s.link.url?'↗':'→'}</a>`:''}</article>`);return;}
  try{
   const j=await feed(s.feed);if(!current(token))return;
   let items=j.items.filter(t=>(!s.complete||t.image&&t.price)&&(!s.field||s.equals===''||(Array.isArray(t[s.field])?t[s.field]:[t[s.field]]).some(v=>String(v??'').toLocaleLowerCase()===s.equals.toLocaleLowerCase())));
   const holder=document.createElement('div');
   if(s.countryFilter){const label=document.createElement('label');label.className='country-filter';label.textContent='Filter op land';const select=document.createElement('select');select.innerHTML='<option value="">Alle landen</option>'+[...new Set(items.map(t=>t.country).filter(Boolean))].sort((a,b)=>countries.of(a).localeCompare(countries.of(b),'nl')).map(c=>`<option value="${esc(c)}">${esc(countries.of(c))}</option>`).join('');select.onchange=()=>{const selected=items.filter(t=>!select.value||t.country===select.value);holder.innerHTML=cards(selected.slice(s.start-1,s.start-1+s.count),s);sliderControls(holder,s);};label.append(select);root.append(label);}
   holder.innerHTML=cards(items.slice(s.start-1,s.start-1+s.count),s)||'<p>Geen berichten gevonden.</p>';root.append(holder);sliderControls(holder,s);
   if(!items.length)holder.innerHTML='<p>Geen berichten gevonden voor dit filter.</p>';
   if(j.stale||items.some(t=>t.price)){const note=document.createElement('p');note.className='source';note.textContent=[j.stale?'Laatst opgehaalde gegevens':'',items.some(t=>t.price)?'Vanafprijzen; controleer beschikbaarheid bij de aanbieder.':''].filter(Boolean).join(' · ');root.append(note);}
  }catch(e){if(current(token)){const error=document.createElement('p');error.textContent=e.message;root.append(error);}}
 }
 window.cmsRender=async(hash,root,token,current)=>{
  for(const stop of sliderCleanup)stop();
  try{await ready;}catch(e){root.textContent=e.message;return true;}if(!current(token))return true;
  navigation(hash);const [id,query='']=hash.split('?');const p=config.pages.find(p=>p.id===id);applyLogo(p);if(!p)return false;
  root.innerHTML=(preview?'<p class="cms-preview-banner">Voorbeeld van het opgeslagen concept — nog niet gepubliceerd</p>':'')+(p.showTitle?`<h1>${esc(p.title)}</h1>`:'');
  if(p.menu.length)root.insertAdjacentHTML('beforeend','<div class="topic-menu">'+p.menu.map(m=>`<a href="${esc(link(m))}"${ext(m)}><span class="topic-icon" aria-hidden="true">${esc(m.icon)}</span><span>${esc(m.title)}</span><span>${m.url?'↗':'›'}</span></a>`).join('')+'</div>');
  if(p.type==='embed'){root.insertAdjacentHTML('beforeend',p.embed?`<p class="source">Werkt de ingesloten pagina niet? <a href="${esc(p.embed)}" target="_blank" rel="noopener">Open in een nieuw venster ↗</a></p><iframe class="cms-embed" src="${esc(p.embed)}" title="${esc(p.title)}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`:'<p>Er is nog geen embedadres ingesteld.</p>');return true;}
  if(p.type==='reader'){
   const q=new URLSearchParams(query),url=q.get('feed');if(!config.pages.some(p=>p.sections.some(s=>s.feed===url&&s.reader===id))){root.insertAdjacentHTML('beforeend','<p>Open een artikel vanuit het nieuwsoverzicht.</p>');return true;}
   try{const j=await feed(url);if(!current(token))return true;const item=j.items.find(t=>(t.id||t.url)===q.get('item'));if(!item)throw Error('Dit artikel staat niet meer in de feed.');root.insertAdjacentHTML('beforeend',`<article class="cms-reader">${img(item.image)}<h1>${esc(item.title)}</h1>${readerText(item)}<a href="${esc(item.url)}" target="_blank" rel="noopener">Lees op de website ↗</a></article>`);}catch(e){if(current(token)){const el=document.createElement('p');el.textContent=e.message;root.append(el);}}return true;
  }
  await Promise.all(p.sections.map(s=>{const el=document.createElement('section');el.className='cms-section';root.append(el);return section(s,el,token,current);}));
  if(current(token)){const sources=[...new Set(p.sections.filter(s=>s.kind==='feed'&&s.showSource!==false).map(s=>new URL(s.feed).hostname.replace(/^www\./,'')))];if(sources.length){const footer=document.createElement('p');footer.className='source cms-page-sources';footer.textContent='Bronnen: '+sources.join(' · ');root.append(footer);}}return true;
 };
})();
