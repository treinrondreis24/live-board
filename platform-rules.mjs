export function transferRule(from,to,layout){return {...baseTransferRule(from,to,layout),fromNote:trackExplanation(from,layout),toNote:trackExplanation(to,layout)}}
export function trackExplanation(track,layout){
 const clean=v=>String(v||'').toUpperCase().replace(/^(GLEIS|SPOOR|BINARIO)\s+/,'').replace(/\s+/g,'');
 const value=clean(track),notes=[...(layout?.trackNotes||[])].sort((a,b)=>clean(b.track).length-clean(a.track).length);
 return notes.find(n=>value===clean(n.track))?.text || notes.find(n=>value.startsWith(clean(n.track))&&/^[A-Z](?:[-–][A-Z])?$/.test(value.slice(clean(n.track).length)))?.text || '';
}
function baseTransferRule(from,to,layout){
 const clean=x=>String(x||'').toUpperCase().replace(/^(GLEIS|SPOOR|BINARIO)\s+/,'').replace(/\s+/g,'');
 const groups=layout?.groups||layout?.platformGroups?.map(tracks=>({tracks,kind:'opposite',minutes:''}))||[];
 const bases=groups.flatMap(g=>g.tracks).map(clean).sort((a,b)=>b.length-a.length);
 function parse(v){v=clean(v);if(bases.includes(v))return{base:v};for(const base of bases){if(v.startsWith(base)){const m=v.slice(base.length).match(/^([A-Z])(?:[-–]([A-Z]))?$/);if(m&&(!m[2]||m[1]<=m[2]))return{base,range:[m[1],m[2]||m[1]]};}}return{base:v};}
 const a=parse(from),b=parse(to),unknown={relation:'unknown',minimum:7,uncertain:0,explanation:'Ligging onbekend; standaardregel (geen reisplannertijd beschikbaar).'};
 if(!a.base||!b.base||['?','—','-'].includes(a.base)||['?','—','-'].includes(b.base))return unknown;
 const g=groups.find(g=>g.tracks.map(clean).includes(a.base)&&g.tracks.map(clean).includes(b.base));
 if(g&&g.minutes!==''&&g.minutes!=null){const relation=['opposite','partial','same'].includes(g.kind)?'same':g.kind==='different'?'different':'unknown';return{relation,minimum:Number(g.minutes),uncertain:Math.max(0,Number(g.minutes)-1),explanation:'Specifieke overstaptijd; gaat voor standaardregels.',route:g.route,notes:g.notes};}
 const numberLetter=/^(\d+)([A-Z])$/;
 const fromPart=clean(from).match(numberLetter),toPart=clean(to).match(numberLetter);
 if(fromPart&&toPart&&fromPart[1]===toPart[1]&&fromPart[2]!==toPart[2])return{relation:'same',minimum:2,uncertain:1,explanation:'Hetzelfde spoornummer met verschillende letters; 2 minuten voor de overstap.',route:g?.route,notes:g?.notes};
 if(g){const relation=['opposite','partial','same'].includes(g.kind)?'same':g.kind==='different'?'different':'unknown';
 if(relation==='same'){const overlap=!a.range||!b.range||a.range[0]<=b.range[1]&&b.range[0]<=a.range[1],minimum=g.kind==='same'||!overlap?2:1;return{relation,minimum,uncertain:minimum-1,explanation:minimum===1?'Tegenover elkaar of overlappende secties.':'Zelfde perron, niet direct tegenover elkaar.',route:g.route,notes:g.notes};}
 if(relation==='different')return{relation,minimum:7,uncertain:3,explanation:'Verschillende perrons; standaardregel.',route:g.route,notes:g.notes};return unknown;}
 if(a.base===b.base)return{relation:'same',minimum:1,uncertain:0,explanation:'Hetzelfde spoor.'};
 if(bases.includes(a.base)&&bases.includes(b.base))return{relation:'different',minimum:7,uncertain:3,explanation:'Verschillende perrongroepen.'};return unknown;
}
export function ruleStatus(minutes,rule){return !Number.isFinite(minutes)?'unknown':minutes>=rule.minimum?'feasible':minutes>=rule.uncertain?'uncertain':'missed';}
