window.kkFeature=(content,api)=>{
 const hosts=[...content.querySelectorAll('[data-page="live"],[data-page="updates"]')].map(section=>{const host=document.createElement('aside');section.querySelector('.local-tabs').after(host);return host;});let current=null,busy=false,expanded=new Set();
 const make=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
 function render(){for(const host of hosts){host.replaceChildren();host.hidden=!current;if(!current)continue;const p=current,box=make('div');box.className='kk-feature';host.append(box);
 if(p.answered&&!expanded.has(p.id)){const b=make('button','✓ Beantwoord · '+p.title+' · Bekijk uitslag');b.className='feature-collapsed';b.onclick=()=>{expanded.add(p.id);render();};box.append(b);continue;}
 box.append(make('small',p.type==='poll'?'VASTGEZET · VRAAG VAN DE ORGANISATIE':'VASTGEZET · BERICHT VAN DE ORGANISATIE'),make('h2',p.title),make('p',p.text));
 if(p.type==='button'){const a=make('a',({delen:'Update delen',bewijs:'Bewijs indienen',eindclaim:'Eindclaim indienen'})[p.action]+' →');a.href='#'+p.action;a.className='button';box.append(a);}else{
 if(!p.answered&&p.closed==='no'){for(const [i,answer] of p.options.entries()){const b=make('button',answer);b.className='feature-choice';b.onclick=async()=>{box.querySelectorAll('button').forEach(b=>b.disabled=true);try{current=(await api('feature-vote',{id:p.id,choice:i})).post;render();}catch(e){box.append(make('p',e.message));box.querySelectorAll('button').forEach(b=>b.disabled=false);}};box.append(b);}}
 if(p.answered||p.closed==='yes'){box.append(make('p',p.total+' deelnemers hebben gestemd'+(p.closed==='yes'?' · Stemming gesloten':'')));p.options.forEach((answer,i)=>{const percent=p.total?Math.round(100*p.counts[i]/p.total):0,row=make('div');row.className='feature-result';row.append(make('span',answer+' · '+p.counts[i]+' stemmen · '+percent+'%'));const bar=make('progress');bar.max=100;bar.value=percent;row.append(bar);box.append(row);});}
 else box.append(make('small',p.total+' deelnemers hebben gestemd · één antwoord per deelnemer'));
 if(p.answered){const b=make('button','Uitslag inklappen');b.className='quiet-link';b.onclick=()=>{expanded.delete(p.id);render();};box.append(b);}
 }
 }}
 async function refresh(){if(busy||!content.isConnected)return;busy=true;try{current=(await api('feature')).post;render();}catch{/* Retain the last successfully loaded notice. */}finally{busy=false;}}
 refresh();const timer=setInterval(()=>{if(!content.isConnected){clearInterval(timer);return;}if(!document.hidden&&['#live','#updates'].includes(location.hash))refresh();},30000);
};
