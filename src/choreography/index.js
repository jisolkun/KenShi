import { getTangAttack, sampleTangAttack } from './tangDao.js';
import { getGreatAttack, sampleGreatAttack } from './greatDao.js';
export function getReviewedAttack(id,combo=0,state='attack') {
 return state==='attack'?(getGreatAttack(id,combo,state)??getTangAttack(id,combo,state)):null;
}
export function sampleReviewedAttack(id,combo=0,phase=0,state='attack') {
 return state==='attack'?(sampleGreatAttack(id,combo,phase,state)??sampleTangAttack(id,combo,phase,state)):null;
}
