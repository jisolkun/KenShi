// Original three-hit design. The supplied source informs the timing model;
// every hammer trajectory and pose is independently authored in pose.js.
export const HAMMER_ID = 'great-hammer';
export const HAMMER_SHAFT = Object.freeze({ length: 1.02, support: .24, tail: .36,
  halfExtents: Object.freeze([.26, .18, .17]), floor: .055 });
const rows = [
  ['旋身横破', .78, .56, .35, [.24, .47], 42, 2.70, 1.05, .70, 'arc'],
  ['回风挑岳', .82, .59, .35, [.23, .49], 48, 2.80, .90, .82, 'arc'],
  ['腾岳震阵', 1.02, .80, .58, [.46, .71], 76, 3.05, 1.20, 1.35, 'crush'],
];
export const HAMMER_MOVES = Object.freeze(rows.map(([name,duration,attackSeconds,contact,active,damage,reach,lunge,knockback,shape],combo) => Object.freeze({
  name, duration, attackSeconds, recoverySeconds: duration-attackSeconds,
  contact: contact/duration, active: Object.freeze(active.map(time=>time/duration)),
  recoverAt: attackSeconds/duration, damage, reach, lunge, knockback, shape,
  pressurePadding: [.32,.36,.45][combo], groundRadius: combo===2?2.45:0, groundDamageScale:.82,
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
  tagline: '旋身、回风、腾岳，三击破阵',
  description: '双手压柄，右侧拖锤奔走；旋身横扫、回风挑转，再腾跃重砸。宽幅锤劲破阵，落地震波碾碎近敌。',
  effectColor: 0xd2b37c, effectAccent: 0xf1dfb5,
  stats: {speed:4,power:5,reach:5}, moves: HAMMER_MOVES,
};
