// Match traveler identity without treating omitted later given names as discrepancies.
const clean=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
const prefixes=new Set(['van','de','der','den','ter','ten','von','het']);
export function travelerNameMatch(name,p,{truncated=false}={}){
 const n=clean(String(name||'').replace(/\s+(?:SH)?\d[\s\S]*$/i,'').split(/\be\s*\/\s*v\b/i)[0]),tokens=n.split(' ');
 const first=clean(p.firstName).split(' ').filter(Boolean),last=clean(String(p.lastName||'').split(/\be\s*\/\s*v\b/i)[0]).split(' ').filter(Boolean);
 if(!first.length||!last.length||['nnb','onbekend','unknown','tbd'].includes(first[0]))return 'different';
 const tokenMatch=(a,b)=>a===b||((truncated||n.length>=25)&&a.length>=(truncated?3:5)&&b.length>a.length&&b.startsWith(a));
 const significant=last.filter(t=>!prefixes.has(t));
 if(!significant.length||!significant.some(t=>tokens.some(x=>tokenMatch(x,t))))return 'different';
 const surnameTokens=new Set(last),given=tokens.filter(t=>!surnameTokens.has(t)&&!prefixes.has(t)&&!significant.some(x=>tokenMatch(t,x)));
 const firstFound=given.some(t=>tokenMatch(t,first[0]));
 const allowed=given.every(t=>first.some(f=>tokenMatch(t,f)||t.length===1&&f.startsWith(t)));
 return firstFound&&allowed?'accepted':'partial';
}
export function matchTravelerName(name,passengers,options={}){
 if(!clean(name))return 'missing';
 const matches=(passengers||[]).map(p=>travelerNameMatch(name,p,options));
 return matches.includes('accepted')?'exact':matches.includes('partial')?'partial':'different';
}
