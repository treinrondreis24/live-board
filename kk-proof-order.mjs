import {kkGet,kkPut} from './kk-store.mjs';
import {canUseProof} from './kk-password.mjs';
import {startTimestamp} from './kk-scoreboard.mjs';
export async function setProofOrder(user,data,admin=false){
 const row=await kkGet('submission',data.id);
 if(!row||row.value.kind!=='proof'||(!admin&&(row.owner!==user.id||!canUseProof(user))))throw Object.assign(Error('Bewijs niet beschikbaar.'),{status:403});
 const at=startTimestamp(data.date,data.time);
 if(at===null||at>Date.now()||typeof data.affectsRoutes!=='boolean')throw Object.assign(Error('Vul een geldig moment in het verleden in en geef aan of de trajecten wijzigen.'),{status:400});
 const value={...row.value,journeyAt:at,orderChangedAt:Date.now(),affectsRoutes:data.affectsRoutes};
 await kkPut('submission',row.id,row.owner,value);return value;
}
