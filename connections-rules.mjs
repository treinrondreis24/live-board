export let connectionRulesVersion=2;
export const replacements={'225':'1255','224':'1254','122':'152','124':'154'};
export const stationAliases={
 mannheim:['Mannheim Hbf'],wien:['Wien Hbf'],innsbruck:['Innsbruck Hbf'],berlin:['Berlin Hbf','Berlin Hbf (tief)'],
 koeln:['Köln Hbf'],duesseldorf:['Düsseldorf Hbf'],frankfurt:['Frankfurt(Main)Hbf','Frankfurt (Main) Hbf'],
 flughafen:['Frankfurt(M) Flughafen Fernbf','Frankfurt Flughafen Fernbf'],stuttgart:['Stuttgart Hbf'],
 dresden:['Dresden Hbf'],hannover:['Hannover Hbf'],osnabrueck:['Osnabrück Hbf'],milano:['Milano Centrale']
};
export let connectionRules=[
 {id:'mannheim-225-5',station:'mannheim',incoming:'225',outgoing:'5'},
 {id:'mannheim-225-371',station:'mannheim',incoming:'225',outgoing:'371',alternativeDeparture:{from:'13:30',to:'14:00',destinations:['basel','zurich']}},
 {id:'wien-66-40490',station:'wien',incoming:'66',outgoing:'40490',departureBefore:'19:00',alternativeArrival:{from:'16:15',to:'16:45',categories:['RJ','RJX']}},
 {id:'wien-146-40490',station:'wien',incoming:'146',outgoing:'40490',departureAfter:'19:00'},
 {id:'innsbruck-82-420',station:'innsbruck',incoming:'82',outgoing:'420'},
 {id:'berlin-178-142',station:'berlin',incoming:'178',outgoing:'142',alternativeTrain:'140'},
 {id:'koeln-106-224',station:'koeln',incoming:'106',outgoing:'224',fallbackStation:'duesseldorf'},
 {id:'frankfurt-372-124',station:'frankfurt',incoming:'372',outgoing:'124'},
 {id:'koeln-108-122',station:'koeln',incoming:'108',outgoing:'122',fallbackStation:'duesseldorf'},
 {id:'innsbruck-421-81',station:'innsbruck',incoming:'421',outgoing:'81'},
 {id:'innsbruck-421-83',station:'innsbruck',incoming:'421',outgoing:'83'},
 {id:'dresden-178-2440',station:'dresden',incoming:'178',outgoing:'2440',fromDate:'2026-10-07'},
 {id:'hannover-2440-142',station:'hannover',incoming:'2440',outgoing:'142',fromDate:'2026-10-07'},
 {id:'flughafen-28-224',station:'flughafen',incoming:'28',outgoing:'224',origin:'wien hbf',incomingCategory:'ICE'},
 {id:'stuttgart-225-2383',station:'stuttgart',incoming:'225',outgoing:'2383'},
 {id:'milano-151-679',station:'milano',incoming:'151',outgoing:'679'},
 {id:'milano-151-2832',station:'milano',incoming:'151',outgoing:'2832'},
 // "Tot 5 oktober" is treated conservatively as before 5 October; configurable later.
 {id:'osnabrueck-145-202',station:'osnabrueck',incoming:'145',outgoing:'202',untilDate:'2026-10-05'},
 {id:'osnabrueck-143-204',station:'osnabrueck',incoming:'143',outgoing:'204',untilDate:'2026-10-05'},
 {id:'osnabrueck-141-206',station:'osnabrueck',incoming:'141',outgoing:'206',untilDate:'2026-10-05'}
];
export const normalized=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export const stationKey=name=>Object.keys(stationAliases).find(k=>stationAliases[k].some(n=>normalized(n)===normalized(name)))||null;
const dates=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
export const connectionDate=timestamp=>dates.format(new Date(timestamp));
export const localClock=timestamp=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(timestamp));
export function activeRule(rule,date){return rule.enabled!==false&&(!rule.fromDate||date>=rule.fromDate)&&(!rule.untilDate||date<rule.untilDate);}
export function relevantEvent(station,number,category){return connectionRules.some(r=>{
 if(r.station!==station&&r.fallbackStation!==station)return false;
 return [r.incoming,r.outgoing,replacements[r.incoming],replacements[r.outgoing],r.alternativeTrain].includes(number)||Boolean(r.alternativeDeparture)||Boolean(r.alternativeArrival?.categories.includes(category));
});}

export const defaultConnectionRules=structuredClone(connectionRules);
export function setConnectionRules(rules,revision=0){connectionRules=structuredClone(rules);connectionRulesVersion=2+revision;}
