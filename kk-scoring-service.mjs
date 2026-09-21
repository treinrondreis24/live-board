import {kkScoreRows,kkScoringProofs} from './kk-store.mjs';
import {calculateScore,scoreSummary} from './kk-scoring.mjs';
export async function scoredParticipants(owner=null){
 const [rows,proofs]=await Promise.all([kkScoreRows(owner),kkScoringProofs(owner)]);
 return rows.map(row=>({...row,score:scoreSummary(calculateScore(row.participant,proofs.get(row.participant.id)||[]))}));
}
