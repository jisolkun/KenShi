// Original three-hit design. The supplied source informs the timing model;
// every hammer trajectory and pose is independently authored in pose.js.
export const HAMMER_ID = 'great-hammer';
export const HAMMER_SHAFT = Object.freeze({ length: 1.02, support: .24, tail: .36,
  halfExtents: Object.freeze([.26, .18, .17]), floor: .055 });
const rows = [
  ['磐山横破', .90, .64, .43, [.35, .51], 42, 1.85, .26, .70, 'arc'],
  ['回峰挑击', .94, .68, .45, [.36, .54], 48, 1.90, .20, .82, 'arc'],
  ['落岳震阵', 1.20, 1.00, .73, [.60, .80], 76, 1.80, .32, 1.35, 'crush'],
];
export const HAMMER_MOVES = Object.freeze(rows.map(([name,duration,attackSeconds,contact,active,damage,reach,lunge,knockback,shape],combo) => Object.freeze({
  name, duration, attackSeconds, recoverySeconds: duration-attackSeconds,
  contact: contact/duration, active: Object.freeze(active.map(time=>time/duration)),
  recoverAt: attackSeconds/duration, damage, reach, lunge, knockback, shape,
  width: .32, halfAngle: combo===2?.55:1.35, hitstop: 0,
  sourceMotion: false, customMotion: true, customFinisher: combo===2,
})));
export const HAMMER_ATTACK_PROFILES = Object.freeze(HAMMER_MOVES.map((move,combo)=>Object.freeze({
  kind: 'hero', weaponFamily: 'custom-hammer', customHammer: true, combo,
  name: `custom_hammer_${combo+1}`, duration: move.duration,
  attackRaw: move.attackSeconds*.24, recoveryRaw: move.recoverySeconds*.24,
  attackSeconds: move.attackSeconds, recoverySeconds: move.recoverySeconds, recoverySpeed: .24,
  clipBoundaries: Object.freeze([{phase: move.recoverAt}]),
})));
export const hammerIndex = combo => ((Math.trunc(Number.isFinite(combo)?combo:0)%3)+3)%3;
export function getHammerAttackProfile(combo=0) { return HAMMER_ATTACK_PROFILES[hammerIndex(combo)]; }
export function getHammerAttackTiming(combo=0) {
  const index=hammerIndex(combo), move=HAMMER_MOVES[index], profile=HAMMER_ATTACK_PROFILES[index];
  return {profile,family:'custom-hammer',combo:index,atkspd:0,attackSpeed:.24,recoverySpeed:.24,
    attackSeconds:move.attackSeconds,recoverySeconds:move.recoverySeconds,duration:move.duration,
    hitDelay:move.contact*move.duration,hasRecovery:true,recoverAt:move.recoverAt,
    contact:move.contact,attackContact:move.contact/move.recoverAt,
    samplerDuration:move.duration,samplerRecoveryAt:move.recoverAt};
}
export const HAMMER_WEAPON = {
  id: HAMMER_ID, name: '大锤', category: '重兵', grip: 'twohand', customMotion: true,
  tagline: '横破、提挑、落岳，三击破阵',
  description: '沉肩转腰斜横破阵，反向提挑借势抬锤，再踏步过顶重砸。双手合握一柄，三击从蓄力、爆发到回收连续承接。',
  effectColor: 0xd2b37c, effectAccent: 0xf1dfb5,
  stats: {speed:3,power:5,reach:4}, moves: HAMMER_MOVES,
};
