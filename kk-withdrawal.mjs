import {startTimestamp} from './kk-scoreboard.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const show=t=>new Date(t).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam',dateStyle:'short',timeStyle:'short'});
export function withdrawalDetails(user,data,now=Date.now()){
 const endStation=String(data.endStation||'').trim(),endDate=String(data.endDate||'').trim(),endTime=String(data.endTime||'').trim(),end=startTimestamp(endDate,endTime),start=startTimestamp(user.startDate||'2026-09-19',user.startTime);
 if(!endStation||endStation.length>200)fail('Vul je eindstation in (maximaal 200 tekens).');
 if(!endDate)fail('Vul de einddatum in. Ben je na middernacht gestopt? Kies dan de datum van die nieuwe dag.');
 if(!endTime)fail('Vul de eindtijd in, bijvoorbeeld 18:35. Gebruik de Nederlandse tijd.');
 if(end===null)fail('De einddatum of eindtijd is ongeldig. Kies de datum opnieuw en vul de tijd in als uren en minuten.');
 if(start!==null&&end<start)fail('Je eindtijd ('+show(end)+') ligt vóór je opgeslagen start ('+show(start)+'). Controleer vooral de einddatum bij een reis over middernacht. Is de start onjuist? Laat de organisatie die corrigeren.');
 if(end>now)fail('Je eindtijd ('+show(end)+') ligt nog in de toekomst. Het is nu '+show(now)+' Nederlandse tijd. Vul het tijdstip in waarop je daadwerkelijk bent gestopt.');
 return {endStation,endDate,endTime,receivedAt:now};
}
