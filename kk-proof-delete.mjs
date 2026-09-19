import {randomUUID} from 'node:crypto';
import {kkGet,kkPut,kkDelete,kkOwned} from './kk-store.mjs';
export async function deleteProof(id){
 const row=await kkGet('submission',id);if(!row||row.value.kind!=='proof')throw Object.assign(Error('Bewijs niet gevonden.'),{status:404});
 const rows=await kkOwned(row.owner);const affected=rows.filter(r=>r.kind==='hilta-current'&&(r.id===id||r.value.previousProofId===id));
 // Preserve original evidence and route history for recovery; do not remove shared media.
 await kkPut('proof-deleted',id,row.owner,{...row.value,deletedAt:Date.now(),originalCreated:Number(row.created)});
 for(const r of affected){await kkPut('hilta-before-delete',r.value.id||randomUUID(),r.owner,r.value);await kkPut('hilta-current',r.id,r.owner,{...r.value,id:randomUUID(),status:'needs-review',notice:'Een voorafgaand bewijs is verwijderd. Bereken en bevestig dit traject opnieuw.'});}
 await kkDelete('submission',id);return {review:affected.filter(r=>r.id!==id).length};
}
