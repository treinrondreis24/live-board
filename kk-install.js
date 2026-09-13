(()=>{
 let prompt=null;const box=document.createElement('div'),button=document.createElement('button'),note=document.createElement('p');button.type='button';button.className='secondary';button.textContent='App installeren';note.hidden=true;note.setAttribute('role','status');box.append(button,note);document.querySelector('header').append(box);
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone;box.hidden=standalone();
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();prompt=e;box.hidden=standalone();});window.addEventListener('appinstalled',()=>{prompt=null;box.hidden=true;});
 button.onclick=async()=>{if(prompt){const event=prompt;prompt=null;try{await event.prompt();const result=await event.userChoice;if(result.outcome==='accepted')box.hidden=true;}catch{help();}}else help();};
 function help(){note.hidden=false;note.textContent=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)?'Open deze pagina in Safari. Tik op Delen en kies Zet op beginscherm. Je kunt de app daarna via het pictogram openen.':'Open het menu van je browser en kies App installeren of Toevoegen aan beginscherm. Zie je die keuze niet? Probeer Chrome of Edge.';}
 if('serviceWorker' in navigator)navigator.serviceWorker.register('/kilometerkampioen/sw.js',{scope:'/kilometerkampioen/'}).catch(()=>{});
})();
