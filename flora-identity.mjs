const normal=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/ł/g,'l').replace(/[^a-z0-9]+/g,' ').trim();
const cities=['Wenen|Wien|Vienna','Rome|Roma','Praag|Prague|Praha','München|Munich','Luxemburg|Luxembourg','Neurenberg|Nürnberg|Nuremberg','Milaan|Milano|Milan','Venetië|Venezia|Venice','Duisburg','Bratislava','Napels|Napoli|Naples','Edinburgh','Glasgow','Chur','Interlaken','Brig','Lugano','Zürich|Zurich','Basel','Schaffhausen','Montpellier','Warschau|Warsaw|Warszawa','Krakau|Krakow','Wroclaw','Tallinn|Tallin','Bialystok|Białystok','Vejle','Arezzo','Verona','Budapest','Zaragoza','Granada','Cádiz|Cadiz','Madrid','Málaga|Malaga','Córdoba|Cordoba','Ronda','Koblenz','Hamburg','Osnabrück|Osnabruck','Agrigento','Cefalù|Cefalu','Oslo','Trondheim','Bodø|Bodo','Narvik','Stockholm','Shrewsbury','Helsinki','Newcastle','IJmuiden','Kopenhagen|Copenhagen','Parijs|Paris','Berlijn|Berlin','Arnhem','Amsterdam','Utrecht','Rotterdam','Innsbruck','Salzburg','Luzern|Lucerne','Tirano','Zermatt','Chamonix'];
export function cityFrom(text){const value=' '+normal(String(text).replace(/\bvia\s+Roma\b/gi,'').replace(/de Francia y Par[ií]s/gi,'').replace(/\bMetropol\s+Hotel\s+Marsza[lł]kowska\b/gi,'Metropol Hotel Warsaw').replace(/CHAJD/gi,'Zurich').replace(/ATALA/gi,'Innsbruck').replace(/ATWIH/gi,'Wien'))+' ',matches=cities.filter(row=>row.split('|').some(alias=>value.includes(' '+normal(alias)+' ')));return matches.length===1?matches[0].split('|')[0]:'';}

const canonical=s=>normal(String(s||'').split('|')[0].replace(/\([^)]*\)/g,''))
 .replace(/\b(warsaw|warszawa)\b/g,'warschau').replace(/\bic hotel\b/g,'intercityhotel').replace(/\b(wien|vienna)\b/g,'wenen').replace(/\b(hbf|hauptbahnhof)\b/g,'centralstation').replace(/\b(nurnberg|nuremberg)\b/g,'neurenberg');
