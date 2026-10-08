import { getRingAttack, sampleRingAttack } from './ringDao.js';
import { getMiaoAttack, sampleMiaoAttack } from './miaoDao.js';
import { getTangAttack, sampleTangAttack } from './tangDao.js';
import { getYanlingAttack, sampleYanlingAttack } from './yanlingDao.js';
export function getReviewedAttack(id,combo=0,state='attack') {
 return getTangAttack(id,combo,state)??getYanlingAttack(id,combo,state)??getMiaoAttack(id,combo,state)??getRingAttack(id,combo,state);
}
export function sampleReviewedAttack(id,combo=0,phase=0,state='attack') {
 return sampleTangAttack(id,combo,phase,state)??sampleYanlingAttack(id,combo,phase,state)??sampleMiaoAttack(id,combo,phase,state)??sampleRingAttack(id,combo,phase,state);
}
