// Render a small formatting language with DOM nodes, never arbitrary HTML.
window.kkRich=function(target,text){
 target.replaceChildren();
 function inline(node,line){const re=/(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;let pos=0,m;while((m=re.exec(line))){node.append(document.createTextNode(line.slice(pos,m.index)));let child;if(m[2]){child=document.createElement('strong');child.textContent=m[2];}else if(m[3]){child=document.createElement('em');child.textContent=m[3];}else{child=document.createElement('a');child.textContent=m[4];child.href=m[5];child.target='_blank';child.rel='noopener noreferrer';}node.append(child);pos=re.lastIndex;}node.append(document.createTextNode(line.slice(pos)));}
 let list=null;for(const line of String(text||'').split('\n')){if(!line.trim()){list=null;continue;}let el;if(line.startsWith('- ')){if(!list){list=document.createElement('ul');target.append(list);}el=document.createElement('li');inline(el,line.slice(2));list.append(el);}else{list=null;el=document.createElement(line.startsWith('## ')?'h3':'p');inline(el,line.startsWith('## ')?line.slice(3):line);target.append(el);}}
};