const tokens=s=>canonical(s).split(' ').filter(w=>w.length>1&&!['hotel','hotels','the','by','straat','calle','piazza'].includes(w));
export function hotelCityConflict(todo,proof){
 const expected=cityFrom(todo.title||''),address=proof.provider==='Expedia'?(proof.sourceText||'').match(/Hoteloverzicht\s+(.{1,600}?)\s+Hotel bekijken/i)?.[1]||'':'';
 const actual=[cityFrom(proof.product||''),cityFrom(address)].find(c=>expected&&c&&c!==expected);
 return actual?{expected,actual}:null;
}
export function hotelIdentity(todo,proof,booking){
 const title=todo.title||'',product=proof.product||'',address=proof.provider==='Expedia'?(proof.sourceText||'').match(/Hoteloverzicht\s+(.{1,600}?)\s+Hotel bekijken/i)?.[1]||'':'';
 const city=cityFrom(title),bookedCity=cityFrom(address||product);if(hotelCityConflict(todo,proof))return false;
 const sameCity=city&&city===bookedCity,a=tokens(title),b=tokens(product),cityTokens=tokens(city),distinct=a.filter(w=>!cityTokens.includes(w)&&w!=='centralstation');
 // Compare the hotel name independently of the city and address suffix.
 const nameWords=a.filter(w=>!cityTokens.includes(w));
 if(sameCity&&nameWords.some(w=>w.length>=4&&w!=='centralstation')&&nameWords.every(w=>b.includes(w)))return true;
 // Approved policy: a distinctive shared hotel-name word is sufficient unless a city conflicts.
 const generic=new Set(['double','twin','kamer','room','standaard','standard','royal','grand','centralstation','international','straat','calle','piazza','strasse','via']);
 if(nameWords.some(w=>w.length>=4&&!generic.has(w)&&!cityFrom(w)&&b.includes(w)))return true;
 // Explicit alternatives in a todo are allowed choices, even without a city label.
 const alternatives=title.split('|')[0].split(/\s+(?:of|or)\s+/i);
 if(alternatives.length>1&&alternatives.some(option=>{const words=tokens(option).filter(w=>!cityTokens.includes(w));return words.some(w=>w.length>=4&&!['double','twin','kamer','room','centralstation'].includes(w))&&words.every(w=>b.includes(w));}))return true;
 const shorter=a.length<b.length?a:b,longer=a.length<b.length?b:a;
 if(sameCity&&shorter.length&&shorter.every(w=>longer.includes(w)||cityTokens.includes(w))&&distinct.some(w=>b.includes(w)))return true;
 // A specifically approved alternative, not a general hotel alias.
 if(city==='Cádiz'&&bookedCity==='Cádiz'&&/francia.*paris/.test(normal(title))&&/cadiz bahia/.test(normal(product))&&todo.start==='2026-10-03'&&todo.end==='2026-10-04')return true;
 const supporting=[todo.description,booking.notes,...(booking.lines||[]).filter(l=>l.visible!==false).map(l=>l.title)].filter(Boolean);
 const key=tokens(product.split(/\b(?:calle|straat|piazza|strasse)\b/i)[0]).filter(w=>!tokens(bookedCity).includes(w)&&!['centralstation','glorieta'].includes(w));
 const supported=supporting.some(text=>{const words=tokens(text);return key.some(w=>w.length>=5)&&key.slice(0,2).every(w=>words.includes(w))&&(sameCity?(!cityFrom(text)||cityFrom(text)===city):city&&cityFrom(text)===city&&todo.start===proof.start&&todo.end===proof.end&&!!todo.start&&!!todo.end);});
 return supported||(!sameCity&&canonical(title)===canonical(product)&&canonical(product).length>4);
}
export function trainRoom(text){const s=normal(text);return /\b(?:pa1am|ritam)\b|mini.?cabin|mini.?coupe/.test(s)?'mini':/\b(pa1ad|ritad)\b|priv.*coupe|private.*compartment/.test(s)?'private':/\brica4\b|couchette 4|vier ligpl/.test(s)?'couchette4':'';}
export function trainStations(text){return String(text||'').replace(/\bCHAJD\b/gi,'Zürich').replace(/\bATALA\b/gi,'Innsbruck').replace(/\bATWIH\b/gi,'Wien');}

export function adjacentNightStay(proof,booking){
 const route=normal(proof.product),out=proof.direction==='outbound',back=proof.direction==='inbound';
 if(!out&&!back)return false;
 const swiss=/\b(?:zwitserland|switzerland|schweiz|zurich|zuerich|basel|bern|luzern|lucerne|chur|lugano|interlaken|zermatt|brig|schaffhausen|lausanne|geneve|geneva|montreux|st moritz)\b/;
 let area;
 if(/\b(?:wien|vienna|wenen)\b/.test(route))area=/\b(?:wien|vienna|wenen|bratislava|budapest|boedapest|slovakia|slowakije|slovensko|kosice|zilina|poprad|trencin|banska bystrica|tatranska|strbske)\b/;
 else if(/\b(?:zurich|zuerich|basel)\b/.test(route))area=out?new RegExp(swiss.source+'|\\b(?:milaan|milano|milan)\\b'):swiss;
 else if(/\binnsbruck\b/.test(route))area=/\b(?:innsbruck|verona|venetie|venice|venezia|rome|roma)\b/;
 if(!area)return false;
 return (booking.todos||[]).some(t=>t.tag==='hotel'&&!/nightjet|nachttrein|\b(?:eun|rit|nj)\b/i.test(t.title||'')&&String(out?t.startDate:t.endDate).slice(0,10)===(out?proof.end:proof.start)&&area.test(normal(t.title+' '+(t.description||''))));
}
