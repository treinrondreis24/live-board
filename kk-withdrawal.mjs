import {startTimestamp} from './kk-scoreboard.mjs';
export function withdrawalDetails(user,data,now=Date.now()){
 const endStation=String(data.endStation||'').trim(),endDate=String(data.endDate||''),endTime=String(data.endTime||''),end=startTimestamp(endDate,endTime),start=startTimestamp(user.startDate||'2026-09-19',user.startTime);
 if(!endStation||endStation.length>200||end===null||end>now||start===null||end<start)throw Object.assign(Error('Vul een eindstation en geldige einddatum en eindtijd in, tussen je start en nu.'),{status:400});
 return {endStation,endDate,endTime,receivedAt:now};
}
