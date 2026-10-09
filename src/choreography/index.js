import { getTangAttack, sampleTangAttack } from './tangDao.js';
export function getReviewedAttack(id,combo=0,state='attack') {
 return state==='attack'?getTangAttack(id,combo,state):null;
}
export function sampleReviewedAttack(id,combo=0,phase=0,state='attack') {
 return state==='attack'?sampleTangAttack(id,combo,phase,state):null;
}
