// Match only onward calls: a train's origin must never satisfy a direction.
const aliases={Duitsland:['Basel Bad Bf','Freiburg(Breisgau) Hbf','Karlsruhe Hbf','Mannheim Hbf','Frankfurt(Main)Hbf','Köln Hbf','Hamburg Hbf','Stuttgart Hbf'],Köln:['Köln Hbf'],Frankfurt:['Frankfurt(Main)Hbf','Frankfurt (Main) Hbf'],Zürich:['Zürich HB'],Basel:['Basel SBB'],Interlaken:['Interlaken Ost'],Disentis:['Disentis/Mustér'],Milaan:['Milano Centrale','Milano Porta Garibaldi'],Amsterdam:['Amsterdam Centraal'], 'Zürich Airport':['Zürich Flughafen']};
const d=(label,target=label,options={})=>({label,target,...options});
const noGex={excludeBrand:'GEX'},boat={mode:'water'};
export const swissDirections={
 'basel-sbb':[d('Köln (en verder)','Köln'),d('Frankfurt Hbf','Frankfurt'),d('Interlaken'),d('Chur'),d('Bern'),d('Zürich (IC of IR)','Zürich',{categories:['IC','IR']})],
 'interlaken-ost':[d('Luzern'),d('Duitsland'),d('Montreux'),d('Boot richting Brienz','Brienz',boat)],
 visp:[d('Zermatt'),d('Bern'),d('Basel'),d('Lausanne')],
 brig:[d('Glacier Express richting Chur','Chur',{brand:'GEX'}),d('Zermatt'),d('Basel'),d('Zürich'),d('Andermatt (geen GEX)','Andermatt',noGex)],
 filisur:[d('Bernina Express richting Tirano','Tirano',{brand:'BEX'}),d('St. Moritz'),d('Chur'),d('Davos','Davos Platz')],
 chur:[d('Duitsland'),d('Bernina Express richting Tirano','Tirano',{brand:'BEX'}),d('Glacier Express richting Brig','Brig',{brand:'GEX'}),d('St. Moritz'),d('Zürich'),d('Disentis (geen GEX)','Disentis',noGex)],
 disentis:[d('Chur (geen GEX)','Chur',noGex),d('Andermatt (geen GEX)','Andermatt',noGex)],
 andermatt:[d('Disentis (geen GEX)','Disentis',noGex),d('Brig (geen GEX)','Brig',noGex),d('Göschenen'),d('Glacier Express',null,{brand:'GEX'})],
 bern:[d('Duitsland'),d('Interlaken'),d('Brig'),d('Basel SBB')],
 spiez:[d('Interlaken Ost'),d('Kandersteg (en verder)','Kandersteg'),d('Montreux'),d('Zweisimmen'),d('Brig (IC)','Brig',{categories:['IC']})],
 thun:[d('Boot naar Spiez of Interlaken','Spiez', {...boat,also:['Interlaken West']}),d('Interlaken Ost'),d('Kandersteg'),d('Basel')],
 luzern:[d('Interlaken Ost'),d('Arth Goldau','Arth-Goldau'),d('Bellinzona via Göschenen','Bellinzona',{via:'Göschenen'}),d('Bern'),d('Lugano via Gotthard-basistunnel','Lugano',{avoid:'Göschenen'}),d('Uznach (Voralpen Express)','Uznach',{brand:'VAE'}),d('Kriens Mattenhof')],
 lugano:[d('Basel'),d('Arth Goldau','Arth-Goldau'),d('Monza'),d('Milaan'),d('Bellinzona')],
 bellinzona:[d('Göschenen (oude Gotthardroute)','Göschenen'),d('Arth Goldau (IC)','Arth-Goldau',{categories:['IC']}),d('Lugano'),d('Locarno')],
 zermatt:[d('Glacier Express',null,{brand:'GEX'}),d('Visp (zonder GEX)','Visp',noGex),d('Brig (zonder GEX)','Brig',noGex)],
 zuerich:[d('Amsterdam'),d('Chur'),d('Bern (IC)','Bern',{categories:['IC']}),d('Zürich Airport'),d('Schaffhausen'),d('Mannheim','Mannheim Hbf'),d('Stuttgart','Stuttgart Hbf'),d('Innsbruck','Innsbruck Hbf')],
 sargans:[d('Zürich'),d('Chur'),d('Innsbruck','Innsbruck Hbf')],
 schaffhausen:[d('Zürich HB'),d('Watervallen: Neuhausen am Rheinfall','Neuhausen Rheinfall'),d('St. Gallen'),d('Stuttgart','Stuttgart Hbf')],
 'interlaken-west':[d('Boot richting Thun','Thun',boat),d('Montreux'),d('Interlaken Ost'),d('Spiez')],
 taesch:[d('Zermatt'),d('Visp')]
};
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function matchesStop(name,target){
 return (aliases[target]||[target]).some(t=>norm(name)===norm(t)||norm(name)===norm(t+' (See)')||(t==='Brig'&&norm(name)===norm('Brig Bahnhofplatz')));
}
export function matchesSwissDirection(row,direction){
 if((row.transportMode||'rail')!==(direction.mode||'rail'))return false;
 const identity=[row.category,row.line,row.serviceName].join(' ').toUpperCase();
 const brand=b=>b==='VAE'?/\bVAE\b|VORALPEN|\bIR\s*13\b/.test(identity):b==='GEX'?/\bGEX\b|GLACIER EXPRESS/.test(identity):/\bBEX\b|BERNINA EXPRESS/.test(identity);
 if(direction.brand&&!brand(direction.brand)||direction.excludeBrand&&brand(direction.excludeBrand))return false;
 if(direction.categories&&!direction.categories.includes(row.category))return false;
 const stops=[...(row.futureRoute||row.route||[]),row.to];
 const has=t=>stops.some(s=>matchesStop(typeof s==='string'?s:s.name,t));
 // OJP ends the shared RE1 section at Spiez before the train divides.
 // BLS confirms the Brig portion continues via Kandersteg:
 // https://www.bls.ch/de/fahren/fahrplan/bls-linien
 if(direction.target==='Kandersteg'&&row.observedAt==='Thun'&&row.line==='RE1'&&row.to==='Brig/Zweisimmen'&&has('Spiez')&&!has('Visp'))return true;
 if(direction.via&&!has(direction.via)||direction.avoid&&(!row.routeComplete||has(direction.avoid)))return false;
 return !direction.target||[direction.target,...direction.also||[]].some(has);
}
export function swissQuick(page,rows){return (swissDirections[page]||[]).map((d,i)=>{const trains=rows.filter(r=>matchesSwissDirection(r,d)).slice(0,8);return {id:page+'-'+i,label:d.label,count:trains.length,trains};});}
