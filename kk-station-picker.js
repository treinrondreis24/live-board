(()=>{
 const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 let catalog=[],serial=0;

 function attach(input){
  if(input.dataset.stationPicker)return;input.dataset.stationPicker='1';input.removeAttribute('list');input.autocomplete='off';input.placeholder='Stationsnaam of afkorting';
  const wrap=document.createElement('span'),list=document.createElement('span');wrap.className='station-picker';list.className='station-results';list.hidden=true;list.id='station-results-'+(++serial);list.setAttribute('role','listbox');list.setAttribute('aria-label','Stations');input.before(wrap);wrap.append(input,list);input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');let matches=[],active=-1;
  function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function choose(s){input.value=s.name;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();}
  function highlight(){[...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}}
  function show(){const q=normalize(input.value);let recent=[];try{recent=JSON.parse(localStorage.getItem('kk-test:station-recent')||'[]');}catch{}
   matches=catalog.map(s=>{const values=[s.name,s.code,...(s.aliases||[])].map(normalize);return {s,rank:!q?(recent.includes(s.code)?0:10):normalize(s.code)===q?0:values.includes(q)?1:normalize(s.name).startsWith(q)?2:values.some(v=>v.startsWith(q))?3:values.some(v=>v.includes(q))?4:99};}).filter(x=>x.rank<99).sort((a,b)=>a.rank-b.rank||a.s.name.localeCompare(b.s.name,'nl')).slice(0,8).map(x=>x.s);
   list.replaceChildren();active=-1;for(const [i,s]of matches.entries()){const row=document.createElement('span');row.className='station-option';row.id=list.id+'-'+i;row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.innerHTML='<svg width="22" height="26" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="4"/><path d="M5 13h14M9 3v10M15 3v10M8 22l-3 4m11-4 3 4M8 18h1m6 0h1"/></svg>';const text=document.createElement('span'),sub=document.createElement('small');text.textContent=s.name;sub.textContent='Treinstation · '+s.code.toUpperCase();text.append(sub);row.append(text);row.onpointerdown=e=>{e.preventDefault();try{localStorage.setItem('kk-test:station-recent',JSON.stringify([s.code,...recent.filter(c=>c!==s.code)].slice(0,5)));}catch{}choose(s);};list.append(row);}
   if(!matches.length){const empty=document.createElement('span');empty.className='station-empty';empty.textContent='Geen station gevonden. Controleer de naam of vul je locatie zelf in.';list.append(empty);}list.hidden=false;input.setAttribute('aria-expanded','true');
  }
  input.addEventListener('input',show);input.addEventListener('focus',show);input.addEventListener('blur',()=>{const q=normalize(input.value),exact=catalog.filter(s=>[s.code,s.name,...(s.aliases||[])].some(v=>normalize(v)===q));if(q&&exact.length===1&&input.value!==exact[0].name)choose(exact[0]);close();});input.addEventListener('keydown',e=>{if(e.key==='Escape'){close();return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(list.hidden)show();if(matches.length){active=(active+(e.key==='ArrowDown'?1:matches.length-1)+matches.length)%matches.length;highlight();}}if(e.key==='Enter'&&!list.hidden&&matches.length){e.preventDefault();choose(matches[active<0?0:active]);}});
 }
 function scan(){document.querySelectorAll('input[list],input[name="station"]').forEach(attach);}
 fetch('/kilometerkampioen-test/station-catalog.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{catalog=data.stations;scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});}).catch(()=>{});
})();

