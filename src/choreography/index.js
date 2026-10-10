import { getTangAttack, sampleTangAttack } from './tangDao.js';
import { getGreatAttack, sampleGreatAttack } from './greatDao.js';
import { getHammerAttack, sampleHammerAttack } from './greatHammer.js';
export function getReviewedAttack(id,combo=0,state='attack') {
 return state==='attack'?(getHammerAttack(id,combo,state)??getGreatAttack(id,combo,state)??getTangAttack(id,combo,state)):null;
}
export function sampleReviewedAttack(id,combo=0,phase=0,state='attack') {
 return state==='attack'?(sampleHammerAttack(id,combo,phase,state)??sampleGreatAttack(id,combo,phase,state)??sampleTangAttack(id,combo,phase,state)):null;
}
