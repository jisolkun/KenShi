import {
  referenceWeaponAttackProfiles,
  referenceActionProfiles,
  referenceMotionMetadata,
} from './data.js';

export const SOURCE_ATTACK_COUNT = 5;
export const SOURCE_BASE_ATTACK_SPEED = .24;
export const SOURCE_RECOVERY_SPEED = .24;
export const SOURCE_LOCOMOTION_FADE = .3;

export const SOURCE_WEAPON_FAMILIES = Object.freeze({
  'dual-dao': 'dual',
  'tang-dao': 'blade',
  'great-dao': 'blade',
  'great-hammer': 'halberd',
});

export const SOURCE_WEAPON_BINDINGS = Object.freeze(Object.fromEntries(
  Object.entries(SOURCE_WEAPON_FAMILIES).map(([id, family]) => [id, Object.freeze({
    family,
    // Initial inventory stats, including ChangeCharacter's dual speed offset.
    atkspd: family === 'dual' ? -.01 : .02,
    fallback: id === 'great-hammer',
    provenance: id === 'great-hammer'
      ? 'The supplied source has no hammer animation family. New hammer shaft paths are paired with the original halberd full-body curves and native attack clocks.'
      : `Original ${family} clips from the supplied source.`,
  })]),
));

const familyOf = id => SOURCE_WEAPON_FAMILIES[id]
  ?? (['dual', 'blade', 'halberd'].includes(id) ? id : null);
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = value => Math.min(1, Math.max(0, value));
const attackIndex = combo => Math.min(SOURCE_ATTACK_COUNT - 1,
  Math.max(0, Math.floor(finite(combo, 0))));

/** Profiles keep their original identity and base-speed duration. The curve
 * sampler caches these objects; use getSourceAttackTiming for game seconds. */
export function getSourceAttackProfile(id, combo = 0) {
  const family = familyOf(id);
  return referenceWeaponAttackProfiles.hero?.[family]?.[attackIndex(combo)] ?? null;
}

export function getSourceActionProfile(id, state = 'idle') {
  const family = familyOf(id);
  const action = state === 'dead' ? 'death' : state === 'guard' ? 'idle' : state;
  return referenceActionProfiles.hero?.[family]?.[action] ?? null;
}

export function getSourceMotionProvenance(id) {
  const binding = SOURCE_WEAPON_BINDINGS[id];
  return binding ? { ...binding, source: referenceMotionMetadata.source } : null;
}

/** Native ordinary attacks run at .24 + initial weapon atkspd; queued
 * recovery always runs at .24. Hit delays subtract that same atkspd. */
export function getSourceAttackTiming(id, combo = 0, { atkspd } = {}) {
  const profile = getSourceAttackProfile(id, combo);
  if (!profile) return null;
  const family = familyOf(id);
  atkspd = finite(atkspd, SOURCE_WEAPON_BINDINGS[id]?.atkspd
    ?? (family === 'dual' ? -.01 : .02));
  const attackSpeed = Math.fround(Math.fround(SOURCE_BASE_ATTACK_SPEED) + Math.fround(atkspd));
  if (!(attackSpeed > 0)) throw new RangeError('Source attack playback speed must be positive');
  const recoverySpeed = Math.fround(SOURCE_RECOVERY_SPEED);
  const attackSeconds = profile.attackRaw / attackSpeed;
  const recoverySeconds = profile.recoveryRaw / recoverySpeed;
  const duration = attackSeconds + recoverySeconds;
  const hitDelay = Math.max(0, finite(profile.hitDelay, 0) - atkspd);
  return {
    profile, family, combo: attackIndex(combo), atkspd, attackSpeed, recoverySpeed,
    attackSeconds, recoverySeconds, duration, hitDelay,
    hasRecovery: profile.recoveryRaw > 0,
    recoverAt: recoverySeconds > 0 ? attackSeconds / duration : 1,
    contact: clamp(hitDelay / duration),
    attackContact: clamp(hitDelay / attackSeconds),
    samplerDuration: profile.duration,
    samplerRecoveryAt: profile.clipBoundaries?.[0]?.phase
      ?? profile.attackSeconds / profile.duration,
  };
}

export function getSourceLocomotionSpeed(state, speedFactor = 7) {
  return state === 'run' ? .6 : state === 'walk'
    ? finite(speedFactor, 7) / 7.5 + .2 : .1;
}

const names = ['第一式', '第二式', '第三式', '第四式', '第五式'];

/** Build five source-timed moves while retaining the caller's game balance.
 * A four-move balance table retains its strongest move for source attack5. */
export function createSourceWeaponMoves(id, baseMoves = [], options = {}) {
  if (!getSourceAttackProfile(id, 0)) return [];
  return Array.from({ length: SOURCE_ATTACK_COUNT }, (_, combo) => {
    const timing = getSourceAttackTiming(id, combo, options);
    const index = baseMoves.length === 4 ? [0, 1, 2, 2, 3][combo]
      : Math.min(combo, Math.max(0, baseMoves.length - 1));
    const base = baseMoves[index] ?? {};
    return {
      ...base,
      name: names[combo],
      duration: timing.duration,
      contact: timing.contact,
      // The source strike begins at its script cue and ends with attack.
      // Geometry/contact adapters can narrow this interval further.
      active: [timing.contact, timing.recoverAt],
      recoverAt: timing.recoverAt,
      sourceMotion: true,
      sourceName: timing.profile.name,
      sourceFamily: timing.family,
      sourceAttackSeconds: timing.attackSeconds,
      sourceRecoverySeconds: timing.recoverySeconds,
      sourceHitDelay: timing.hitDelay,
      sourceFinisher: combo === SOURCE_ATTACK_COUNT - 1,
      sourceFallback: SOURCE_WEAPON_BINDINGS[id]?.fallback ?? false,
    };
  });
}
